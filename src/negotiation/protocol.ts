/**
 * AESP — Negotiation Protocol
 *
 * High-level negotiation protocol that orchestrates the state machine,
 * E2EE messaging, and policy checks for agent-to-agent negotiations.
 */

import type {
  AgentMessage,
  AgentMessageType,
  StorageAdapter,
} from '../types/index.js';
import { NegotiationError } from '../types/index.js';
import type {
  NegotiationSession,
  NegotiationOffer,
  NegotiationCounterOffer,
  NegotiationAcceptance,
  NegotiationRejection,
} from '../types/negotiation.js';
import type { EIP712Commitment } from '../types/commitment.js';
import { NegotiationStateMachine } from './state-machine.js';
import { generateUUID, sha256 } from '../crypto/hashing.js';
import { verifyXidentitySignature } from '../crypto/signing.js';

// ─── Message Handler Interface ───────────────────────────────────────────────

export interface NegotiationMessageSender {
  send(recipientXidentity: string, message: AgentMessage): Promise<void>;
}

export interface NegotiationMessageSigner {
  sign(messageContent: string): string;
}

// ─── Negotiation Protocol ────────────────────────────────────────────────────

export class NegotiationProtocol {
  private stateMachine: NegotiationStateMachine;
  private messageSender?: NegotiationMessageSender;
  private messageSigner?: NegotiationMessageSigner;

  constructor(
    storage: StorageAdapter,
    private readonly myAgentId: string,
    private readonly myXidentity: string,
  ) {
    this.stateMachine = new NegotiationStateMachine(storage);
  }

  /**
   * Set the message sender for E2EE communication.
   */
  setMessageSender(sender: NegotiationMessageSender): void {
    this.messageSender = sender;
  }

  /**
   * Set the message signer used for detached signatures.
   */
  setMessageSigner(signer: NegotiationMessageSigner): void {
    this.messageSigner = signer;
  }

  /**
   * Load sessions from storage.
   */
  async load(): Promise<void> {
    await this.stateMachine.load();
  }

  // ─── Session Management ──────────────────────────────────────────────

  /**
   * Start a new negotiation with a counterparty.
   */
  async startNegotiation(params: {
    counterpartyAgentId: string;
    counterpartyXidentity: string;
    offer: NegotiationOffer;
    maxRounds?: number;
  }): Promise<NegotiationSession> {
    const session = this.stateMachine.createSession({
      myAgentId: this.myAgentId,
      counterpartyAgentId: params.counterpartyAgentId,
      maxRounds: params.maxRounds,
    });

    // Transition to offer_sent
    this.stateMachine.sendOffer(session.sessionId, this.myAgentId, params.offer);

    // Send encrypted message to counterparty
    if (this.messageSender) {
      const message: AgentMessage = {
        id: generateUUID(),
        type: 'negotiation_offer',
        senderXidentity: this.myXidentity,
        recipientXidentity: params.counterpartyXidentity,
        payload: {
          sessionId: session.sessionId,
          senderAgentId: this.myAgentId,
          offer: params.offer,
        },
        timestamp: Date.now(),
        threadId: session.sessionId,
      };
      message.signature = this.signOutgoingMessage(message);
      await this.messageSender.send(params.counterpartyXidentity, message);
    }

    await this.persistSessions();
    return session;
  }

  /**
   * Respond with a counter-offer.
   */
  async sendCounterOffer(
    sessionId: string,
    counterOffer: NegotiationCounterOffer,
    counterpartyXidentity: string,
  ): Promise<NegotiationSession> {
    const session = this.stateMachine.sendCounter(
      sessionId,
      this.myAgentId,
      counterOffer,
    );

    if (this.messageSender) {
      const message: AgentMessage = {
        id: generateUUID(),
        type: 'negotiation_counter',
        senderXidentity: this.myXidentity,
        recipientXidentity: counterpartyXidentity,
        payload: {
          sessionId,
          senderAgentId: this.myAgentId,
          counterOffer,
        },
        timestamp: Date.now(),
        threadId: sessionId,
      };
      message.signature = this.signOutgoingMessage(message);
      await this.messageSender.send(counterpartyXidentity, message);
    }

    await this.persistSessions();
    return session;
  }

