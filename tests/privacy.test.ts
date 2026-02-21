/**
 * AESP — Privacy Module Tests
 *
 * Tests for AddressPoolManager, ContextTagManager, and ConsolidationScheduler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockStorage, setupMockWasm, teardownMockWasm } from './helpers.js';
import { AddressPoolManager } from '../src/privacy/address-pool.js';
import { ContextTagManager } from '../src/privacy/context-tag.js';
import { ConsolidationScheduler } from '../src/privacy/consolidation.js';
import { resetWasm } from '../src/crypto/wasm-bridge.js';
import type { PrivacyPolicy } from '../src/types/privacy.js';

// ─── Setup ──────────────────────────────────────────────────────────────────

let storage: MockStorage;

beforeEach(() => {
  setupMockWasm();
  storage = new MockStorage();
});

afterEach(() => {
  teardownMockWasm();
});

// ─── AddressPoolManager ─────────────────────────────────────────────────────

describe('AddressPoolManager', () => {
  let pool: AddressPoolManager;

  beforeEach(() => {
    pool = new AddressPoolManager(storage);
  });

  describe('buildContextInfo', () => {
    it('should sort segments and join with colon', () => {
      const ctx = AddressPoolManager.buildContextInfo([
        'dir:out',
        'agent:abc',
        'seq:0',
      ]);
      expect(ctx).toBe('agent:abc:dir:out:seq:0');
    });

    it('should produce same result regardless of input order', () => {
      const a = AddressPoolManager.buildContextInfo(['z', 'a', 'm']);
      const b = AddressPoolManager.buildContextInfo(['a', 'm', 'z']);
      expect(a).toBe(b);
    });
  });

  describe('supportsContextIsolation', () => {
    it('should return true when WASM module has context functions', () => {
      expect(AddressPoolManager.supportsContextIsolation()).toBe(true);
    });

    it('should return false when WASM module is not initialized', () => {
      resetWasm();
      expect(AddressPoolManager.supportsContextIsolation()).toBe(false);
      // Re-setup for remaining tests
      setupMockWasm();
    });
  });

  describe('REV32 guard', () => {
    it('should throw REV32_REQUIRED when context isolation is unavailable', () => {
      resetWasm();
      expect(() => pool.deriveEphemeralAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
      })).toThrow('REV32');
      // Re-setup for remaining tests
      setupMockWasm();
    });
  });

  describe('Solana context derivation', () => {
    it('should derive Solana address using solana_get_address_with_context', () => {
      const addr = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'solana',
        direction: 'outbound',
        txUUID: 'tx-sol-001',
      });

      expect(addr.address).toBeTruthy();
      expect(addr.address).toMatch(/^SoCtx/); // mock prefix
      expect(addr.chain).toBe('solana');
    });

    it('should derive different Solana addresses for different contexts', () => {
      const addr1 = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'solana',
        direction: 'outbound',
        txUUID: 'tx-sol-001',
      });

      const addr2 = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'solana',
        direction: 'outbound',
        txUUID: 'tx-sol-002',
      });

      expect(addr1.address).not.toBe(addr2.address);
    });
  });

  describe('deriveEphemeralAddress', () => {
    it('should derive a unique address per transaction', () => {
      const addr1 = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        txUUID: 'tx-001',
      });

      const addr2 = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        txUUID: 'tx-002',
      });

      expect(addr1.address).toBeTruthy();
      expect(addr2.address).toBeTruthy();
      expect(addr1.address).not.toBe(addr2.address);
      expect(addr1.contextInfo).not.toBe(addr2.contextInfo);
    });

    it('should set status to assigned', () => {
      const addr = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
      });

      expect(addr.status).toBe('assigned');
      expect(addr.chain).toBe('ethereum');
      expect(addr.direction).toBe('outbound');
      expect(addr.agentId).toBe('agent1');
    });

    it('should derive different addresses for different chains', () => {
      const eth = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        txUUID: 'tx-001',
      });

      const sol = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'solana',
        direction: 'outbound',
        txUUID: 'tx-001',
      });

      expect(eth.address).not.toBe(sol.address);
    });

    it('should derive different addresses for inbound vs outbound', () => {
      const outbound = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        txUUID: 'tx-001',
      });

      const inbound = pool.deriveEphemeralAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'inbound',
        txUUID: 'tx-001',
      });

      expect(outbound.address).not.toBe(inbound.address);
    });
  });

  describe('getBasicAddress', () => {
    it('should return deterministic address for same agent+chain+direction', () => {
      const addr1 = pool.getBasicAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
      });

      const addr2 = pool.getBasicAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
      });

      expect(addr1).toBe(addr2);
    });

    it('should return different addresses for different agents', () => {
      const addr1 = pool.getBasicAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
      });

      const addr2 = pool.getBasicAddress({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent2',
        chain: 'ethereum',
        direction: 'outbound',
      });

      expect(addr1).not.toBe(addr2);
    });
  });

  describe('replenishPool', () => {
    it('should pre-derive the requested number of addresses', () => {
      const derived = pool.replenishPool({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        count: 3,
      });

      expect(derived).toHaveLength(3);
      for (const addr of derived) {
        expect(addr.status).toBe('available');
      }
    });

    it('should not derive beyond the requested count', () => {
      pool.replenishPool({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        count: 3,
      });

      const second = pool.replenishPool({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        count: 3,
      });

      expect(second).toHaveLength(0); // already have 3 available
    });
  });

  describe('claimFromPool', () => {
    it('should claim an available address and mark it assigned', () => {
      pool.replenishPool({
        mnemonic: 'test mnemonic',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        count: 2,
      });

      const claimed = pool.claimFromPool({
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        txUUID: 'tx-claim-001',
      });

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('assigned');
      expect(claimed!.assignedTxUUID).toBe('tx-claim-001');
    });

    it('should return null when pool is empty', () => {
      const claimed = pool.claimFromPool({
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        txUUID: 'tx-001',
      });

      expect(claimed).toBeNull();
    });
  });

  describe('resolveAddress', () => {
    it('should return empty address for transparent level', () => {
      const result = pool.resolveAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        privacyLevel: 'transparent',
      });

      expect(result.address).toBe('');
      expect(result.contextInfo).toBeNull();
    });

    it('should return basic-mode address for basic level', () => {
      const result = pool.resolveAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        privacyLevel: 'basic',
      });

      expect(result.address).toBeTruthy();
      expect(result.contextInfo).toContain('mode:basic');
    });

    it('should derive new address for isolated level', () => {
      const result = pool.resolveAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
        privacyLevel: 'isolated',
        txUUID: 'tx-iso-001',
      });

      expect(result.address).toBeTruthy();
      expect(result.contextInfo).toBeTruthy();
      expect(result.ephemeral).not.toBeNull();
    });
  });

  describe('getAllDerivedAddresses', () => {
    it('should return all addresses for an agent', () => {
      pool.deriveEphemeralAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
      });

      pool.deriveEphemeralAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'inbound',
      });

      const all = pool.getAllDerivedAddresses('agent1');
      expect(all).toHaveLength(2);
    });
  });

  describe('dispose', () => {
    it('should cancel pending save timer', () => {
      // Bug #5: AddressPoolManager needs dispose to prevent timer leaks
      pool.deriveEphemeralAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
      });

      // Should not throw
      pool.dispose();
    });
  });

  describe('persistence', () => {
    it('should save and load pool state', async () => {
      pool.deriveEphemeralAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'outbound',
      });

      await pool.save();

      const pool2 = new AddressPoolManager(storage);
      await pool2.load();

      const all = pool2.getAllDerivedAddresses('agent1');
      expect(all).toHaveLength(1);
    });
  });
});

// ─── ContextTagManager ──────────────────────────────────────────────────────

describe('ContextTagManager', () => {
  let tagManager: ContextTagManager;

  beforeEach(() => {
    tagManager = new ContextTagManager(storage);
  });

  describe('createTag', () => {
    it('should create a context tag record', () => {
      const tag = tagManager.createTag({
        agentId: 'agent1',
        contextInfo: 'agent:agent1:dir:out:seq:0:tx:tx-001',
        derivedAddress: '0xabc123',
        chain: 'ethereum',
        direction: 'outbound',
        amount: '100',
        token: 'USDC',
        counterpartyAddress: '0xdef456',
        privacyLevel: 'isolated',
      });

      expect(tag.id).toBeTruthy();
      expect(tag.agentId).toBe('agent1');
      expect(tag.direction).toBe('outbound');
      expect(tag.amount).toBe('100');
      expect(tag.timestamp).toBeGreaterThan(0);
    });
  });

  describe('updateTagTxHash', () => {
    it('should update the tx hash on a tag', () => {
      const tag = tagManager.createTag({
        agentId: 'agent1',
        contextInfo: 'ctx:test',
        derivedAddress: '0xabc',
        chain: 'ethereum',
        direction: 'outbound',
        amount: '50',
        token: 'native',
        counterpartyAddress: '0xdef',
        privacyLevel: 'isolated',
      });

      expect(tag.txHash).toBeUndefined();

      tagManager.updateTagTxHash(tag.id, '0xtxhash123');
      const updated = tagManager.getTag(tag.id);
      expect(updated?.txHash).toBe('0xtxhash123');
    });
  });

  describe('query methods', () => {
    beforeEach(() => {
      tagManager.createTag({
        agentId: 'agent1',
        contextInfo: 'ctx:1',
        derivedAddress: '0xa1',
        chain: 'ethereum',
        direction: 'outbound',
        amount: '100',
        token: 'USDC',
        counterpartyAddress: '0xv1',
        privacyLevel: 'isolated',
      });

      tagManager.createTag({
        agentId: 'agent1',
        contextInfo: 'ctx:2',
        derivedAddress: '0xa2',
        chain: 'polygon',
        direction: 'inbound',
        amount: '200',
        token: 'USDC',
        counterpartyAddress: '0xv2',
        privacyLevel: 'basic',
      });

      tagManager.createTag({
        agentId: 'agent2',
        contextInfo: 'ctx:3',
        derivedAddress: '0xb1',
        chain: 'ethereum',
        direction: 'outbound',
        amount: '300',
        token: 'native',
        counterpartyAddress: '0xv3',
        privacyLevel: 'isolated',
      });
    });

    it('should query by agent', () => {
      expect(tagManager.getTagsByAgent('agent1')).toHaveLength(2);
      expect(tagManager.getTagsByAgent('agent2')).toHaveLength(1);
    });

    it('should query by chain', () => {
      expect(tagManager.getTagsByChain('ethereum')).toHaveLength(2);
      expect(tagManager.getTagsByChain('polygon')).toHaveLength(1);
    });

    it('should query by address', () => {
      expect(tagManager.getTagsByAddress('0xa1')).toHaveLength(1);
      expect(tagManager.getTagsByAddress('0xv2')).toHaveLength(1); // counterparty
    });

    it('should return all tags', () => {
      expect(tagManager.getAllTags()).toHaveLength(3);
    });
  });

  describe('uploadToArweave', () => {
    it('should encrypt and upload when uploader is set', async () => {
      let uploadedData: Uint8Array | null = null;
      tagManager.setArweaveUploader({
        async upload(data: Uint8Array, _contentType: string): Promise<string> {
          uploadedData = data;
          return 'ar_tx_mock_123';
        },
      });

      const tag = tagManager.createTag({
        agentId: 'agent1',
        contextInfo: 'ctx:test',
        derivedAddress: '0xabc',
        chain: 'ethereum',
        direction: 'outbound',
        amount: '100',
        token: 'USDC',
        counterpartyAddress: '0xdef',
        privacyLevel: 'isolated',
      });

      const txId = await tagManager.uploadToArweave(tag.id, 'bW9ja194aWRlbnRpdHk=');
      expect(txId).toBe('ar_tx_mock_123');
      expect(uploadedData).not.toBeNull();
    });

    it('should return null when no uploader is set', async () => {
      const tag = tagManager.createTag({
        agentId: 'agent1',
        contextInfo: 'ctx:test',
        derivedAddress: '0xabc',
        chain: 'ethereum',
        direction: 'outbound',
        amount: '100',
        token: 'USDC',
        counterpartyAddress: '0xdef',
        privacyLevel: 'isolated',
      });

      const txId = await tagManager.uploadToArweave(tag.id, 'bW9ja194aWRlbnRpdHk=');
      expect(txId).toBeNull();
    });
  });

  describe('batchArchive', () => {
    it('should not re-archive already-archived tags', async () => {
      // Bug #15: batchArchive should skip tags that have already been archived
      let uploadCount = 0;
      tagManager.setArweaveUploader({
        async upload(_data: Uint8Array, _ct: string): Promise<string> {
          uploadCount++;
          return `ar_tx_${uploadCount}`;
        },
      });

      const tag = tagManager.createTag({
        agentId: 'agent1',
        contextInfo: 'ctx:batch',
        derivedAddress: '0xbatch1',
        chain: 'ethereum',
        direction: 'outbound',
        amount: '100',
        token: 'native',
        counterpartyAddress: '0xdef',
        txHash: '0xtx1',
        privacyLevel: 'isolated',
      });

      // First batch should archive the tag
      const count1 = await tagManager.batchArchive('bW9ja194aWRlbnRpdHk=', 'arweave');
      expect(count1).toBe(1);
      expect(uploadCount).toBe(1);

      // Tag should now be marked as archived
      const updatedTag = tagManager.getTag(tag.id);
      expect(updatedTag?.archivedAt).toBeTruthy();
      expect(updatedTag?.arweaveTxId).toBe('ar_tx_1');

      // Second batch should skip the already-archived tag
      const count2 = await tagManager.batchArchive('bW9ja194aWRlbnRpdHk=', 'arweave');
      expect(count2).toBe(0);
      expect(uploadCount).toBe(1); // no additional uploads
    });
  });

  describe('dispose', () => {
    it('should cancel pending save timer', () => {
      // Bug #6: ContextTagManager needs dispose to prevent timer leaks
      tagManager.createTag({
        agentId: 'agent1',
        contextInfo: 'ctx:dispose',
        derivedAddress: '0xd1',
        chain: 'ethereum',
        direction: 'outbound',
        amount: '100',
        token: 'native',
        counterpartyAddress: '0xd2',
        privacyLevel: 'isolated',
      });

      // Should not throw
      tagManager.dispose();
    });
  });

  describe('persistence', () => {
    it('should save and load tags', async () => {
      tagManager.createTag({
        agentId: 'agent1',
        contextInfo: 'ctx:persist',
        derivedAddress: '0xabc',
        chain: 'ethereum',
        direction: 'outbound',
        amount: '100',
        token: 'USDC',
        counterpartyAddress: '0xdef',
        privacyLevel: 'isolated',
      });

      await tagManager.save();

      const tagManager2 = new ContextTagManager(storage);
      await tagManager2.load();

      expect(tagManager2.getAllTags()).toHaveLength(1);
      expect(tagManager2.getTagsByAgent('agent1')).toHaveLength(1);
    });
  });
});

// ─── ConsolidationScheduler ─────────────────────────────────────────────────

describe('ConsolidationScheduler', () => {
  let addressPool: AddressPoolManager;
  let tagManager: ContextTagManager;
  let scheduler: ConsolidationScheduler;

  beforeEach(() => {
    addressPool = new AddressPoolManager(storage);
    tagManager = new ContextTagManager(storage);
    scheduler = new ConsolidationScheduler(storage, addressPool, tagManager);
  });

  afterEach(() => {
    scheduler.dispose();
  });

  describe('consolidateNow', () => {
    it('should return null when no funded addresses exist', async () => {
      const result = await scheduler.consolidateNow({
        agentId: 'agent1',
        chain: 'ethereum',
        vaultAddress: '0xvault',
        token: 'native',
      });

      expect(result).toBeNull();
    });

    it('should consolidate funded addresses when handler is set', async () => {
      // Create an inbound address and mark it as funded
      const addr = addressPool.deriveEphemeralAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'inbound',
      });

      addressPool.updateAddressStatus('agent1', 'ethereum', addr.address, 'funded');

      // Create a context tag for the address
      tagManager.createTag({
        agentId: 'agent1',
        contextInfo: addr.contextInfo,
        derivedAddress: addr.address,
        chain: 'ethereum',
        direction: 'inbound',
        amount: '100',
        token: 'native',
        counterpartyAddress: '0xsender',
        privacyLevel: 'isolated',
      });

      // Set up handler
      scheduler.setHandler({
        async consolidate() {
          return '0xconsolidation_tx_hash';
        },
      });

      const result = await scheduler.consolidateNow({
        agentId: 'agent1',
        chain: 'ethereum',
        vaultAddress: '0xvault',
        token: 'native',
      });

      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.txHash).toBe('0xconsolidation_tx_hash');
      expect(result!.addresses).toContain(addr.address);
    });

    it('should mark addresses as consolidated after success', async () => {
      const addr = addressPool.deriveEphemeralAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'inbound',
      });

      addressPool.updateAddressStatus('agent1', 'ethereum', addr.address, 'funded');

      scheduler.setHandler({
        async consolidate() {
          return '0xtx';
        },
      });

      await scheduler.consolidateNow({
        agentId: 'agent1',
        chain: 'ethereum',
        vaultAddress: '0xvault',
        token: 'native',
      });

      // Address should now be consolidated (no longer in getAddressesForConsolidation)
      const pending = addressPool.getAddressesForConsolidation('agent1', 'ethereum');
      expect(pending).toHaveLength(0);
    });
  });

  describe('shouldConsolidate', () => {
    it('should return false when below threshold', () => {
      const policy: PrivacyPolicy = {
        level: 'isolated',
        auditStorage: 'arweave',
        batchConsolidation: true,
        consolidationThreshold: 5,
        preDerivationPoolSize: 10,
      };

      const result = scheduler.shouldConsolidate('agent1', 'ethereum', policy);
      expect(result).toBe(false);
    });

    it('should return true when at threshold', () => {
      // Create and fund multiple addresses
      for (let i = 0; i < 5; i++) {
        const addr = addressPool.deriveEphemeralAddress({
          mnemonic: 'test',
          passphrase: 'pass',
          agentId: 'agent1',
          chain: 'ethereum',
          direction: 'inbound',
        });
        addressPool.updateAddressStatus('agent1', 'ethereum', addr.address, 'funded');
      }

      const policy: PrivacyPolicy = {
        level: 'isolated',
        auditStorage: 'arweave',
        batchConsolidation: true,
        consolidationThreshold: 5,
        preDerivationPoolSize: 10,
      };

      const result = scheduler.shouldConsolidate('agent1', 'ethereum', policy);
      expect(result).toBe(true);
    });
  });

  describe('getConsolidationHistory', () => {
    it('should return history for an agent', async () => {
      const addr = addressPool.deriveEphemeralAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'inbound',
      });
      addressPool.updateAddressStatus('agent1', 'ethereum', addr.address, 'funded');

      scheduler.setHandler({
        async consolidate() {
          return '0xtx';
        },
      });

      await scheduler.consolidateNow({
        agentId: 'agent1',
        chain: 'ethereum',
        vaultAddress: '0xvault',
        token: 'native',
      });

      const history = scheduler.getConsolidationHistory('agent1');
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('completed');
    });
  });

  describe('persistence', () => {
    it('should save and load consolidation records', async () => {
      const addr = addressPool.deriveEphemeralAddress({
        mnemonic: 'test',
        passphrase: 'pass',
        agentId: 'agent1',
        chain: 'ethereum',
        direction: 'inbound',
      });
      addressPool.updateAddressStatus('agent1', 'ethereum', addr.address, 'funded');

      scheduler.setHandler({
        async consolidate() {
          return '0xtx';
        },
      });

      await scheduler.consolidateNow({
        agentId: 'agent1',
        chain: 'ethereum',
        vaultAddress: '0xvault',
        token: 'native',
      });

      await scheduler.save();

      const scheduler2 = new ConsolidationScheduler(storage, addressPool, tagManager);
      await scheduler2.load();

      const history = scheduler2.getConsolidationHistory('agent1');
      expect(history).toHaveLength(1);
    });
  });
});
