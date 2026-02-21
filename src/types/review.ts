/**
 * AESP — Review Types
 *
 * ReviewRequest protocol for human-in-the-loop approval.
 */

import type { UUID, ISOTimestamp, ChainId, UrgencyLevel } from './common.js';

// ─── Review Request ──────────────────────────────────────────────────────────

export type ReviewAction =
  | 'transfer'
  | 'sign'
  | 'approve'
  | 'negotiate'
  | 'commitment';

export interface ReviewRequestDetails {
  chain: ChainId;
  to: string;
  amount: string;
  currency: string;
  method?: string;
  context?: string;
}

export interface PolicyViolation {
  rule: string;
  actual: string;
  limit: string;
}

export interface ReviewRequest {
  requestId: UUID;
  agentId: string;
  agentLabel: string;
  action: ReviewAction;
  summary: string;
  details: ReviewRequestDetails;
  policyViolation: PolicyViolation;
  urgency: UrgencyLevel;
  deadline: ISOTimestamp;
  escalatedFrom?: string;
  createdAt: ISOTimestamp;
}

// ─── Review Response ─────────────────────────────────────────────────────────

export type ReviewDecision = 'approve' | 'reject' | 'modify';

export interface ReviewResponse {
  requestId: UUID;
  decision: ReviewDecision;
  modifiedAmount?: string;
  modifiedConditions?: Record<string, unknown>;
  respondedAt: ISOTimestamp;
  respondedVia: 'mobile' | 'extension' | 'api';
  biometricVerified: boolean;
}

// ─── Emergency Freeze ────────────────────────────────────────────────────────

export interface EmergencyFreezeRequest {
  agentId: string;
  reason: string;
  initiatedBy: 'human' | 'policy_engine' | 'parent_agent';
  freezeAt: ISOTimestamp;
}

export interface EmergencyFreezeStatus {
  agentId: string;
  frozen: boolean;
  reason?: string;
  frozenAt?: ISOTimestamp;
  frozenBy?: string;
}

// ─── Review Queue ────────────────────────────────────────────────────────────

export interface ReviewQueueItem {
  request: ReviewRequest;
  response?: ReviewResponse;
  status: 'pending' | 'responded' | 'expired' | 'escalated';
  queuedAt: ISOTimestamp;
}
