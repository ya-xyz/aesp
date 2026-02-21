/**
 * AESP — Commitment Module Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockWasm, teardownMockWasm, MockStorage } from './helpers.js';
import { CommitmentBuilder } from '../src/commitment/builder.js';
import { AESPError } from '../src/types/common.js';

describe('Commitment Module', () => {
  let builder: CommitmentBuilder;
  let storage: MockStorage;

  beforeEach(() => {
    setupMockWasm();
    storage = new MockStorage();
    builder = new CommitmentBuilder(storage);
  });

  afterEach(() => {
    teardownMockWasm();
  });

  // ─── Creation ───────────────────────────────────────────────────────────

  describe('Commitment Creation', () => {
    it('should create a commitment draft', () => {
      const record = builder.createCommitment({
        buyerAgent: '0xBuyer',
        sellerAgent: '0xSeller',
        item: 'Premium API access for 30 days',
        price: '100000000', // 100 USDC (6 decimals)
        currency: '0xUSDC',
        deliveryDeadline: Math.floor(Date.now() / 1000) + 86400,
        arbitrator: '0xYaultAuthority',
        escrowRequired: true,
        chainId: 1,
      });

      expect(record.id).toBeTruthy();
      expect(record.status).toBe('draft');
      expect(record.commitment.domain.name).toBe('YalletAgentCommitment');
      expect(record.commitment.domain.version).toBe('1');
      expect(record.commitment.domain.chainId).toBe(1);
      expect(record.commitment.value.buyerAgent).toBe('0xBuyer');
      expect(record.commitment.value.sellerAgent).toBe('0xSeller');
      expect(record.commitment.value.price).toBe('100000000');
      expect(record.commitment.value.escrowRequired).toBe(true);
      expect(record.commitment.types.Commitment.length).toBeGreaterThan(0);
    });

    it('should generate nonce within safe integer range (Bug #8)', () => {
      // Create multiple commitments and verify nonces are safe integers
      for (let i = 0; i < 10; i++) {
        const record = builder.createCommitment({
          buyerAgent: '0xBuyer',
          sellerAgent: '0xSeller',
          item: `item-${i}`,
          price: '100',
          currency: '0xUSDC',
          deliveryDeadline: Math.floor(Date.now() / 1000) + 86400,
          arbitrator: '0xArb',
          escrowRequired: false,
          chainId: 1,
        });

        const nonce = record.commitment.value.nonce;
        expect(Number.isSafeInteger(nonce)).toBe(true);
        expect(nonce).toBeGreaterThanOrEqual(0);
        expect(nonce).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      }
    });

    it('should create unique commitment IDs', () => {
      const r1 = builder.createCommitment({
        buyerAgent: '0xA',
        sellerAgent: '0xB',
        item: 'item1',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      const r2 = builder.createCommitment({
        buyerAgent: '0xA',
        sellerAgent: '0xB',
        item: 'item2',
        price: '200',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      expect(r1.id).not.toBe(r2.id);
    });
  });

  // ─── Signing ────────────────────────────────────────────────────────────

  describe('Commitment Signing', () => {
    it('should sign as buyer', async () => {
      const record = builder.createCommitment({
        buyerAgent: '0xBuyer',
        sellerAgent: '0xSeller',
        item: 'test item',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      const signed = await builder.signAsBuyer(record.id, 'mnemonic', 'pass');
      expect(signed.commitment.buyerSignature).toBeTruthy();
      expect(signed.status).toBe('buyer_signed');
    });

    it('should sign as seller after buyer', async () => {
      const record = builder.createCommitment({
        buyerAgent: '0xBuyer',
        sellerAgent: '0xSeller',
        item: 'test item',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      await builder.signAsBuyer(record.id, 'mnemonic', 'pass');
      const fullySigned = await builder.signAsSeller(record.id, 'seller_mnemonic', 'pass');

      expect(fullySigned.commitment.buyerSignature).toBeTruthy();
      expect(fullySigned.commitment.sellerSignature).toBeTruthy();
      expect(fullySigned.status).toBe('fully_signed');
    });

    it('should sign as seller first (proposed state)', async () => {
      const record = builder.createCommitment({
        buyerAgent: '0xBuyer',
        sellerAgent: '0xSeller',
        item: 'test',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      const signed = await builder.signAsSeller(record.id, 'mnemonic', 'pass');
      expect(signed.commitment.sellerSignature).toBeTruthy();
      expect(signed.status).toBe('proposed');
    });
  });

  // ─── Status Transitions ─────────────────────────────────────────────────

  describe('Status Transitions', () => {
    it('should transition fully_signed → escrowed', async () => {
      const record = builder.createCommitment({
        buyerAgent: '0xBuyer',
        sellerAgent: '0xSeller',
        item: 'test',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: true,
        chainId: 1,
      });

      await builder.signAsBuyer(record.id, 'mnemonic', 'pass');
      await builder.signAsSeller(record.id, 'mnemonic', 'pass');

      const escrowed = builder.updateStatus(record.id, 'escrowed', {
        escrowTxHash: '0xEscrowTx',
      });

      expect(escrowed.status).toBe('escrowed');
      expect(escrowed.escrowTxHash).toBe('0xEscrowTx');
    });

    it('should transition escrowed → delivered → completed', async () => {
      const record = builder.createCommitment({
        buyerAgent: '0xBuyer',
        sellerAgent: '0xSeller',
        item: 'test',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: true,
        chainId: 1,
      });

      await builder.signAsBuyer(record.id, 'mnemonic', 'pass');
      await builder.signAsSeller(record.id, 'mnemonic', 'pass');
      builder.updateStatus(record.id, 'escrowed');
      builder.updateStatus(record.id, 'delivered', {
        deliveryConfirmationHash: '0xDelivery',
      });

      const completed = builder.updateStatus(record.id, 'completed', {
        releaseTxHash: '0xRelease',
        arweaveAuditTx: 'arweave_tx_id',
      });

      expect(completed.status).toBe('completed');
      expect(completed.releaseTxHash).toBe('0xRelease');
      expect(completed.arweaveAuditTx).toBe('arweave_tx_id');
    });

    it('should reject invalid status transitions', () => {
      const record = builder.createCommitment({
        buyerAgent: '0xBuyer',
        sellerAgent: '0xSeller',
        item: 'test',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      // Can't go from draft to completed
      expect(() => builder.updateStatus(record.id, 'completed')).toThrow(
        'Invalid commitment status transition',
      );
    });

    it('should allow dispute from escrowed', async () => {
      const record = builder.createCommitment({
        buyerAgent: '0xBuyer',
        sellerAgent: '0xSeller',
        item: 'test',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: true,
        chainId: 1,
      });

      await builder.signAsBuyer(record.id, 'mnemonic', 'pass');
      await builder.signAsSeller(record.id, 'mnemonic', 'pass');
      builder.updateStatus(record.id, 'escrowed');

      const disputed = builder.updateStatus(record.id, 'disputed', {
        disputeId: 'dispute-123',
      });

      expect(disputed.status).toBe('disputed');
      expect(disputed.disputeId).toBe('dispute-123');
    });
  });

  // ─── Queries ────────────────────────────────────────────────────────────

  describe('Queries', () => {
    it('should find commitments by status', () => {
      builder.createCommitment({
        buyerAgent: '0xA',
        sellerAgent: '0xB',
        item: 'item1',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      builder.createCommitment({
        buyerAgent: '0xA',
        sellerAgent: '0xC',
        item: 'item2',
        price: '200',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      const drafts = builder.getCommitmentsByStatus('draft');
      expect(drafts.length).toBe(2);
    });

    it('should find commitments by agent', () => {
      builder.createCommitment({
        buyerAgent: '0xA',
        sellerAgent: '0xB',
        item: 'item1',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      builder.createCommitment({
        buyerAgent: '0xC',
        sellerAgent: '0xA',
        item: 'item2',
        price: '200',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      // Agent 0xA is buyer in first, seller in second
      const agentA = builder.getCommitmentsByAgent('0xA');
      expect(agentA.length).toBe(2);
    });

    it('should compute commitment hash', async () => {
      const record = builder.createCommitment({
        buyerAgent: '0xBuyer',
        sellerAgent: '0xSeller',
        item: 'test',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      const hash = await builder.computeCommitmentHash(record.commitment);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });
  });

  // ─── Persistence ────────────────────────────────────────────────────────

  describe('Persistence', () => {
    it('should save and load commitments', async () => {
      builder.createCommitment({
        buyerAgent: '0xA',
        sellerAgent: '0xB',
        item: 'test',
        price: '100',
        currency: '0xUSDC',
        deliveryDeadline: 0,
        arbitrator: '0xArb',
        escrowRequired: false,
        chainId: 1,
      });

      await builder.save();

      const builder2 = new CommitmentBuilder(storage);
      await builder2.load();

      expect(builder2.getAllCommitments().length).toBe(1);
    });
  });
});
