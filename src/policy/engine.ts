/**
 * AESP — Policy Engine
 *
 * Core policy engine that evaluates agent execution requests against policies.
 * Determines whether a request can be auto-approved or must be escalated.
 */

import type {
  AgentExecutionRequest,
  AgentExecutionResult,
  StorageAdapter,
} from '../types/index.js';
import { AESPError } from '../types/index.js';
import type {
  AgentPolicy,
  PolicyScope,
  IAgentPolicyProvider,
  IAgentPolicyEngine,
  AuditEntry,
  UsageSnapshot,
  IAgentAuditReader,
  BudgetCheckResult,
  CriticalPolicyChangeType,
  PolicyApprovalLevel,
  PolicyChangeClassification,
} from '../types/policy.js';
import { BudgetTracker } from './budget.js';
import { verifyXidentitySignature } from '../crypto/signing.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const POLICIES_STORAGE_KEY = 'aesp:policies';
const AUDIT_STORAGE_KEY = 'aesp:audit';
const MAX_AUDIT_LOG_SIZE = 10000;
const MAX_DECIMAL_PLACES = 18;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const AMOUNT_SCALE = 10n ** BigInt(MAX_DECIMAL_PLACES);

function amountToBigInt(value: unknown): bigint {
  return amountToBigIntNullable(value) ?? 0n;
}

function amountToBigIntNullable(value: unknown): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) return null;
    return BigInt(value) * AMOUNT_SCALE;
  }
  const s = String(value).trim();
  if (!AMOUNT_PATTERN.test(s)) return null;
  const [integer, fraction = ''] = s.split('.');
  if (fraction.length > MAX_DECIMAL_PLACES) return null;
  const normalized = `${integer}${fraction.padEnd(MAX_DECIMAL_PLACES, '0')}`;
  return BigInt(normalized);
}

function bigIntToAmount(value: bigint): string {
  if (value <= 0n) return '0';
  const integer = value / AMOUNT_SCALE;
  const fractionRaw = (value % AMOUNT_SCALE).toString().padStart(MAX_DECIMAL_PLACES, '0');
  const fraction = fractionRaw.replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer.toString();
}

function normalizeAmountToString(value: unknown): string {
  return bigIntToAmount(amountToBigInt(value));
}

/**
 * Scope broadness ranking — higher number = broader permissions.
 * Used by classifyPolicyChange to detect scope escalation.
 */
const SCOPE_RANK: Record<string, number> = {
  auto_payment: 1,
  negotiation: 2,
  commitment: 3,
  delegated_negotiation: 3,
  full: 10,
};

/**
 * Changes that require biometric-level approval (highest tier).
 * All others that require escalation default to 'review'.
 */
const BIOMETRIC_CHANGES: Set<CriticalPolicyChangeType> = new Set([
  'budget_increase',
  'scope_escalation',
  'allowlist_address_remove_all',
]);

/** Deterministic policy payload for signing/verification (canonical key order). */
function stringifyPolicyForVerification(policy: AgentPolicy): string {
  const obj: Record<string, unknown> = {
    agentId: policy.agentId,
    agentLabel: policy.agentLabel,
    conditions: policy.conditions,
    createdAt: policy.createdAt,
    escalation: policy.escalation,
    id: policy.id,
    scope: policy.scope,
  };
  if (policy.expiresAt !== undefined) obj.expiresAt = policy.expiresAt;
  if (policy.parentAgentId !== undefined) obj.parentAgentId = policy.parentAgentId;
  if (policy.vendorId !== undefined) obj.vendorId = policy.vendorId;
  const keys = Object.keys(obj).sort();
  const canonical: Record<string, unknown> = {};
  for (const k of keys) canonical[k] = obj[k];
  return JSON.stringify(canonical);
}

// ─── Policy Engine ───────────────────────────────────────────────────────────

