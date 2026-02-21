/**
 * AESP — Negotiation Types
 *
 * Negotiation protocol state machine, sessions, and round definitions.
 */

import type {
  UUID,
  ISOTimestamp,
  AgentMessageType,
} from './common.js';
import type { EIP712Commitment } from './commitment.js';

// ─── Negotiation State ───────────────────────────────────────────────────────

export type NegotiationState =
  | 'initial'
  | 'offer_sent'
  | 'offer_received'
  | 'countering'
  | 'accepted'
  | 'rejected'
  | 'committed'
  | 'disputed';

// ─── Offer / Counter ─────────────────────────────────────────────────────────

export interface NegotiationOffer {
  item: string;
  description?: string;
  price: string;
  currency: string;
  terms: string[];
  deadline: ISOTimestamp;
  metadata?: Record<string, unknown>;
}

export interface NegotiationCounterOffer {
  item: string;
  counterPrice: string;
  currency: string;
  counterTerms: string[];
  reason?: string;
  deadline: ISOTimestamp;
}

export interface NegotiationAcceptance {
  agreementHash: string;
  acceptedPrice: string;
  acceptedTerms: string[];
}

export interface NegotiationRejection {
  reason: string;
  finalOffer?: NegotiationOffer;
}

// ─── Negotiation Round ───────────────────────────────────────────────────────

export interface NegotiationRound {
  roundNumber: number;
  sender: string;
  messageType: AgentMessageType;
  payload: NegotiationOffer | NegotiationCounterOffer | NegotiationAcceptance | NegotiationRejection;
  encryptedArweaveId?: string;
  timestamp: ISOTimestamp;
}

// ─── Negotiation Session ─────────────────────────────────────────────────────

export interface NegotiationSession {
  sessionId: UUID;
  myAgentId: string;
  counterpartyAgentId: string;
  state: NegotiationState;
  rounds: NegotiationRound[];
  maxRounds: number;
  commitment?: EIP712Commitment;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  expiresAt?: ISOTimestamp;
}

// ─── State Transitions ───────────────────────────────────────────────────────

export interface StateTransition {
  from: NegotiationState;
  to: NegotiationState;
  trigger: AgentMessageType;
  timestamp: ISOTimestamp;
}

/** Valid state transitions for the negotiation FSM */
export const VALID_TRANSITIONS: ReadonlyArray<{ from: NegotiationState; to: NegotiationState; via: AgentMessageType }> = [
  { from: 'initial',        to: 'offer_sent',     via: 'negotiation_offer' },
  { from: 'initial',        to: 'offer_received',  via: 'negotiation_offer' },
  { from: 'offer_sent',     to: 'countering',      via: 'negotiation_counter' },
  { from: 'offer_sent',     to: 'accepted',        via: 'negotiation_accept' },
  { from: 'offer_sent',     to: 'rejected',        via: 'negotiation_reject' },
  { from: 'offer_received', to: 'countering',      via: 'negotiation_counter' },
  { from: 'offer_received', to: 'accepted',        via: 'negotiation_accept' },
  { from: 'offer_received', to: 'rejected',        via: 'negotiation_reject' },
  { from: 'countering',     to: 'countering',      via: 'negotiation_counter' },
  { from: 'countering',     to: 'accepted',        via: 'negotiation_accept' },
  { from: 'countering',     to: 'rejected',        via: 'negotiation_reject' },
  { from: 'accepted',       to: 'committed',       via: 'commitment_proposal' },
  { from: 'committed',      to: 'disputed',        via: 'dispute_evidence' },
] as const;
