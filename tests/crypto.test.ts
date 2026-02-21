/**
 * AESP — Crypto Module Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockWasm, teardownMockWasm } from './helpers.js';
import {
  signMessage,
  signWithXidentity,
  verifyXidentitySignature,
  signTypedData,
  signWithAgentKey,
  encryptForXidentity,
  decryptWithMnemonic,
  computeSharedKey,
  encryptAgentMessage,
  decryptAgentMessage,
  sha256,
  hashPolicy,
  hashCommitment,
  generateUUID,
  isWasmInitialized,
  resetWasm,
} from '../src/crypto/index.js';
import { CryptoError } from '../src/types/index.js';

describe('Crypto Module', () => {
  beforeEach(() => {
    setupMockWasm();
  });

  afterEach(() => {
    teardownMockWasm();
  });

  // ─── WASM Bridge ────────────────────────────────────────────────────────

  describe('WASM Bridge', () => {
    it('should report initialized after setup', () => {
      expect(isWasmInitialized()).toBe(true);
    });

    it('should report not initialized after reset', () => {
      resetWasm();
      expect(isWasmInitialized()).toBe(false);
    });

    it('should throw CryptoError when calling sign without init', () => {
      resetWasm();
      expect(() => signMessage('mnemonic', 'pass', 'hello')).toThrow(CryptoError);
    });
  });

  // ─── Signing ────────────────────────────────────────────────────────────

  describe('Signing', () => {
    it('should sign message with ed25519', () => {
      const result = signMessage('test mnemonic', 'pass', 'hello world');
      expect(result.signature).toBeTruthy();
      expect(result.publicKey).toBeTruthy();
      expect(typeof result.signature).toBe('string');
    });

    it('should sign message with secp256k1', () => {
      const result = signMessage('test mnemonic', 'pass', 'hello world', 'secp256k1');
      expect(result.signature).toBeTruthy();
    });

    it('should produce different signatures for different messages', () => {
      const sig1 = signMessage('mnemonic', 'pass', 'message1');
      const sig2 = signMessage('mnemonic', 'pass', 'message2');
      expect(sig1.signature).not.toBe(sig2.signature);
    });

    it('should sign with xidentity', () => {
      const sig = signWithXidentity('mnemonic', 'pass', 'test message');
      expect(sig).toBeTruthy();
      expect(typeof sig).toBe('string');
    });

    it('should verify xidentity signature', () => {
      const result = verifyXidentitySignature(
        'bW9ja194aWRlbnRpdHk=',
        'test message',
        'some_signature',
      );
      expect(result).toBe(true);
    });

    it('should sign typed data (EIP-712)', () => {
      const sig = signTypedData('mnemonic', 'pass', 'abcdef1234567890');
      expect(sig).toBeTruthy();
      expect(typeof sig).toBe('string');
    });

    it('should sign with agent sub-key', () => {
      const result = signWithAgentKey('mnemonic', 'pass', 'agent message', 0);
      expect(result.signature).toBeTruthy();
      expect(result.publicKey).toBeTruthy();
      // publicKey is the master signing key; agentPublicKey is the derived child key
      expect(result.agentPublicKey).toBeTruthy();
      expect(result.agentPublicKey).not.toBe(result.publicKey);
    });

    it('should produce different agent keys for different indices', () => {
      const key0 = signWithAgentKey('mnemonic', 'pass', 'msg', 0);
      const key1 = signWithAgentKey('mnemonic', 'pass', 'msg', 1);
      // agentPublicKey (derived child key) differs per index
      expect(key0.agentPublicKey).not.toBe(key1.agentPublicKey);
      // publicKey is the master signing key (distinct from agentPublicKey)
      expect(key0.publicKey).not.toBe(key0.agentPublicKey);
      expect(key1.publicKey).not.toBe(key1.agentPublicKey);
    });
  });

  // ─── Encryption ─────────────────────────────────────────────────────────

  describe('Encryption', () => {
    it('should encrypt for xidentity', () => {
      const encrypted = encryptForXidentity('bW9ja194aWRlbnRpdHk=', 'secret message');
      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe('string');
    });

    it('should decrypt with mnemonic', () => {
      const encrypted = encryptForXidentity('bW9ja194aWRlbnRpdHk=', 'secret message');
      const decrypted = decryptWithMnemonic(
        'mnemonic',
        'pass',
        encrypted,
        'sender_pub_b64',
      );
      expect(decrypted).toBe('secret message');
    });

    it('should compute shared DH key', () => {
      const key = computeSharedKey('mnemonic', 'pass', 'peer_pub_b64');
      expect(key).toBeTruthy();
      expect(typeof key).toBe('string');
    });

    it('should encrypt/decrypt agent message envelope', () => {
      const payload = { action: 'buy', item: 'laptop', price: 999 };
      const envelope = encryptAgentMessage('bW9ja194aWRlbnRpdHk=', payload);

      expect(envelope.version).toBe('1.0');
      expect(envelope.algorithm).toBe('X25519-ECDH-AES-GCM');
      expect(envelope.ciphertext).toBeTruthy();
      expect(envelope.messageId).toBeTruthy(); // unique message ID for replay protection
      expect(envelope.timestamp).toBeGreaterThan(0);

      const decrypted = decryptAgentMessage(
        'mnemonic',
        'pass',
        envelope,
        'sender_pub_b64',
      );
      expect(decrypted).toEqual(payload);
    });
  });

  // ─── Hashing ────────────────────────────────────────────────────────────

  describe('Hashing', () => {
    it('should compute SHA-256', async () => {
      const hash = await sha256('hello world');
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should produce same hash for same input', async () => {
      const hash1 = await sha256('deterministic');
      const hash2 = await sha256('deterministic');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await sha256('input1');
      const hash2 = await sha256('input2');
      expect(hash1).not.toBe(hash2);
    });

    it('should hash policy deterministically', async () => {
      const policy = { maxAmount: 100, chain: 'solana' };
      const hash1 = await hashPolicy(policy);
      const hash2 = await hashPolicy(policy);
      expect(hash1).toBe(hash2);
    });

    it('should hash commitment', async () => {
      const hash = await hashCommitment(
        { name: 'YalletAgentCommitment', version: '1', chainId: 1 },
        { buyerAgent: 'buyer', sellerAgent: 'seller', price: '100' },
      );
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should generate UUID', () => {
      const uuid = generateUUID();
      expect(uuid).toBeTruthy();
      expect(uuid.length).toBe(36);
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
      expect(uuids.size).toBe(100);
    });
  });
});
