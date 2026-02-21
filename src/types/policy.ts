/**
 * AESP — Policy Types
 *
 * Agent policy definitions, conditions, and budget tracking interfaces.
 */

import type {
  UUID,
  ISOTimestamp,
  HexString,
  ChainId,
  AgentScope,
  EscalationAction,
  AgentExecutionRequest,
  AgentExecutionResult,
  ExecutionAction,
} from './common.js';

// ─── Policy ──────────────────────────────────────────────────────────────────

export interface PolicyConditions {
  maxAmountPerTx: number;
  maxAmountPerDay: number;
  maxAmountPerWeek: number;
  maxAmountPerMonth: number;
  allowListAddresses: string[];
  allowListChains: ChainId[];
  allowListMethods: string[];
  minBalanceAfter: number;
  requireReviewBeforeFirstPay: boolean;
  timeWindow?: {
    start: string;    // HH:MM format
    end: string;      // HH:MM format
  };
}

export interface AgentPolicy {
  id: UUID;
  agentId: string;
  agentLabel: string;
  scope: AgentScope;
  conditions: PolicyConditions;
  escalation: EscalationAction;
  parentAgentId?: string;
  /** Set when policy is from a provider; used to avoid cross-vendor overwrites */
  vendorId?: string;
  createdAt: ISOTimestamp;
  expiresAt?: ISOTimestamp;
  signature: HexString;
}

// ─── Budget ──────────────────────────────────────────────────────────────────

export interface BudgetTransaction {
  amount: number;
  timestamp: ISOTimestamp;
  txHash: string;
  chain: ChainId;
  method: string;
  requestId: UUID;
}

export interface AgentBudgetTracker {
  agentId: string;
  dailySpent: number;
  weeklySpent: number;
  monthlySpent: number;
  lastResetDaily: ISOTimestamp;
  lastResetWeekly: ISOTimestamp;
  lastResetMonthly: ISOTimestamp;
  transactions: BudgetTransaction[];
}

export interface BudgetCheckResult {
  allowed: boolean;
  remainingDaily: number;
  remainingWeekly: number;
  remainingMonthly: number;
  violatedRule?: string;
  violatedActual?: string;
  violatedLimit?: string;
}

// ─── Policy Engine Interfaces ────────────────────────────────────────────────

export type PolicyScope = 'auto_payment' | 'delegated_negotiation' | 'commitment';

export interface PolicyContext {
  origin?: string;
  toAddress?: string;
  recipientXidentity?: string;
  amount?: string;
  token?: string;
  chainId?: ChainId;
  messageType?: string;
  currentTime?: Date;
}

export interface IAgentPolicyProvider {
  readonly vendorId: string;
  getPolicies(scope: PolicyScope, context?: PolicyContext): Promise<AgentPolicy[]>;
  onPoliciesChanged?(callback: () => void): void;
}

export interface IAgentPolicyEngine {
  registerProvider(provider: IAgentPolicyProvider): void;
  checkAutoApprove(request: AgentExecutionRequest): Promise<string | null>;
  recordExecution(
    requestId: string,
    policyId: string,
    result: AgentExecutionResult,
    request?: AgentExecutionRequest,
  ): Promise<void>;
}

// ─── Critical Policy Change Classification ──────────────────────────────────

/**
 * Categories of policy changes that require elevated approval.
 *
 * - `budget_increase`: Raising any spending limit (per-tx, daily, weekly, monthly).
 * - `allowlist_address_add`: Adding a new address to the allow list.
 * - `allowlist_address_remove_all`: Clearing the allow list entirely (opens to all).
 * - `scope_escalation`: Changing scope to a broader level (e.g., auto_payment → full).
 * - `time_window_remove`: Removing a time-window restriction.
 * - `min_balance_lower`: Lowering the minimum post-spend balance requirement.
 * - `first_pay_review_disable`: Disabling first-payment human review.
 * - `expiration_extend`: Extending or removing a policy expiration date.
 */
export type CriticalPolicyChangeType =
  | 'budget_increase'
  | 'allowlist_address_add'
  | 'allowlist_address_remove_all'
  | 'scope_escalation'
  | 'time_window_remove'
  | 'min_balance_lower'
  | 'first_pay_review_disable'
  | 'expiration_extend';

/**
 * Approval level required for a policy change.
 *
 * - `auto`:      No escalation needed; change is non-critical.
 * - `review`:    Change should be displayed to the user for confirmation.
 * - `biometric`: Change requires mobile biometric (Face ID / fingerprint) confirmation.
 */
export type PolicyApprovalLevel = 'auto' | 'review' | 'biometric';

/**
 * Result of classifying a policy change against the existing policy.
 */
export interface PolicyChangeClassification {
  /** Whether the change requires escalation beyond auto-approval. */
  requiresEscalation: boolean;
  /** The highest approval level needed. */
  approvalLevel: PolicyApprovalLevel;
  /** List of detected critical changes. */
  criticalChanges: CriticalPolicyChangeType[];
  /** Human-readable reasons for escalation. */
  reasons: string[];
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  requestId: UUID;
  policyId: UUID;
  vendorId: string;
  action: ExecutionAction['type'];
  result: AgentExecutionResult;
  timestamp: number;
  /** Amount for transfer/send_transaction; used by getUsageToday when set */
  amount?: number;
}

export interface UsageSnapshot {
  policyId: UUID;
  amountByToken: Record<string, string>;
  count: number;
}

export interface IAgentAuditReader {
  getExecutions(policyId: string, fromTs: number, toTs: number): Promise<AuditEntry[]>;
  getUsageToday(policyId: string): Promise<UsageSnapshot>;
}