export class PolicyEngine implements IAgentPolicyEngine, IAgentAuditReader {
  private providers: Map<string, IAgentPolicyProvider> = new Map();
  private policies: Map<string, AgentPolicy> = new Map();
  private auditLog: AuditEntry[] = [];
  private budgetTracker: BudgetTracker;

  constructor(private readonly storage: StorageAdapter) {
    this.budgetTracker = new BudgetTracker(storage);
  }

  // ─── Provider Management ─────────────────────────────────────────────────

  /**
   * Register a policy provider (vendor).
   */
  registerProvider(provider: IAgentPolicyProvider): void {
    this.providers.set(provider.vendorId, provider);

    // Subscribe to policy changes if supported
    if (provider.onPoliciesChanged) {
      provider.onPoliciesChanged(() => {
        this.refreshProviderPolicies(provider.vendorId).catch(console.error);
      });
    }
  }

  /**
   * Unregister a policy provider.
   */
  unregisterProvider(vendorId: string): void {
    this.providers.delete(vendorId);
  }

  // ─── Policy Management ───────────────────────────────────────────────────

  /**
   * Add a policy directly (without a provider).
   * If ownerXidentity is provided, verifies the policy signature.
   */
  addPolicy(policy: AgentPolicy, ownerXidentity?: string): void {
    if (ownerXidentity && policy.signature) {
      const policyPayload = stringifyPolicyForVerification(policy);
      const valid = verifyXidentitySignature(ownerXidentity, policyPayload, policy.signature);
      if (!valid) {
        throw new AESPError('Invalid policy signature', 'INVALID_POLICY_SIGNATURE');
      }
    }
    // Use vendorId-scoped key for consistency with load() and refreshProviderPolicies()
    const key = policy.vendorId ? `${policy.vendorId}:${policy.id}` : policy.id;
    this.policies.set(key, policy);
  }

  /**
   * Remove a policy by ID (removes all policies with this id, from any vendor).
   */
  removePolicy(policyId: string): void {
    // Collect keys first to avoid deleting during iteration
    const keysToDelete: string[] = [];
    for (const [key, p] of this.policies.entries()) {
      if (p.id === policyId) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.policies.delete(key);
    }
  }

  /**
   * Get all policies for an agent.
   */
  getPoliciesForAgent(agentId: string): AgentPolicy[] {
    return Array.from(this.policies.values()).filter((p) => p.agentId === agentId);
  }

  /**
   * Get a specific policy by ID (first match when multiple keys exist for same id).
   */
  getPolicy(policyId: string): AgentPolicy | undefined {
    return this.getPolicyById(policyId);
  }

  // ─── Auto-Approval Check ────────────────────────────────────────────────

  /**
   * Check if a request can be auto-approved under any active policy.
   *
   * Uses **disjunctive (OR) semantics**: the request is approved if *any*
   * matching policy permits it. Each policy grants a specific capability
   * (e.g., "pay up to 100 USDC to vendor X"), and an agent with multiple
   * policies receives the union of their permissions. A consequence is that
   * the most permissive matching policy determines the outcome.
   *
   * @returns The policy ID that allows auto-approval, or null if none.
   */
  async checkAutoApprove(request: AgentExecutionRequest): Promise<string | null> {
    // Refresh policies from all providers
    await this.refreshAllProviderPolicies();

    // Find matching policies
    const matchingPolicies = this.findMatchingPolicies(request);

    for (const policy of matchingPolicies) {
      const result = await this.evaluatePolicy(policy, request);
      if (result.allowed) {
        return policy.id;
      }
    }

    return null;
  }

