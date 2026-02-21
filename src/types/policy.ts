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
