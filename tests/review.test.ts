/**
 * AESP — Review Module Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockWasm, teardownMockWasm, MockStorage } from './helpers.js';
import { ReviewManager } from '../src/review/manager.js';
import type { ReviewResponse } from '../src/types/review.js';
import { AESPError } from '../src/types/common.js';

describe('Review Module', () => {
  let manager: ReviewManager;
  let storage: MockStorage;

  beforeEach(() => {
    setupMockWasm();
    storage = new MockStorage();
    manager = new ReviewManager(storage);
  });

  afterEach(() => {
    manager.dispose();
    teardownMockWasm();
  });

  // ─── Request Creation ───────────────────────────────────────────────────

  describe('Review Request Creation', () => {
    it('should create a review request (async)', () => {
      const request = manager.createReviewRequestAsync({
        agentId: 'agent-1',
        agentLabel: 'Shopping Agent',
        action: 'transfer',
        summary: 'Agent wants to spend $350 on headphones',
        details: {
          chain: 'solana',
          to: 'merchant_address',
          amount: '350',
          currency: 'USDC',
        },
        policyViolation: {
          rule: 'maxAmountPerTx',
          actual: '350',
          limit: '100',
        },
        urgency: 'high',
      });

      expect(request.requestId).toBeTruthy();
      expect(request.agentId).toBe('agent-1');
      expect(request.agentLabel).toBe('Shopping Agent');
      expect(request.action).toBe('transfer');
      expect(request.urgency).toBe('high');
      expect(request.policyViolation.rule).toBe('maxAmountPerTx');
    });

    it('should add request to pending queue', () => {
      manager.createReviewRequestAsync({
        agentId: 'agent-1',
        agentLabel: 'Test Agent',
        action: 'transfer',
        summary: 'test',
        details: {
          chain: 'solana',
          to: 'addr',
          amount: '100',
          currency: 'USDC',
        },
        policyViolation: {
          rule: 'maxAmountPerTx',
          actual: '100',
          limit: '50',
        },
      });

      const pending = manager.getPendingRequests();
      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('pending');
    });

    it('should emit event on creation', () => {
      const events: Array<{ type: string; data: unknown }> = [];
      manager.onEvent((type, data) => events.push({ type, data }));

      manager.createReviewRequestAsync({
        agentId: 'agent-1',
        agentLabel: 'Test',
        action: 'transfer',
        summary: 'test',
        details: {
          chain: 'solana',
          to: 'addr',
          amount: '100',
          currency: 'USDC',
        },
        policyViolation: {
          rule: 'rule',
          actual: '100',
          limit: '50',
        },
      });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('review:created');
    });
  });

  // ─── Response Handling ──────────────────────────────────────────────────

  describe('Response Handling', () => {
    it('should submit response to pending request', () => {
      const request = manager.createReviewRequestAsync({
        agentId: 'agent-1',
        agentLabel: 'Test',
        action: 'transfer',
        summary: 'test',
        details: {
          chain: 'solana',
          to: 'addr',
          amount: '100',
          currency: 'USDC',
        },
        policyViolation: {
          rule: 'rule',
          actual: '100',
          limit: '50',
        },
      });

      const response: ReviewResponse = {
        requestId: request.requestId,
        decision: 'approve',
        respondedAt: new Date().toISOString(),
        respondedVia: 'mobile',
        biometricVerified: true,
      };

      manager.submitResponse(response);

      const item = manager.getRequest(request.requestId);
      expect(item?.status).toBe('responded');
      expect(item?.response?.decision).toBe('approve');
    });

    it('should resolve promise when response is submitted', async () => {
      // Create request with promise
      const reviewPromise = manager.createReviewRequest({
        agentId: 'agent-1',
        agentLabel: 'Test',
        action: 'transfer',
        summary: 'test',
        details: {
          chain: 'solana',
          to: 'addr',
          amount: '100',
          currency: 'USDC',
        },
        policyViolation: {
          rule: 'rule',
          actual: '100',
          limit: '50',
        },
        deadlineMs: 5000,
      });

      // Get the pending request to find its ID
      const pending = manager.getPendingRequests();
      expect(pending.length).toBe(1);
      const requestId = pending[0].request.requestId;

      // Submit response
      manager.submitResponse({
        requestId,
        decision: 'approve',
        respondedAt: new Date().toISOString(),
        respondedVia: 'extension',
        biometricVerified: false,
      });

      const response = await reviewPromise;
      expect(response.decision).toBe('approve');
    });

    it('should reject response to non-existent request', () => {
      expect(() =>
        manager.submitResponse({
          requestId: 'nonexistent',
          decision: 'approve',
          respondedAt: new Date().toISOString(),
          respondedVia: 'mobile',
          biometricVerified: false,
        }),
      ).toThrow('not found');
    });

    it('should reject response to already-responded request', () => {
      const request = manager.createReviewRequestAsync({
        agentId: 'agent-1',
        agentLabel: 'Test',
        action: 'transfer',
        summary: 'test',
        details: { chain: 'solana', to: 'addr', amount: '100', currency: 'USDC' },
        policyViolation: { rule: 'r', actual: '100', limit: '50' },
      });

      manager.submitResponse({
        requestId: request.requestId,
        decision: 'approve',
        respondedAt: new Date().toISOString(),
        respondedVia: 'mobile',
        biometricVerified: false,
      });

      expect(() =>
        manager.submitResponse({
          requestId: request.requestId,
          decision: 'reject',
          respondedAt: new Date().toISOString(),
          respondedVia: 'mobile',
          biometricVerified: false,
        }),
      ).toThrow('already responded');
    });

    it('should emit event on response', () => {
      const events: Array<{ type: string }> = [];
      manager.onEvent((type) => events.push({ type }));

      const request = manager.createReviewRequestAsync({
        agentId: 'agent-1',
        agentLabel: 'Test',
        action: 'transfer',
        summary: 'test',
        details: { chain: 'solana', to: 'addr', amount: '100', currency: 'USDC' },
        policyViolation: { rule: 'r', actual: '100', limit: '50' },
      });

      manager.submitResponse({
        requestId: request.requestId,
        decision: 'approve',
        respondedAt: new Date().toISOString(),
        respondedVia: 'mobile',
        biometricVerified: true,
      });

      expect(events.some((e) => e.type === 'review:responded')).toBe(true);
    });
  });

  // ─── Emergency Freeze ───────────────────────────────────────────────────

  describe('Emergency Freeze', () => {
    it('should freeze an agent', () => {
      const status = manager.freezeAgent({
        agentId: 'agent-1',
        reason: 'Suspicious activity detected',
        initiatedBy: 'human',
        freezeAt: new Date().toISOString(),
      });

      expect(status.frozen).toBe(true);
      expect(status.reason).toBe('Suspicious activity detected');
      expect(manager.isAgentFrozen('agent-1')).toBe(true);
    });

    it('should unfreeze an agent', () => {
      manager.freezeAgent({
        agentId: 'agent-1',
        reason: 'test',
        initiatedBy: 'human',
        freezeAt: new Date().toISOString(),
      });

      manager.unfreezeAgent('agent-1');
      expect(manager.isAgentFrozen('agent-1')).toBe(false);
    });

    it('should block review requests for frozen agents', async () => {
      manager.freezeAgent({
        agentId: 'agent-1',
        reason: 'test',
        initiatedBy: 'human',
        freezeAt: new Date().toISOString(),
      });

      await expect(
        manager.createReviewRequest({
          agentId: 'agent-1',
          agentLabel: 'Test',
          action: 'transfer',
          summary: 'test',
          details: { chain: 'solana', to: 'addr', amount: '100', currency: 'USDC' },
          policyViolation: { rule: 'r', actual: '100', limit: '50' },
        }),
      ).rejects.toThrow('frozen');
    });

    it('should reject pending reviews when agent is frozen', async () => {
      // Create a pending review
      const reviewPromise = manager.createReviewRequest({
        agentId: 'agent-1',
        agentLabel: 'Test',
        action: 'transfer',
        summary: 'test',
        details: { chain: 'solana', to: 'addr', amount: '100', currency: 'USDC' },
        policyViolation: { rule: 'r', actual: '100', limit: '50' },
        deadlineMs: 10000,
      });

      // Freeze the agent
      manager.freezeAgent({
        agentId: 'agent-1',
        reason: 'emergency',
        initiatedBy: 'human',
        freezeAt: new Date().toISOString(),
      });

      await expect(reviewPromise).rejects.toThrow('frozen');
    });
  });

  // ─── Queries ────────────────────────────────────────────────────────────

  describe('Queries', () => {
    it('should get requests by agent', () => {
      manager.createReviewRequestAsync({
        agentId: 'agent-1',
        agentLabel: 'Agent 1',
        action: 'transfer',
        summary: 'test 1',
        details: { chain: 'solana', to: 'a', amount: '100', currency: 'USDC' },
        policyViolation: { rule: 'r', actual: '100', limit: '50' },
      });

      manager.createReviewRequestAsync({
        agentId: 'agent-2',
        agentLabel: 'Agent 2',
        action: 'transfer',
        summary: 'test 2',
        details: { chain: 'solana', to: 'b', amount: '200', currency: 'USDC' },
        policyViolation: { rule: 'r', actual: '200', limit: '100' },
      });

      const agent1Requests = manager.getRequestsByAgent('agent-1');
      expect(agent1Requests.length).toBe(1);
    });
  });

  // ─── Persistence ────────────────────────────────────────────────────────

  describe('Persistence', () => {
    it('should save and load review queue', async () => {
      manager.createReviewRequestAsync({
        agentId: 'agent-1',
        agentLabel: 'Test',
        action: 'transfer',
        summary: 'test',
        details: { chain: 'solana', to: 'addr', amount: '100', currency: 'USDC' },
        policyViolation: { rule: 'r', actual: '100', limit: '50' },
      });

      await manager.save();

      const manager2 = new ReviewManager(storage);
      await manager2.load();

      expect(manager2.getPendingRequests().length).toBe(1);
      manager2.dispose();
    });

    it('should save and load freeze status', async () => {
      manager.freezeAgent({
        agentId: 'agent-1',
        reason: 'test',
        initiatedBy: 'human',
        freezeAt: new Date().toISOString(),
      });

      await manager.save();

      const manager2 = new ReviewManager(storage);
      await manager2.load();

      expect(manager2.isAgentFrozen('agent-1')).toBe(true);
      manager2.dispose();
    });
  });

  // ─── Event System ───────────────────────────────────────────────────────

  describe('Event System', () => {
    it('should unsubscribe from events', () => {
      const events: string[] = [];
      const unsubscribe = manager.onEvent((type) => events.push(type));

      manager.createReviewRequestAsync({
        agentId: 'a',
        agentLabel: 'T',
        action: 'transfer',
        summary: 'test',
        details: { chain: 'solana', to: 'a', amount: '1', currency: 'U' },
        policyViolation: { rule: 'r', actual: '1', limit: '0' },
      });

      expect(events.length).toBe(1);

      unsubscribe();

      manager.createReviewRequestAsync({
        agentId: 'b',
        agentLabel: 'T',
        action: 'transfer',
        summary: 'test2',
        details: { chain: 'solana', to: 'b', amount: '2', currency: 'U' },
        policyViolation: { rule: 'r', actual: '2', limit: '1' },
      });

      // Should still be 1 since we unsubscribed
      expect(events.length).toBe(1);
    });
  });
});
