/**
 * AESP — Policy Module Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockWasm, teardownMockWasm, MockStorage } from './helpers.js';
import { PolicyEngine } from '../src/policy/engine.js';
import { BudgetTracker } from '../src/policy/budget.js';
import type { AgentPolicy, PolicyConditions } from '../src/types/policy.js';
import type { AgentExecutionRequest } from '../src/types/common.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTestPolicy(overrides: Partial<AgentPolicy> = {}): AgentPolicy {
  return {
    id: 'policy-1',
    agentId: 'agent-1',
    agentLabel: 'Test Agent',
    scope: 'auto_payment',
    conditions: {
      maxAmountPerTx: 100,
      maxAmountPerDay: 500,
      maxAmountPerWeek: 2000,
      maxAmountPerMonth: 5000,
      allowListAddresses: [],
      allowListChains: [],
      allowListMethods: [],
      minBalanceAfter: 10,
      requireReviewBeforeFirstPay: false,
    },
    escalation: 'ask_human',
    createdAt: new Date().toISOString(),
    signature: 'mock_signature',
    ...overrides,
  };
}

function createTestRequest(overrides: Partial<AgentExecutionRequest> = {}): AgentExecutionRequest {
  return {
    requestId: 'req-1',
    vendorId: 'agent-1',
    action: {
      type: 'transfer',
      payload: {
        chainId: 'solana',
        token: 'native',
        toAddress: 'So1ana1111111111111111111111111111111111111',
        amount: '50',
      },
    },
    ...overrides,
  };
}

describe('Policy Module', () => {
  let storage: MockStorage;

  beforeEach(() => {
    setupMockWasm();
    storage = new MockStorage();
  });

  afterEach(() => {
    teardownMockWasm();
  });

  // ─── Policy Engine ──────────────────────────────────────────────────────

  describe('PolicyEngine', () => {
    let engine: PolicyEngine;

    beforeEach(() => {
      engine = new PolicyEngine(storage);
    });

    it('should add and retrieve policies', () => {
      const policy = createTestPolicy();
      engine.addPolicy(policy);

      const retrieved = engine.getPolicy('policy-1');
      expect(retrieved).toEqual(policy);
    });

    it('should get policies for agent', () => {
      engine.addPolicy(createTestPolicy({ id: 'p1', agentId: 'agent-1' }));
      engine.addPolicy(createTestPolicy({ id: 'p2', agentId: 'agent-1' }));
      engine.addPolicy(createTestPolicy({ id: 'p3', agentId: 'agent-2' }));

      const policies = engine.getPoliciesForAgent('agent-1');
      expect(policies.length).toBe(2);
    });

    it('should auto-approve request within policy limits', async () => {
      engine.addPolicy(createTestPolicy());

      const request = createTestRequest();
      const policyId = await engine.checkAutoApprove(request);

      expect(policyId).toBe('policy-1');
    });

    it('should reject request exceeding per-tx limit', async () => {
      engine.addPolicy(createTestPolicy());

      const request = createTestRequest({
        action: {
          type: 'transfer',
          payload: {
            chainId: 'solana',
            token: 'native',
            toAddress: 'addr',
            amount: '150', // exceeds maxAmountPerTx: 100
          },
        },
      });

      const policyId = await engine.checkAutoApprove(request);
      expect(policyId).toBeNull();
    });

    it('should reject request with unsafe-large amount', async () => {
      engine.addPolicy(createTestPolicy({
        conditions: {
          ...createTestPolicy().conditions,
          maxAmountPerTx: Number.MAX_SAFE_INTEGER,
          maxAmountPerDay: Number.MAX_SAFE_INTEGER,
          maxAmountPerWeek: Number.MAX_SAFE_INTEGER,
          maxAmountPerMonth: Number.MAX_SAFE_INTEGER,
          minBalanceAfter: 0,
        },
      }));

      const request = createTestRequest({
        action: {
          type: 'transfer',
          payload: {
            chainId: 'solana',
            token: 'native',
            toAddress: 'addr',
            amount: '9007199254740993',
          },
        },
      });

      const policyId = await engine.checkAutoApprove(request);
      expect(policyId).toBeNull();
    });

    it('should reject request to non-allowlisted address', async () => {
      engine.addPolicy(
        createTestPolicy({
          conditions: {
            ...createTestPolicy().conditions,
            allowListAddresses: ['allowed_addr_1', 'allowed_addr_2'],
          },
        }),
      );

      const request = createTestRequest({
        action: {
          type: 'transfer',
          payload: {
            chainId: 'solana',
            token: 'native',
            toAddress: 'not_allowed_addr',
            amount: '50',
          },
        },
      });

      const policyId = await engine.checkAutoApprove(request);
      expect(policyId).toBeNull();
    });

    it('should approve request to allowlisted address', async () => {
      engine.addPolicy(
        createTestPolicy({
          conditions: {
            ...createTestPolicy().conditions,
            allowListAddresses: ['allowed_addr'],
          },
        }),
      );

      const request = createTestRequest({
        action: {
          type: 'transfer',
          payload: {
            chainId: 'solana',
            token: 'native',
            toAddress: 'allowed_addr',
            amount: '50',
          },
        },
      });

      const policyId = await engine.checkAutoApprove(request);
      expect(policyId).toBe('policy-1');
    });

    it('should reject expired policies', async () => {
      engine.addPolicy(
        createTestPolicy({
          expiresAt: '2020-01-01T00:00:00.000Z',
        }),
      );

      const request = createTestRequest();
      const policyId = await engine.checkAutoApprove(request);
      expect(policyId).toBeNull();
    });

    it('should reject when time window format is invalid', async () => {
      engine.addPolicy(
        createTestPolicy({
          conditions: {
            ...createTestPolicy().conditions,
            timeWindow: {
              start: '25:99',
              end: 'aa:bb',
            },
          },
        }),
      );

      const request = createTestRequest();
      const policyId = await engine.checkAutoApprove(request);
      expect(policyId).toBeNull();
    });

    it('should remove policies (safe Map iteration)', () => {
      // Bug #3: removePolicy must not skip entries when deleting during iteration
      engine.addPolicy(createTestPolicy({ id: 'p-del-1' }));
      engine.addPolicy(createTestPolicy({ id: 'p-del-2' }));
      engine.addPolicy(createTestPolicy({ id: 'p-keep' }));

      // Remove all policies with id 'p-del-1' (only one key)
      engine.removePolicy('p-del-1');
      expect(engine.getPolicy('p-del-1')).toBeUndefined();
      expect(engine.getPolicy('p-del-2')).toBeTruthy();
      expect(engine.getPolicy('p-keep')).toBeTruthy();
    });

    it('should use consistent map key between addPolicy and load', async () => {
      // Bug #2: addPolicy and load must use the same key format
      const policy = createTestPolicy({ vendorId: 'vendor-x' });
      engine.addPolicy(policy);
      await engine.save();

      const engine2 = new PolicyEngine(storage);
      await engine2.load();

      // Must be findable after round-trip
      expect(engine2.getPolicy('policy-1')).toBeTruthy();
    });

    it('should match policies by vendorId when present', async () => {
      // Bug #9: findMatchingPolicies should use policy.vendorId when available
      const policy = createTestPolicy({ vendorId: 'vendor-x', agentId: 'internal-agent' });
      engine.addPolicy(policy);

      // Request with vendorId matching policy.vendorId
      const request = createTestRequest({ vendorId: 'vendor-x' });
      const policyId = await engine.checkAutoApprove(request);
      expect(policyId).toBe('policy-1');

      // Request with vendorId NOT matching
      const request2 = createTestRequest({ vendorId: 'other-vendor' });
      const policyId2 = await engine.checkAutoApprove(request2);
      expect(policyId2).toBeNull();
    });

    it('should record execution and maintain audit log', async () => {
      engine.addPolicy(createTestPolicy());

      await engine.recordExecution('req-1', 'policy-1', {
        success: true,
        requestId: 'req-1',
        txHash: '0xabc',
        timestamp: Date.now(),
      });

      const entries = await engine.getExecutions(
        'policy-1',
        Date.now() - 60000,
        Date.now() + 60000,
      );
      expect(entries.length).toBe(1);
      expect(entries[0].requestId).toBe('req-1');
    });

    it('should save and load from storage', async () => {
      engine.addPolicy(createTestPolicy());
      await engine.save();

      const engine2 = new PolicyEngine(storage);
      await engine2.load();

      expect(engine2.getPolicy('policy-1')).toBeTruthy();
    });
  });

  // ─── Budget Tracker ─────────────────────────────────────────────────────

  describe('BudgetTracker', () => {
    let tracker: BudgetTracker;
    const conditions: PolicyConditions = {
      maxAmountPerTx: 100,
      maxAmountPerDay: 500,
      maxAmountPerWeek: 2000,
      maxAmountPerMonth: 5000,
      allowListAddresses: [],
      allowListChains: [],
      allowListMethods: [],
      minBalanceAfter: 10,
      requireReviewBeforeFirstPay: false,
    };

    beforeEach(() => {
      tracker = new BudgetTracker(storage);
    });

    it('should allow spend within budget', async () => {
      const result = await tracker.checkBudget('agent-1', 50, conditions);

      expect(result.allowed).toBe(true);
      expect(result.remainingDaily).toBe(450);
      expect(result.remainingWeekly).toBe(1950);
      expect(result.remainingMonthly).toBe(4950);
    });

    it('should reject spend exceeding daily limit', async () => {
      // Record some spending
      await tracker.recordSpend('agent-1', {
        amount: 450,
        timestamp: new Date().toISOString(),
        txHash: '0x1',
        chain: 'solana',
        method: 'transfer',
        requestId: 'r1',
      });

      const result = await tracker.checkBudget('agent-1', 100, conditions);
      expect(result.allowed).toBe(false);
      expect(result.violatedRule).toBe('maxAmountPerDay');
    });

    it('should track cumulative spending', async () => {
      await tracker.recordSpend('agent-1', {
        amount: 100,
        timestamp: new Date().toISOString(),
        txHash: '0x1',
        chain: 'solana',
        method: 'transfer',
        requestId: 'r1',
      });

      await tracker.recordSpend('agent-1', {
        amount: 200,
        timestamp: new Date().toISOString(),
        txHash: '0x2',
        chain: 'solana',
        method: 'transfer',
        requestId: 'r2',
      });

      const budget = tracker.getBudget('agent-1');
      expect(budget?.dailySpent).toBe(300);
      expect(budget?.weeklySpent).toBe(300);
      expect(budget?.monthlySpent).toBe(300);
    });

    it('should get recent transactions', async () => {
      await tracker.recordSpend('agent-1', {
        amount: 100,
        timestamp: new Date().toISOString(),
        txHash: '0x1',
        chain: 'solana',
        method: 'transfer',
        requestId: 'r1',
      });

      const txs = tracker.getRecentTransactions('agent-1');
      expect(txs.length).toBe(1);
      expect(txs[0].amount).toBe(100);
    });

    it('should reset budget', () => {
      tracker.resetBudget('agent-1');
      const budget = tracker.getBudget('agent-1');
      expect(budget?.dailySpent).toBe(0);
      expect(budget?.weeklySpent).toBe(0);
      expect(budget?.monthlySpent).toBe(0);
    });

    it('should save and load from storage', async () => {
      await tracker.recordSpend('agent-1', {
        amount: 100,
        timestamp: new Date().toISOString(),
        txHash: '0x1',
        chain: 'solana',
        method: 'transfer',
        requestId: 'r1',
      });
      await tracker.save();

      const tracker2 = new BudgetTracker(storage);
      await tracker2.load();

      const budget = tracker2.getBudget('agent-1');
      expect(budget?.dailySpent).toBe(100);
    });
  });

  // ─── Policy Change Classification ─────────────────────────────────────

  describe('PolicyEngine.classifyPolicyChange', () => {
    let engine: PolicyEngine;

    beforeEach(() => {
      engine = new PolicyEngine(storage);
    });

    it('should return auto for brand-new policy (no existing)', () => {
      const newPolicy = createTestPolicy();
      const result = engine.classifyPolicyChange(newPolicy);
      expect(result.requiresEscalation).toBe(false);
      expect(result.approvalLevel).toBe('auto');
      expect(result.criticalChanges).toHaveLength(0);
    });

    it('should return auto for non-existing existingPolicyId', () => {
      const newPolicy = createTestPolicy();
      const result = engine.classifyPolicyChange(newPolicy, 'nonexistent');
      expect(result.requiresEscalation).toBe(false);
      expect(result.approvalLevel).toBe('auto');
    });

    it('should detect budget_increase and require biometric', () => {
      const existing = createTestPolicy({ conditions: { ...createTestPolicy().conditions, maxAmountPerDay: 500 } });
      engine.addPolicy(existing);

      const updated = createTestPolicy({ conditions: { ...createTestPolicy().conditions, maxAmountPerDay: 1000 } });
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.approvalLevel).toBe('biometric');
      expect(result.criticalChanges).toContain('budget_increase');
      expect(result.reasons.some(r => r.includes('maxAmountPerDay'))).toBe(true);
    });

    it('should detect scope_escalation', () => {
      const existing = createTestPolicy({ scope: 'auto_payment' });
      engine.addPolicy(existing);

      const updated = createTestPolicy({ scope: 'full' });
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.approvalLevel).toBe('biometric');
      expect(result.criticalChanges).toContain('scope_escalation');
    });

    it('should detect allowlist_address_remove_all', () => {
      const existing = createTestPolicy({
        conditions: { ...createTestPolicy().conditions, allowListAddresses: ['0xA', '0xB'] },
      });
      engine.addPolicy(existing);

      const updated = createTestPolicy({
        conditions: { ...createTestPolicy().conditions, allowListAddresses: [] },
      });
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.approvalLevel).toBe('biometric');
      expect(result.criticalChanges).toContain('allowlist_address_remove_all');
    });

    it('should detect allowlist_address_add with review level', () => {
      const existing = createTestPolicy({
        conditions: { ...createTestPolicy().conditions, allowListAddresses: ['0xA'] },
      });
      engine.addPolicy(existing);

      const updated = createTestPolicy({
        conditions: { ...createTestPolicy().conditions, allowListAddresses: ['0xA', '0xNEW'] },
      });
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.approvalLevel).toBe('review');
      expect(result.criticalChanges).toContain('allowlist_address_add');
    });

    it('should detect time_window_remove', () => {
      const existing = createTestPolicy({
        conditions: { ...createTestPolicy().conditions, timeWindow: { start: '09:00', end: '17:00' } },
      });
      engine.addPolicy(existing);

      const updated = createTestPolicy({
        conditions: { ...createTestPolicy().conditions },
      });
      // Ensure no timeWindow on updated
      delete (updated.conditions as Record<string, unknown>).timeWindow;
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.criticalChanges).toContain('time_window_remove');
    });

    it('should detect min_balance_lower', () => {
      const existing = createTestPolicy({
        conditions: { ...createTestPolicy().conditions, minBalanceAfter: 100 },
      });
      engine.addPolicy(existing);

      const updated = createTestPolicy({
        conditions: { ...createTestPolicy().conditions, minBalanceAfter: 5 },
      });
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.criticalChanges).toContain('min_balance_lower');
    });

    it('should detect first_pay_review_disable', () => {
      const existing = createTestPolicy({
        conditions: { ...createTestPolicy().conditions, requireReviewBeforeFirstPay: true },
      });
      engine.addPolicy(existing);

      const updated = createTestPolicy({
        conditions: { ...createTestPolicy().conditions, requireReviewBeforeFirstPay: false },
      });
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.criticalChanges).toContain('first_pay_review_disable');
    });

    it('should detect expiration_extend', () => {
      const existing = createTestPolicy({ expiresAt: '2025-06-01T00:00:00.000Z' });
      engine.addPolicy(existing);

      const updated = createTestPolicy({ expiresAt: '2026-12-01T00:00:00.000Z' });
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.criticalChanges).toContain('expiration_extend');
    });

    it('should detect expiration removal', () => {
      const existing = createTestPolicy({ expiresAt: '2025-06-01T00:00:00.000Z' });
      engine.addPolicy(existing);

      const updated = createTestPolicy();
      // No expiresAt on updated
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.criticalChanges).toContain('expiration_extend');
    });

    it('should return auto when no critical changes detected', () => {
      const existing = createTestPolicy();
      engine.addPolicy(existing);

      // Same policy, no changes
      const updated = createTestPolicy();
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(false);
      expect(result.approvalLevel).toBe('auto');
      expect(result.criticalChanges).toHaveLength(0);
    });

    it('should escalate to biometric when any biometric-level change exists', () => {
      const existing = createTestPolicy({
        conditions: {
          ...createTestPolicy().conditions,
          requireReviewBeforeFirstPay: true,
          minBalanceAfter: 100,
        },
      });
      engine.addPolicy(existing);

      // Lower minBalance (review-level) + increase budget (biometric-level)
      const updated = createTestPolicy({
        conditions: {
          ...createTestPolicy().conditions,
          requireReviewBeforeFirstPay: false,
          minBalanceAfter: 5,
          maxAmountPerDay: 99999,
        },
      });
      const result = engine.classifyPolicyChange(updated, 'policy-1');

      expect(result.requiresEscalation).toBe(true);
      expect(result.approvalLevel).toBe('biometric');
      expect(result.criticalChanges.length).toBeGreaterThanOrEqual(2);
    });
  });
});
