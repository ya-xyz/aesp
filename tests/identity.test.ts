/**
 * AESP — Identity Module Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockWasm, teardownMockWasm, MockStorage } from './helpers.js';
import {
  deriveAgentIdentity,
  createAgentCertificate,
  verifyCertificate,
  isCertificateExpired,
  hasCertificateCapability,
} from '../src/identity/derivation.js';
import { AgentHierarchyManager } from '../src/identity/hierarchy.js';

describe('Identity Module', () => {
  beforeEach(() => {
    setupMockWasm();
  });

  afterEach(() => {
    teardownMockWasm();
  });

  // ─── Derivation ─────────────────────────────────────────────────────────

  describe('Agent Identity Derivation', () => {
    it('should derive agent identity from mnemonic', async () => {
      const identity = await deriveAgentIdentity({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentIndex: 0,
      });

      expect(identity.agentId).toBeTruthy();
      expect(identity.agentId.length).toBe(64);
      expect(identity.did).toMatch(/^did:yallet:/);
      expect(identity.publicKey).toBeTruthy();
      expect(identity.derivationPath).toBe("m/44'/501'/0'/0'/0'");
    });

    it('should derive different identities for different indices', async () => {
      const id0 = await deriveAgentIdentity({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentIndex: 0,
      });
      const id1 = await deriveAgentIdentity({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentIndex: 1,
      });

      expect(id0.agentId).not.toBe(id1.agentId);
      expect(id0.publicKey).not.toBe(id1.publicKey);
      expect(id0.derivationPath).not.toBe(id1.derivationPath);
    });

    it('should derive same identity for same parameters', async () => {
      const id1 = await deriveAgentIdentity({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentIndex: 5,
      });
      const id2 = await deriveAgentIdentity({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentIndex: 5,
      });

      expect(id1.agentId).toBe(id2.agentId);
      expect(id1.publicKey).toBe(id2.publicKey);
    });

    it('should reject negative agent index', async () => {
      await expect(
        deriveAgentIdentity({
          mnemonic: 'test',
          passphrase: 'pass',
          agentIndex: -1,
        }),
      ).rejects.toThrow('Agent index must be between 0 and');
    });
  });

  // ─── Certificate ────────────────────────────────────────────────────────

  describe('Agent Certificate', () => {
    it('should create a certificate with correct fields', async () => {
      const cert = await createAgentCertificate({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentIndex: 0,
        ownerXidentity: 'bW9ja194aWRlbnRpdHk=',
        capabilities: ['payment', 'negotiation'],
        chains: ['solana', 'ethereum'],
        maxAutonomousAmount: 100,
        policy: { maxAmountPerTx: 100 },
        validDays: 30,
      });

      expect(cert.version).toBe('1.0');
      expect(cert.agentId).toBeTruthy();
      expect(cert.pubkey).toBeTruthy();
      expect(cert.ownerXidentity).toBe('bW9ja194aWRlbnRpdHk=');
      expect(cert.capabilities).toEqual(['payment', 'negotiation']);
      expect(cert.chains).toEqual(['solana', 'ethereum']);
      expect(cert.maxAutonomousAmount).toBe(100);
      expect(cert.policyHash).toBeTruthy();
      expect(cert.ownerSignature).toBeTruthy();
      expect(cert.createdAt).toBeTruthy();
      expect(cert.expiresAt).toBeTruthy();
    });

    it('should check certificate expiration', async () => {
      // Create cert that expires in 30 days
      const cert = await createAgentCertificate({
        mnemonic: 'test',
        passphrase: 'pass',
        agentIndex: 0,
        ownerXidentity: 'bW9ja194aWRlbnRpdHk=',
        capabilities: ['payment'],
        chains: ['solana'],
        maxAutonomousAmount: 50,
        policy: {},
        validDays: 30,
      });

      expect(isCertificateExpired(cert)).toBe(false);

      // Manually set expiry to past
      cert.expiresAt = '2020-01-01T00:00:00.000Z';
      expect(isCertificateExpired(cert)).toBe(true);
    });

    it('should check certificate capabilities', async () => {
      const cert = await createAgentCertificate({
        mnemonic: 'test',
        passphrase: 'pass',
        agentIndex: 0,
        ownerXidentity: 'bW9ja194aWRlbnRpdHk=',
        capabilities: ['payment', 'data_query'],
        chains: ['solana'],
        maxAutonomousAmount: 50,
        policy: {},
      });

      expect(hasCertificateCapability(cert, 'payment')).toBe(true);
      expect(hasCertificateCapability(cert, 'data_query')).toBe(true);
      expect(hasCertificateCapability(cert, 'negotiation')).toBe(false);
    });

    it('should verify certificate with trusted xidentity (Bug #10)', async () => {
      const cert = await createAgentCertificate({
        mnemonic: 'test',
        passphrase: 'pass',
        agentIndex: 0,
        ownerXidentity: 'bW9ja194aWRlbnRpdHk=',
        capabilities: ['payment'],
        chains: ['solana'],
        maxAutonomousAmount: 50,
        policy: {},
      });

      // Verify with correct trusted xidentity
      expect(verifyCertificate(cert, 'bW9ja194aWRlbnRpdHk=')).toBe(true);

      // Verify with wrong trusted xidentity should fail (trust anchor mismatch)
      expect(verifyCertificate(cert, 'wrong_xidentity_b64')).toBe(false);

      // Verify without trust anchor (self-verify, backward compatible)
      expect(verifyCertificate(cert)).toBe(true);
    });
  });

  // ─── Hierarchy ──────────────────────────────────────────────────────────

  describe('Agent Hierarchy', () => {
    let hierarchy: AgentHierarchyManager;
    let storage: MockStorage;

    beforeEach(() => {
      storage = new MockStorage();
      hierarchy = new AgentHierarchyManager(storage);
    });

    it('should add agents to hierarchy', () => {
      hierarchy.addAgent('shopping', 'Shopping Agent');
      hierarchy.addAgent('research', 'Research Agent');

      expect(hierarchy.size).toBe(2);
    });

    it('should create parent-child relationships', () => {
      hierarchy.addAgent('shopping', 'Shopping Agent');
      hierarchy.addAgent('price_compare', 'Price Comparison', 'shopping');
      hierarchy.addAgent('order', 'Order Agent', 'shopping');

      const shoppingNode = hierarchy.getAgent('shopping')!;
      expect(shoppingNode.children.length).toBe(2);
      expect(shoppingNode.depth).toBe(0);

      const priceNode = hierarchy.getAgent('price_compare')!;
      expect(priceNode.depth).toBe(1);
      expect(priceNode.parentAgentId).toBe('shopping');
    });

    it('should get escalation chain', () => {
      hierarchy.addAgent('shopping', 'Shopping Agent');
      hierarchy.addAgent('price_compare', 'Price Comparison', 'shopping');

      const chain = hierarchy.getEscalationChain('price_compare');
      expect(chain).toEqual(['price_compare', 'shopping', 'human']);
    });

    it('should check ancestor relationship', () => {
      hierarchy.addAgent('shopping', 'Shopping Agent');
      hierarchy.addAgent('order', 'Order Agent', 'shopping');
      hierarchy.addAgent('payment', 'Payment Sub-Agent', 'order');

      expect(hierarchy.isAncestor('shopping', 'payment')).toBe(true);
      expect(hierarchy.isAncestor('order', 'payment')).toBe(true);
      expect(hierarchy.isAncestor('payment', 'shopping')).toBe(false);
    });

    it('should get all descendants', () => {
      hierarchy.addAgent('shopping', 'Shopping Agent');
      hierarchy.addAgent('price', 'Price Agent', 'shopping');
      hierarchy.addAgent('order', 'Order Agent', 'shopping');
      hierarchy.addAgent('sub_order', 'Sub-Order', 'order');

      const descendants = hierarchy.getDescendants('shopping');
      expect(descendants).toContain('price');
      expect(descendants).toContain('order');
      expect(descendants).toContain('sub_order');
      expect(descendants.length).toBe(3);
    });

    it('should remove agent and all sub-agents', () => {
      hierarchy.addAgent('shopping', 'Shopping Agent');
      hierarchy.addAgent('price', 'Price Agent', 'shopping');
      hierarchy.addAgent('order', 'Order Agent', 'shopping');

      const removed = hierarchy.removeAgent('shopping');
      expect(removed).toContain('shopping');
      expect(removed).toContain('price');
      expect(removed).toContain('order');
      expect(hierarchy.size).toBe(0);
    });

    it('should enforce max depth', () => {
      // MAX_HIERARCHY_DEPTH = 5 means allowed depths are 0–4 (5 levels).
      hierarchy.addAgent('l0', 'Level 0');       // depth 0
      hierarchy.addAgent('l1', 'Level 1', 'l0'); // depth 1
      hierarchy.addAgent('l2', 'Level 2', 'l1'); // depth 2
      hierarchy.addAgent('l3', 'Level 3', 'l2'); // depth 3
      hierarchy.addAgent('l4', 'Level 4', 'l3'); // depth 4

      // depth 5 should throw (>= MAX_HIERARCHY_DEPTH)
      expect(() => hierarchy.addAgent('l5', 'Level 5', 'l4')).toThrow(
        'Maximum hierarchy depth',
      );
    });

    it('should save and load from storage', async () => {
      hierarchy.addAgent('shopping', 'Shopping Agent');
      hierarchy.addAgent('price', 'Price Agent', 'shopping');
      await hierarchy.save();

      const hierarchy2 = new AgentHierarchyManager(storage);
      await hierarchy2.load();

      expect(hierarchy2.size).toBe(2);
      expect(hierarchy2.getAgent('shopping')).toBeTruthy();
      expect(hierarchy2.getAgent('price')?.parentAgentId).toBe('shopping');
    });

    it('should get full hierarchy tree', () => {
      hierarchy.addAgent('shopping', 'Shopping Agent');
      hierarchy.addAgent('research', 'Research Agent');
      hierarchy.addAgent('price', 'Price Agent', 'shopping');

      const tree = hierarchy.getHierarchy();
      expect(tree.totalAgents).toBe(3);
      expect(tree.root.agentId).toBe('human');
      expect(tree.root.children.length).toBe(2);
    });
  });
});
