/**
 * AESP — A2A Module Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockWasm, teardownMockWasm } from './helpers.js';
import { AgentCardBuilder, generateAgentCard } from '../src/a2a/agent-card.js';
import type { AgentCardConfig } from '../src/types/a2a.js';
import type { AgentIdentityCertificate } from '../src/types/identity.js';

describe('A2A Module', () => {
  beforeEach(() => {
    setupMockWasm();
  });

  afterEach(() => {
    teardownMockWasm();
  });

  const testConfig: AgentCardConfig = {
    agentId: 'agent-abc123',
    agentLabel: "Alice's Shopping Agent",
    baseUrl: 'https://yault.app',
    capabilities: ['payment', 'negotiation', 'data_query'],
    maxAutonomousAmount: 100,
    chains: ['solana', 'ethereum'],
    monthlyBudget: 500,
    currency: 'USDC',
  };

  // ─── Agent Card Builder ─────────────────────────────────────────────────

  describe('AgentCardBuilder', () => {
    let builder: AgentCardBuilder;

    beforeEach(() => {
      builder = new AgentCardBuilder();
    });

    it('should build agent card from config', () => {
      const card = builder.buildFromConfig(testConfig);

      expect(card.name).toBe("Alice's Shopping Agent");
      expect(card.url).toBe('https://yault.app/a2a/agent/agent-abc123');
      expect(card.provider.organization).toBe('Yault');
      expect(card.version).toBe('1.0.0');
    });

    it('should generate correct skills', () => {
      const card = builder.buildFromConfig(testConfig);

      expect(card.skills.length).toBe(3);
      const skillIds = card.skills.map((s) => s.id);
      expect(skillIds).toContain('payment');
      expect(skillIds).toContain('negotiation');
      expect(skillIds).toContain('data_query');
    });

    it('should generate payment skill description with budget', () => {
      const card = builder.buildFromConfig(testConfig);
      const paymentSkill = card.skills.find((s) => s.id === 'payment');

      expect(paymentSkill?.description).toContain('$100/transaction');
      expect(paymentSkill?.description).toContain('$500/month');
    });

    it('should set capabilities', () => {
      const card = builder.buildFromConfig(testConfig);

      expect(card.capabilities.streaming).toBe(false);
      expect(card.capabilities.pushNotifications).toBe(true);
    });

    it('should set authentication', () => {
      const card = builder.buildFromConfig(testConfig);

      expect(card.authentication.schemes).toContain('ed25519');
    });

    it('should set default IO modes', () => {
      const card = builder.buildFromConfig(testConfig);

      expect(card.defaultInputModes).toContain('application/json');
      expect(card.defaultOutputModes).toContain('application/json');
    });

    it('should generate description with budget info', () => {
      const card = builder.buildFromConfig(testConfig);

      expect(card.description).toContain('$100/tx');
      expect(card.description).toContain('$500/month');
      expect(card.description).toContain('Yault');
    });

    it('should allow custom provider', () => {
      builder.setProvider({
        organization: 'Custom Org',
        url: 'https://custom.org',
      });

      const card = builder.buildFromConfig(testConfig);
      expect(card.provider.organization).toBe('Custom Org');
    });

    it('should handle unknown capabilities gracefully', () => {
      const card = builder.buildFromConfig({
        ...testConfig,
        capabilities: ['payment', 'unknown_capability'],
      });

      // Should only include the known capability
      expect(card.skills.length).toBe(1);
      expect(card.skills[0].id).toBe('payment');
    });

    it('should build from certificate', () => {
      const cert: AgentIdentityCertificate = {
        version: '1.0',
        agentId: 'cert-agent-123',
        pubkey: 'abc123',
        ownerXidentity: 'owner-xid',
        capabilities: ['payment', 'commitment'],
        policyHash: 'hash',
        maxAutonomousAmount: 200,
        chains: ['solana'],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        ownerSignature: 'sig',
      };

      const card = builder.buildFromCertificate(
        cert,
        'https://yault.app',
        'Cert-based Agent',
        1000,
        'USDC',
      );

      expect(card.name).toBe('Cert-based Agent');
      expect(card.skills.length).toBe(2);
      expect(card.url).toContain('cert-agent-123');
    });
  });

  // ─── Convenience Function ───────────────────────────────────────────────

  describe('generateAgentCard', () => {
    it('should generate card from config', () => {
      const card = generateAgentCard(testConfig);

      expect(card.name).toBe("Alice's Shopping Agent");
      expect(card.skills.length).toBe(3);
      expect(card.provider.organization).toBe('Yault');
    });
  });
});
