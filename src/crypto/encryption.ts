/**
 * AESP — Encryption
 *
 * End-to-end encryption for agent-to-agent communication.
 * Uses X25519 ECDH + AES-GCM via acegf-wallet WASM.
 */

import type { Base64String } from '../types/index.js';
import { CryptoError } from '../types/index.js';
import { getWasmModule } from './wasm-bridge.js';

// ─── E2EE Encryption ─────────────────────────────────────────────────────────

/**
 * Encrypt a message for a recipient identified by their xidentity public key.
 * Uses X25519 key exchange + AES-GCM encryption.
 *
 * @returns Base64-encoded encrypted payload
 */
export function encryptForXidentity(
  recipientXidentityB64: Base64String,
  plaintext: string,
): string {
  const wasm = getWasmModule();
  try {
    return wasm.acegf_encrypt_for_xidentity(recipientXidentityB64, plaintext);
  } catch (error) {
    throw new CryptoError(
      `Encryption failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Decrypt a message using the wallet's mnemonic and sender's public key.
 * Reverses X25519 + AES-GCM encryption.
 *
 * @returns Decrypted plaintext
 */
export function decryptWithMnemonic(
  mnemonic: string,
  passphrase: string,
  encryptedB64: string,
  senderPubB64: Base64String,
): string {
  const wasm = getWasmModule();
  try {
    return wasm.acegf_decrypt_with_mnemonic_wasm(
      mnemonic,
      passphrase,
      encryptedB64,
      senderPubB64,
    );
  } catch (error) {
    throw new CryptoError(
      `Decryption failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── Diffie-Hellman Key Exchange ─────────────────────────────────────────────

/**
 * Compute a shared DH key with a peer for establishing a secure channel.
 *
 * @returns Base64-encoded shared secret
 */
export function computeSharedKey(
  mnemonic: string,
  passphrase: string,
  peerPubB64: Base64String,
): string {
  const wasm = getWasmModule();
  try {
    return wasm.acegf_compute_dh_key_wasm(mnemonic, passphrase, peerPubB64);
  } catch (error) {
    throw new CryptoError(
      `DH key exchange failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── Encrypt Agent Message ───────────────────────────────────────────────────

/**
 * Encrypt an agent message payload for secure transport.
 * Wraps the raw payload in a structured encrypted envelope.
 */
export function encryptAgentMessage(
  recipientXidentityB64: Base64String,
  payload: unknown,
): EncryptedEnvelope {
  const plaintext = JSON.stringify(payload);
  const encrypted = encryptForXidentity(recipientXidentityB64, plaintext);

  return {
    version: '1.0',
    algorithm: 'X25519-ECDH-AES-GCM',
    ciphertext: encrypted,
    // messageId: unique identifier for replay protection and deduplication.
    // The actual AES-GCM nonce is embedded inside the encrypted ciphertext by WASM.
    messageId: crypto.randomUUID(),
    timestamp: Date.now(),
  };
}

/**
 * Decrypt an agent message envelope.
 */
export function decryptAgentMessage<T = unknown>(
  mnemonic: string,
  passphrase: string,
  envelope: EncryptedEnvelope,
  senderPubB64: Base64String,
): T {
  const plaintext = decryptWithMnemonic(
    mnemonic,
    passphrase,
    envelope.ciphertext,
    senderPubB64,
  );
  try {
    return JSON.parse(plaintext) as T;
  } catch {
    throw new CryptoError('Failed to parse decrypted message: invalid JSON payload');
  }
}

// ─── Encrypted Envelope ──────────────────────────────────────────────────────

export interface EncryptedEnvelope {
  version: '1.0';
  algorithm: 'X25519-ECDH-AES-GCM';
  ciphertext: string;
  /**
   * Unique message identifier for replay protection and deduplication.
   * NOT the AES-GCM nonce (that is embedded in the ciphertext by WASM).
   */
  messageId: string;
  timestamp: number;
}
