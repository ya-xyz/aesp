/**
 * AESP — Negotiation State Machine
 *
 * Finite state machine for agent-to-agent negotiation.
 * Validates state transitions and manages negotiation sessions.
 * Optional StorageAdapter enables persistence across restarts.
 */

import type { AgentMessageType, StorageAdapter } from '../types/index.js';
import { NegotiationError } from '../types/index.js';
import type {
  NegotiationState,
  NegotiationSession,
  NegotiationRound,
  NegotiationOffer,
  NegotiationCounterOffer,
  NegotiationAcceptance,
  NegotiationRejection,
  StateTransition,
} from '../types/negotiation.js';
import { VALID_TRANSITIONS as TRANSITIONS } from '../types/negotiation.js';
import { generateUUID } from '../crypto/hashing.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_ROUNDS = 10;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSIONS_STORAGE_KEY = 'aesp:negotiation_sessions';
const PERSIST_DEBOUNCE_MS = 80;

// ─── State Machine ───────────────────────────────────────────────────────────

export class NegotiationStateMachine {
  private sessions: Map<string, NegotiationSession> = new Map();
  private transitionLog: StateTransition[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly storage?: StorageAdapter) {}

  /**
   * Create a new negotiation session.
   */
  createSession(params: {
    myAgentId: string;
    counterpartyAgentId: string;
    maxRounds?: number;
    ttlMs?: number;
    sessionId?: string;
  }): NegotiationSession {
    const now = new Date().toISOString();
    const ttl = params.ttlMs ?? DEFAULT_SESSION_TTL_MS;

    const session: NegotiationSession = {
      sessionId: params.sessionId ?? generateUUID(),
      myAgentId: params.myAgentId,
      counterpartyAgentId: params.counterpartyAgentId,
      state: 'initial',
      rounds: [],
      maxRounds: params.maxRounds ?? DEFAULT_MAX_ROUNDS,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + ttl).toISOString(),
    };