  /**
   * Accept the current offer/counter-offer.
   */
  async acceptOffer(
    sessionId: string,
    counterpartyXidentity: string,
  ): Promise<NegotiationSession> {
    const session = this.stateMachine.getSession(sessionId);
    if (!session) throw new NegotiationError(`Session ${sessionId} not found`);

    // Compute agreement hash from the last round's payload
    const lastRound = session.rounds[session.rounds.length - 1];
    const agreementHash = await sha256(JSON.stringify(lastRound.payload));

    const lastOffer = lastRound.payload as NegotiationOffer | NegotiationCounterOffer;
    const acceptedPrice = 'price' in lastOffer
      ? lastOffer.price
      : 'counterPrice' in lastOffer
        ? lastOffer.counterPrice
        : '0';
    const acceptedTerms = 'terms' in lastOffer
      ? lastOffer.terms
      : 'counterTerms' in lastOffer
        ? lastOffer.counterTerms
        : [];

    const acceptance: NegotiationAcceptance = {
      agreementHash,
      acceptedPrice,
      acceptedTerms,
    };

    const updated = this.stateMachine.accept(sessionId, this.myAgentId, acceptance);

    if (this.messageSender) {
      const message: AgentMessage = {
        id: generateUUID(),
        type: 'negotiation_accept',
        senderXidentity: this.myXidentity,
        recipientXidentity: counterpartyXidentity,
        payload: {
          sessionId,
          senderAgentId: this.myAgentId,
          acceptance,
        },
        timestamp: Date.now(),
        threadId: sessionId,
      };
      message.signature = this.signOutgoingMessage(message);
      await this.messageSender.send(counterpartyXidentity, message);
    }

    await this.persistSessions();
    return updated;
  }

  /**
   * Reject the negotiation.
   */
  async rejectOffer(
    sessionId: string,
    reason: string,
    counterpartyXidentity: string,
  ): Promise<NegotiationSession> {
    const rejection: NegotiationRejection = { reason };
    const updated = this.stateMachine.reject(sessionId, this.myAgentId, rejection);

    if (this.messageSender) {
      const message: AgentMessage = {
        id: generateUUID(),
        type: 'negotiation_reject',
        senderXidentity: this.myXidentity,
        recipientXidentity: counterpartyXidentity,
        payload: {
          sessionId,
          senderAgentId: this.myAgentId,
          rejection,
        },
        timestamp: Date.now(),
        threadId: sessionId,
      };
      message.signature = this.signOutgoingMessage(message);
      await this.messageSender.send(counterpartyXidentity, message);
    }

    await this.persistSessions();
    return updated;
  }

  // ─── Incoming Message Handling ─────────────────────────────────────────