  /**
   * Record the execution result for audit trail.
   */
  async recordExecution(
    requestId: string,
    policyId: string,
    result: AgentExecutionResult,
    request?: AgentExecutionRequest,
  ): Promise<void> {
    const policy = this.getPolicyById(policyId);

    // Always try to extract amount so getUsageToday has accurate data
    const amount = this.extractAmount(result, request);
    const amountBI = amountToBigInt(amount);
    const hasPositiveAmount = amountBI > 0n;

    const entry: AuditEntry = {
      requestId,
      policyId,
      vendorId: policy?.vendorId ?? policy?.agentId ?? 'unknown',
      action: request?.action.type ?? (result.txHash ? 'transfer' : 'sign_personal'),
      result,
      timestamp: Date.now(),
      ...(hasPositiveAmount ? { amount: bigIntToAmount(amountBI) } : {}),
    };

    this.auditLog.push(entry);

    // Trim audit log to prevent unbounded growth
    if (this.auditLog.length > MAX_AUDIT_LOG_SIZE) {
      this.auditLog = this.auditLog.slice(-MAX_AUDIT_LOG_SIZE);
    }

    // Update budget tracker if it was a transfer
    if (result.success && result.txHash && hasPositiveAmount && policy) {
      await this.budgetTracker.recordSpend(policy.agentId, {
        amount: bigIntToAmount(amountBI),
        timestamp: new Date().toISOString(),
        txHash: result.txHash,
        chain: 'unknown',
        method: 'transfer',
        requestId,
      });
    }

    // Persist audit log
    await this.storage.set(AUDIT_STORAGE_KEY, this.auditLog);
  }

  // ─── Audit Reader ────────────────────────────────────────────────────────

  async getExecutions(policyId: string, fromTs: number, toTs: number): Promise<AuditEntry[]> {
    return this.auditLog.filter(
      (e) => e.policyId === policyId && e.timestamp >= fromTs && e.timestamp <= toTs,
    );
  }

  async getUsageToday(policyId: string): Promise<UsageSnapshot> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const entries = await this.getExecutions(
      policyId,
      todayStart.getTime(),
      Date.now(),
    );

    const amountByToken: Record<string, string> = {};
    for (const entry of entries) {
      // Use stored amount first; fall back to extracting from result.
      // When amount is missing and not extractable, count 0 for the sum
      // but the entry still contributes to `count`.
      const amount = amountToBigInt(entry.amount ?? this.extractAmount(entry.result));
      const token = 'native'; // simplified
      amountByToken[token] = bigIntToAmount(
        amountToBigInt(amountByToken[token] ?? '0') + amount,
      );
    }