    this.sessions.set(session.sessionId, session);
    this.schedulePersist();
    return session;
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): NegotiationSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions.
   */
  getActiveSessions(): NegotiationSession[] {
    const now = new Date();
    return Array.from(this.sessions.values()).filter((s) => {
      if (s.state === 'rejected' || s.state === 'committed') return false;
      if (s.expiresAt && new Date(s.expiresAt) < now) return false;
      return true;
    });
  }

  /**
   * Validate and execute a state transition.
   */
  transition(
    sessionId: string,
    messageType: AgentMessageType,
    sender: string,
    payload: NegotiationOffer | NegotiationCounterOffer | NegotiationAcceptance | NegotiationRejection,
  ): NegotiationSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NegotiationError(`Session ${sessionId} not found`);
    }

    // Only the two parties in a session may drive state transitions.
    if (sender !== session.myAgentId && sender !== session.counterpartyAgentId) {
      throw new NegotiationError(
        `Unauthorized sender '${sender}' for session ${sessionId}`,
        { sender, myAgentId: session.myAgentId, counterpartyAgentId: session.counterpartyAgentId },
      );
    }

    // Check expiration
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      throw new NegotiationError(`Session ${sessionId} has expired`);
    }

    // Check max rounds
    if (session.rounds.length >= session.maxRounds) {
      throw new NegotiationError(
        `Session ${sessionId} has reached maximum rounds (${session.maxRounds})`,
      );
    }

    // Validate transition
    const targetState = this.resolveTargetState(session.state, messageType, sender, session);
    if (!targetState) {
      throw new NegotiationError(
        `Invalid transition: ${session.state} → ? (via ${messageType})`,
        { currentState: session.state, messageType },
      );
    }

    // Record transition
    const now = new Date().toISOString();
    this.transitionLog.push({
      from: session.state,
      to: targetState,
      trigger: messageType,
      timestamp: now,
    });

    // Add round
    const round: NegotiationRound = {
      roundNumber: session.rounds.length + 1,
      sender,
      messageType,
      payload,
      timestamp: now,
    };
    session.rounds.push(round);

    // Update state
    session.state = targetState;
    session.updatedAt = now;

    this.schedulePersist();
    return session;
  }

  /**
   * Send an offer (initiator side).
   */
  sendOffer(sessionId: string, myAgentId: string, offer: NegotiationOffer): NegotiationSession {
    return this.transition(sessionId, 'negotiation_offer', myAgentId, offer);
  }

  /**
   * Receive an offer (responder side).
   */
  receiveOffer(sessionId: string, counterpartyId: string, offer: NegotiationOffer): NegotiationSession {
    return this.transition(sessionId, 'negotiation_offer', counterpartyId, offer);
  }

  /**
   * Send a counter-offer.
   */
  sendCounter(sessionId: string, sender: string, counter: NegotiationCounterOffer): NegotiationSession {
    return this.transition(sessionId, 'negotiation_counter', sender, counter);
  }

  /**
   * Accept the current offer.
   */
  accept(sessionId: string, sender: string, acceptance: NegotiationAcceptance): NegotiationSession {
    return this.transition(sessionId, 'negotiation_accept', sender, acceptance);
  }

  /**
   * Reject the negotiation.
   */
  reject(sessionId: string, sender: string, rejection: NegotiationRejection): NegotiationSession {
    return this.transition(sessionId, 'negotiation_reject', sender, rejection);
  }

  /**
   * Mark session as committed (after EIP-712 signing).
   */
  markCommitted(sessionId: string): NegotiationSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NegotiationError(`Session ${sessionId} not found`);
    }
    if (session.state !== 'accepted') {
      throw new NegotiationError(
        `Cannot commit: session is in state '${session.state}', expected 'accepted'`,
      );
    }

    const now = new Date().toISOString();
    this.transitionLog.push({
      from: session.state,
      to: 'committed',
      trigger: 'commitment_proposal',
      timestamp: now,
    });

    session.state = 'committed';
    session.updatedAt = now;
    this.schedulePersist();
    return session;
  }

  /**
   * Remove a session.
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.schedulePersist();
  }

  /**
   * Load sessions from storage (when storage was provided to constructor).
   */
  async load(): Promise<void> {
    if (!this.storage) return;
    const stored = await this.storage.get<NegotiationSession[]>(SESSIONS_STORAGE_KEY);
    if (stored) {
      this.sessions.clear();
      for (const s of stored) {
        this.sessions.set(s.sessionId, s);
      }
    }
  }

  /**
   * Save sessions to storage (when storage was provided to constructor).
   * Flushes any pending debounced persist immediately.
   */
  async save(): Promise<void> {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persistSessions();
  }

  private schedulePersist(): void {
    if (!this.storage) return;
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistSessions().catch((e) => console.error('NegotiationStateMachine.persistSessions:', e));
    }, PERSIST_DEBOUNCE_MS);
  }

  private async persistSessions(): Promise<void> {
    if (!this.storage) return;
    await this.storage.set(SESSIONS_STORAGE_KEY, Array.from(this.sessions.values()));
  }

  /**
   * Cancel any pending persist timer (for cleanup / shutdown).
   */
  dispose(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  /**
   * Get the transition log for debugging.
   */
  getTransitionLog(): ReadonlyArray<StateTransition> {
    return this.transitionLog;
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private resolveTargetState(
    currentState: NegotiationState,
    messageType: AgentMessageType,
    sender: string,
    session: NegotiationSession,
  ): NegotiationState | null {
    // Special handling for initial state: determine if we're sending or receiving.
    // The VALID_TRANSITIONS table has two entries for 'initial' + 'negotiation_offer'
    // (one for send, one for receive), so we resolve the ambiguity here by checking
    // the sender identity rather than relying on TRANSITIONS.find().
    if (currentState === 'initial' && messageType === 'negotiation_offer') {
      return sender === session.myAgentId ? 'offer_sent' : 'offer_received';
    }

    // Look up in valid transitions table.
    // For non-initial states, each (from, via) pair is unique in the table.
    const transition = TRANSITIONS.find(
      (t) => t.from === currentState && t.via === messageType,
    );

    return transition?.to ?? null;
  }
}