  /**
   * Handle an incoming negotiation message from a counterparty.
   */
  async handleIncomingMessage(
    message: AgentMessage,
  ): Promise<NegotiationSession | null> {
    if (!message.payload || typeof message.payload !== 'object') {
      throw new NegotiationError('Incoming message payload must be an object');
    }

    if (!message.senderXidentity) {
      throw new NegotiationError('Incoming message missing senderXidentity');
    }
    if (!message.signature || typeof message.signature !== 'string') {
      throw new NegotiationError('Incoming message missing signature');
    }
    const valid = verifyXidentitySignature(
      message.senderXidentity,
      this.serializeMessageForSignature(message),
      message.signature,
    );
    if (!valid) {
      throw new NegotiationError('Invalid sender signature on incoming message');
    }

    const payload = message.payload as Record<string, unknown>;
    let updated: NegotiationSession | null = null;

    switch (message.type as AgentMessageType) {
      case 'negotiation_offer': {
        const sessionId = payload.sessionId;
        const senderAgentId = payload.senderAgentId;
        if (!sessionId || typeof sessionId !== 'string') {
          throw new NegotiationError('Incoming offer missing sessionId');
        }
        if (!senderAgentId || typeof senderAgentId !== 'string') {
          throw new NegotiationError('Incoming offer missing senderAgentId');
        }

        // If session doesn't exist, create one (we're the responder)
        let session = this.stateMachine.getSession(sessionId);
        if (!session) {
          session = this.stateMachine.createSession({
            sessionId,
            myAgentId: this.myAgentId,
            counterpartyAgentId: senderAgentId,
          });
        }
        if (session.counterpartyAgentId !== senderAgentId) {
          throw new NegotiationError(
            `Sender agent mismatch for session ${sessionId}: expected ${session.counterpartyAgentId}, got ${senderAgentId}`,
          );
        }
        updated = this.stateMachine.receiveOffer(
          session.sessionId,
          senderAgentId,
          payload.offer as NegotiationOffer,
        );
        break;
      }

      case 'negotiation_counter': {
        const sessionId = payload.sessionId;
        const senderAgentId = payload.senderAgentId;
        if (!sessionId || typeof sessionId !== 'string') {
          throw new NegotiationError('Incoming counter-offer missing sessionId');
        }
        if (!senderAgentId || typeof senderAgentId !== 'string') {
          throw new NegotiationError('Incoming counter-offer missing senderAgentId');
        }
        this.assertIncomingSenderAgent(sessionId, senderAgentId);
        updated = this.stateMachine.sendCounter(
          sessionId,
          senderAgentId,
          payload.counterOffer as NegotiationCounterOffer,
        );
        break;
      }

      case 'negotiation_accept': {
        const sessionId = payload.sessionId;
        const senderAgentId = payload.senderAgentId;
        if (!sessionId || typeof sessionId !== 'string') {
          throw new NegotiationError('Incoming acceptance missing sessionId');
        }
        if (!senderAgentId || typeof senderAgentId !== 'string') {
          throw new NegotiationError('Incoming acceptance missing senderAgentId');
        }
        this.assertIncomingSenderAgent(sessionId, senderAgentId);
        updated = this.stateMachine.accept(
          sessionId,
          senderAgentId,
          payload.acceptance as NegotiationAcceptance,
        );
        break;
      }

      case 'negotiation_reject': {
        const sessionId = payload.sessionId;
        const senderAgentId = payload.senderAgentId;
        if (!sessionId || typeof sessionId !== 'string') {
          throw new NegotiationError('Incoming rejection missing sessionId');
        }
        if (!senderAgentId || typeof senderAgentId !== 'string') {
          throw new NegotiationError('Incoming rejection missing senderAgentId');
        }
        this.assertIncomingSenderAgent(sessionId, senderAgentId);
        updated = this.stateMachine.reject(
          sessionId,
          senderAgentId,
          payload.rejection as NegotiationRejection,
        );
        break;
      }

      default:
        return null;
    }

    if (updated) {
      await this.persistSessions();
    }

    return updated;
  }

  // ─── Commitment Integration ────────────────────────────────────────────

  /**
   * Attach an EIP-712 commitment to an accepted session.
   */
  attachCommitment(sessionId: string, commitment: EIP712Commitment): NegotiationSession {
    const session = this.stateMachine.getSession(sessionId);
    if (!session) throw new NegotiationError(`Session ${sessionId} not found`);
    if (session.state !== 'accepted') {
      throw new NegotiationError(`Cannot attach commitment: session state is '${session.state}'`);
    }

    session.commitment = commitment;
    return this.stateMachine.markCommitted(sessionId);
  }

  // ─── Queries ───────────────────────────────────────────────────────────

  getSession(sessionId: string): NegotiationSession | undefined {
    return this.stateMachine.getSession(sessionId);
  }

  getActiveSessions(): NegotiationSession[] {
    return this.stateMachine.getActiveSessions();
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  private async persistSessions(): Promise<void> {
    await this.stateMachine.save();
  }

  private signOutgoingMessage(message: AgentMessage): string {
    if (!this.messageSigner) {
      throw new NegotiationError('Message signer not configured');
    }
    return this.messageSigner.sign(this.serializeMessageForSignature(message));
  }

  private serializeMessageForSignature(message: AgentMessage): string {
    return JSON.stringify({
      type: message.type,
      threadId: message.threadId ?? null,
      payload: message.payload,
    });
  }

  private assertIncomingSenderAgent(sessionId: string, senderAgentId: string): void {
    const session = this.stateMachine.getSession(sessionId);
    if (!session) {
      throw new NegotiationError(`Session ${sessionId} not found`);
    }
    if (
      senderAgentId !== session.counterpartyAgentId &&
      senderAgentId !== session.myAgentId
    ) {
      throw new NegotiationError(
        `Unauthorized sender agent '${senderAgentId}' for session ${sessionId}`,
      );
    }
  }
}