    return {
      policyId,
      amountByToken,
      count: entries.length,
    };
  }

  // ─── Budget Integration ──────────────────────────────────────────────────

  /**
   * Get budget tracker for direct access.
   */
  getBudgetTracker(): BudgetTracker {
    return this.budgetTracker;
  }

  // ─── Policy Change Classification ──────────────────────────────────────

  /**
   * Classify a proposed policy change against the existing policy.
   *
   * When updating a policy, call this method first to determine whether the
   * change requires escalated approval (e.g., user review or mobile biometric).
   *
   * If `existingPolicyId` is provided, the new policy is compared against it.
   * If the existing policy is not found (i.e., this is a brand-new policy),
   * the change is classified as non-critical (auto).
   *
   * @returns A classification with the required approval level and reasons.
   */
  classifyPolicyChange(
    newPolicy: AgentPolicy,
    existingPolicyId?: string,
  ): PolicyChangeClassification {
    const existing = existingPolicyId ? this.getPolicyById(existingPolicyId) : undefined;

    // Brand new policy — no existing reference to compare against
    if (!existing) {
      return {
        requiresEscalation: false,
        approvalLevel: 'auto',
        criticalChanges: [],
        reasons: [],
      };
    }

    const changes: CriticalPolicyChangeType[] = [];
    const reasons: string[] = [];
    const oldC = existing.conditions;
    const newC = newPolicy.conditions;

    // 1. Budget increases
    if (amountToBigInt(newC.maxAmountPerTx) > amountToBigInt(oldC.maxAmountPerTx)) {
      changes.push('budget_increase');
      reasons.push(
        `maxAmountPerTx: ${normalizeAmountToString(oldC.maxAmountPerTx)} → ${normalizeAmountToString(newC.maxAmountPerTx)}`,
      );
    }
    if (amountToBigInt(newC.maxAmountPerDay) > amountToBigInt(oldC.maxAmountPerDay)) {
      changes.push('budget_increase');
      reasons.push(
        `maxAmountPerDay: ${normalizeAmountToString(oldC.maxAmountPerDay)} → ${normalizeAmountToString(newC.maxAmountPerDay)}`,
      );
    }
    if (amountToBigInt(newC.maxAmountPerWeek) > amountToBigInt(oldC.maxAmountPerWeek)) {
      changes.push('budget_increase');
      reasons.push(
        `maxAmountPerWeek: ${normalizeAmountToString(oldC.maxAmountPerWeek)} → ${normalizeAmountToString(newC.maxAmountPerWeek)}`,
      );
    }
    if (amountToBigInt(newC.maxAmountPerMonth) > amountToBigInt(oldC.maxAmountPerMonth)) {
      changes.push('budget_increase');
      reasons.push(
        `maxAmountPerMonth: ${normalizeAmountToString(oldC.maxAmountPerMonth)} → ${normalizeAmountToString(newC.maxAmountPerMonth)}`,
      );
    }

    // 2. Allowlist changes
    const oldAddrs = new Set(oldC.allowListAddresses ?? []);
    const newAddrs = newC.allowListAddresses ?? [];
    if (oldAddrs.size > 0 && newAddrs.length === 0) {
      changes.push('allowlist_address_remove_all');
      reasons.push('Address allowlist cleared (was restricted, now open to all)');
    } else {
      for (const addr of newAddrs) {
        if (!oldAddrs.has(addr)) {
          changes.push('allowlist_address_add');
          reasons.push(`New address added to allowlist: ${addr}`);
        }
      }
    }

    // 3. Scope escalation
    const oldRank = SCOPE_RANK[existing.scope] ?? 0;
    const newRank = SCOPE_RANK[newPolicy.scope] ?? 0;
    if (newRank > oldRank) {
      changes.push('scope_escalation');
      reasons.push(`Scope broadened: ${existing.scope} → ${newPolicy.scope}`);
    }

    // 4. Time window removal
    if (oldC.timeWindow && !newC.timeWindow) {
      changes.push('time_window_remove');
      reasons.push(`Time window restriction removed (was ${oldC.timeWindow.start}-${oldC.timeWindow.end})`);
    }

    // 5. Min balance lowered
    if (amountToBigInt(newC.minBalanceAfter) < amountToBigInt(oldC.minBalanceAfter)) {
      changes.push('min_balance_lower');
      reasons.push(
        `minBalanceAfter lowered: ${normalizeAmountToString(oldC.minBalanceAfter)} → ${normalizeAmountToString(newC.minBalanceAfter)}`,
      );
    }

    // 6. First pay review disabled
    if (oldC.requireReviewBeforeFirstPay && !newC.requireReviewBeforeFirstPay) {
      changes.push('first_pay_review_disable');
      reasons.push('First-payment human review disabled');
    }

    // 7. Expiration extended or removed
    if (existing.expiresAt) {
      if (!newPolicy.expiresAt) {
        changes.push('expiration_extend');
        reasons.push(`Expiration removed (was ${existing.expiresAt})`);
      } else if (new Date(newPolicy.expiresAt) > new Date(existing.expiresAt)) {
        changes.push('expiration_extend');
        reasons.push(`Expiration extended: ${existing.expiresAt} → ${newPolicy.expiresAt}`);
      }
    }

    // Deduplicate changes
    const uniqueChanges = [...new Set(changes)];

    if (uniqueChanges.length === 0) {
      return {
        requiresEscalation: false,
        approvalLevel: 'auto',
        criticalChanges: [],
        reasons: [],
      };
    }

    // Determine approval level: biometric if any change is in BIOMETRIC_CHANGES
    const needsBiometric = uniqueChanges.some((c) => BIOMETRIC_CHANGES.has(c));
    const approvalLevel: PolicyApprovalLevel = needsBiometric ? 'biometric' : 'review';

    return {
      requiresEscalation: true,
      approvalLevel,
      criticalChanges: uniqueChanges,
      reasons,
    };
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  /**
   * Load policies and audit log from storage.
   */
  async load(): Promise<void> {
    const stored = await this.storage.get<AgentPolicy[]>(POLICIES_STORAGE_KEY);
    if (stored) {
      this.policies.clear();
      for (const p of stored) {
        const key = p.vendorId ? `${p.vendorId}:${p.id}` : p.id;
        this.policies.set(key, p);
      }
    }

    const audit = await this.storage.get<AuditEntry[]>(AUDIT_STORAGE_KEY);
    if (audit) {
      this.auditLog = audit;
    }

    await this.budgetTracker.load();
  }

  /**
   * Save policies to storage.
   */
  async save(): Promise<void> {
    await this.storage.set(
      POLICIES_STORAGE_KEY,
      Array.from(this.policies.values()),
    );
    await this.storage.set(AUDIT_STORAGE_KEY, this.auditLog);
    await this.budgetTracker.save();
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private findMatchingPolicies(request: AgentExecutionRequest): AgentPolicy[] {
    return Array.from(this.policies.values()).filter((policy) => {
      // Match by vendorId: if policy has a vendorId, it must match request.vendorId.
      // If policy has no vendorId, match policy.agentId against request.vendorId
      // (request.vendorId represents the requesting agent's identifier).
      if (request.vendorId) {
        const policyMatchId = policy.vendorId ?? policy.agentId;
        if (policyMatchId !== request.vendorId) return false;
      }

      // Check if policy matches the request's policy ID
      if (request.policyId && policy.id !== request.policyId) return false;

      // Check expiration
      if (policy.expiresAt && new Date(policy.expiresAt) < new Date()) return false;

      // Check scope matches action type
      return this.scopeMatchesAction(policy.scope, request.action.type);
    });
  }

  private scopeMatchesAction(scope: string, actionType: string): boolean {
    if (scope === 'full') return true;
    if (scope === 'auto_payment' && (actionType === 'transfer' || actionType === 'send_transaction')) return true;
    if ((scope === 'negotiation' || scope === 'delegated_negotiation') && actionType === 'sign_personal') return true;
    if (scope === 'commitment' && actionType === 'sign_typed_data') return true;
    return false;
  }

  private async evaluatePolicy(
    policy: AgentPolicy,
    request: AgentExecutionRequest,
  ): Promise<BudgetCheckResult> {
    const conditions = policy.conditions;
    const maxAmountPerTx = amountToBigInt(conditions.maxAmountPerTx);
    const maxAmountPerDay = amountToBigInt(conditions.maxAmountPerDay);
    const maxAmountPerWeek = amountToBigInt(conditions.maxAmountPerWeek);
    const maxAmountPerMonth = amountToBigInt(conditions.maxAmountPerMonth);
    const minBalanceAfter = amountToBigInt(conditions.minBalanceAfter);

    // Extract amount from request
    const amount = this.extractAmountFromRequest(request);

    if (
      (request.action.type === 'transfer' || request.action.type === 'send_transaction') &&
      amount <= 0n
    ) {
      return {
        allowed: false,
        remainingDaily: '0',
        remainingWeekly: '0',
        remainingMonthly: '0',
        violatedRule: 'amount',
        violatedActual: bigIntToAmount(amount),
        violatedLimit: '> 0',
      };
    }

    // 1. Check per-transaction limit
    if (amount > maxAmountPerTx) {
      return {
        allowed: false,
        remainingDaily: '0',
        remainingWeekly: '0',
        remainingMonthly: '0',
        violatedRule: 'maxAmountPerTx',
        violatedActual: bigIntToAmount(amount),
        violatedLimit: bigIntToAmount(maxAmountPerTx),
      };
    }

    // 2. Check time window
    if (conditions.timeWindow) {
      if (!this.isWithinTimeWindow(conditions.timeWindow)) {
        return {
          allowed: false,
          remainingDaily: '0',
          remainingWeekly: '0',
          remainingMonthly: '0',
          violatedRule: 'timeWindow',
          violatedActual: new Date().toTimeString().slice(0, 5),
          violatedLimit: `${conditions.timeWindow.start}-${conditions.timeWindow.end}`,
        };
      }
    }

    // 3. Check address allowlist
    const allowListAddresses = conditions.allowListAddresses ?? [];
    if (allowListAddresses.length > 0) {
      const toAddress = this.extractToAddress(request);
      if (toAddress && !allowListAddresses.includes(toAddress)) {
        return {
          allowed: false,
          remainingDaily: '0',
          remainingWeekly: '0',
          remainingMonthly: '0',
          violatedRule: 'allowListAddresses',
          violatedActual: toAddress,
          violatedLimit: 'not in allowlist',
        };
      }
    }

    // 4. Check chain allowlist
    const allowListChains = conditions.allowListChains ?? [];
    if (allowListChains.length > 0) {
      const chain = this.extractChain(request);
      if (chain && !allowListChains.includes(chain)) {
        return {
          allowed: false,
          remainingDaily: '0',
          remainingWeekly: '0',
          remainingMonthly: '0',
          violatedRule: 'allowListChains',
          violatedActual: chain,
          violatedLimit: 'not in allowlist',
        };
      }
    }

    // 5. Check method allowlist
    const allowListMethods = conditions.allowListMethods ?? [];
    if (allowListMethods.length > 0) {
      const method = this.extractMethod(request);
      if (!method || !allowListMethods.includes(method)) {
        return {
          allowed: false,
          remainingDaily: '0',
          remainingWeekly: '0',
          remainingMonthly: '0',
          violatedRule: 'allowListMethods',
          violatedActual: method ?? 'unknown',
          violatedLimit: 'not in allowlist',
        };
      }
    }

    // 6. First payment review requirement
    if (
      conditions.requireReviewBeforeFirstPay &&
      (request.action.type === 'transfer' || request.action.type === 'send_transaction') &&
      !this.hasPriorSuccessfulPayment(policy.id)
    ) {
      return {
        allowed: false,
        remainingDaily: '0',
        remainingWeekly: '0',
        remainingMonthly: '0',
        violatedRule: 'requireReviewBeforeFirstPay',
        violatedActual: 'first_payment',
        violatedLimit: 'review_required',
      };
    }

    // 7. Check min balance after spend when balance context is available
    if (minBalanceAfter > 0n) {
      const projectedBalance = this.extractProjectedBalanceAfter(request, amount);
      if (projectedBalance !== null && projectedBalance < minBalanceAfter) {
        return {
          allowed: false,
          remainingDaily: '0',
          remainingWeekly: '0',
          remainingMonthly: '0',
          violatedRule: 'minBalanceAfter',
          violatedActual: bigIntToAmount(projectedBalance),
          violatedLimit: bigIntToAmount(minBalanceAfter),
        };
      }
    }

    // 8. Check budget limits (pass normalized conditions for limits)
    const normalizedConditions = {
      ...conditions,
      maxAmountPerTx: bigIntToAmount(maxAmountPerTx),
      maxAmountPerDay: bigIntToAmount(maxAmountPerDay),
      maxAmountPerWeek: bigIntToAmount(maxAmountPerWeek),
      maxAmountPerMonth: bigIntToAmount(maxAmountPerMonth),
      minBalanceAfter: bigIntToAmount(minBalanceAfter),
    };
    const budgetResult = await this.budgetTracker.checkBudget(
      policy.agentId,
      bigIntToAmount(amount),
      normalizedConditions,
    );

    return budgetResult;
  }

  private isWithinTimeWindow(window: { start: string; end: string }): boolean {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const startMinutes = this.parseTimeToMinutes(window.start);
    const endMinutes = this.parseTimeToMinutes(window.end);
    if (startMinutes === null || endMinutes === null) return false;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    // Wrap around midnight
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }

  /** Parse "HH:MM" or "H:MM" to minutes since midnight; null if invalid. */
  private parseTimeToMinutes(time: string): number | null {
    if (!time || typeof time !== 'string') return null;
    const parts = time.trim().split(':');
    if (parts.length !== 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59 || h < 0 || h > 23) return null;
    return h * 60 + m;
  }

  private extractAmountFromRequest(request: AgentExecutionRequest): bigint {
    const { action } = request;
    if (action.type === 'transfer') {
      return amountToBigIntNullable(action.payload.amount) ?? -1n;
    }
    if (action.type === 'send_transaction') {
      return amountToBigIntNullable(action.payload.value) ?? -1n;
    }
    return 0n;
  }

  private extractToAddress(request: AgentExecutionRequest): string | null {
    const { action } = request;
    if (action.type === 'transfer') return action.payload.toAddress;
    if (action.type === 'send_transaction') return action.payload.to;
    return null;
  }

  private extractChain(request: AgentExecutionRequest): string | null {
    const { action } = request;
    if (action.type === 'transfer') return action.payload.chainId;
    if (action.type === 'send_transaction') return action.payload.chainId;
    if (action.type === 'sign_typed_data') return action.payload.chainId ?? null;
    return null;
  }

  private extractMethod(request: AgentExecutionRequest): string | null {
    const { action } = request;
    if (action.type === 'send_transaction') {
      const payload = action.payload as { method?: string };
      return payload.method ?? 'send_transaction';
    }
    return action.type;
  }

  private hasPriorSuccessfulPayment(policyId: string): boolean {
    return this.auditLog.some(
      (entry) =>
        entry.policyId === policyId &&
        entry.result.success &&
        (entry.action === 'transfer' || entry.action === 'send_transaction'),
    );
  }

  private extractProjectedBalanceAfter(
    request: AgentExecutionRequest,
    amount: bigint,
  ): bigint | null {
    const payload = request.action.payload as unknown as Record<string, unknown>;
    const candidates = [
      payload.currentBalance,
      payload.balance,
      payload.balanceBefore,
    ];
    const balanceBefore = candidates
      .map(amountToBigIntNullable)
      .find((x) => x !== null && x >= 0n) ?? null;

    if (balanceBefore === null) return null;
    return balanceBefore - amount;
  }

  private extractAmount(
    result: AgentExecutionResult,
    request?: AgentExecutionRequest,
  ): bigint {
    if (request) {
      return this.extractAmountFromRequest(request);
    }

    const amount = (result as unknown as Record<string, unknown>).amount;
    return amountToBigInt(
      amount ?? (result as unknown as Record<string, unknown>).value,
    );
  }

  private getPolicyById(policyId: string): AgentPolicy | undefined {
    return Array.from(this.policies.values()).find((p) => p.id === policyId);
  }

  private async refreshProviderPolicies(vendorId: string): Promise<void> {
    const provider = this.providers.get(vendorId);
    if (!provider) return;

    // Remove existing policies from this vendor to avoid stale entries
    const staleKeys: string[] = [];
    for (const [key, p] of this.policies.entries()) {
      if (p.vendorId === vendorId) staleKeys.push(key);
    }
    for (const key of staleKeys) {
      this.policies.delete(key);
    }

    for (const scope of ['auto_payment', 'delegated_negotiation', 'commitment'] as PolicyScope[]) {
      try {
        const policies = await provider.getPolicies(scope);
        for (const policy of policies) {
          const withVendor = { ...policy, vendorId };
          this.policies.set(`${vendorId}:${policy.id}`, withVendor);
        }
      } catch (error) {
        console.error(`Failed to refresh policies from ${vendorId}:`, error);
      }
    }
  }

  private async refreshAllProviderPolicies(): Promise<void> {
    const promises = Array.from(this.providers.keys()).map((id) =>
      this.refreshProviderPolicies(id),
    );
    await Promise.allSettled(promises);
  }
}
