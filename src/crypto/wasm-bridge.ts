/**
 * AESP — WASM Bridge
 *
 * Thin abstraction layer over acegf-wallet WASM module.
 * Provides typed wrappers around raw WASM exports for use by AESP modules.
 *
 * In production, this initializes the actual WASM module.
 * For testing, inject a mock via `setWasmModule()`.
 */

import { CryptoError } from '../types/index.js';

// ─── WASM Module Interface ───────────────────────────────────────────────────

/**
 * Interface matching the acegf-wallet WASM exports we need.
 * This allows injecting mocks for testing.
 */
export interface AcegfWasmModule {
  // Wallet generation
  generate_wasm(passphrase: string): string;
  view_wallet_unified_wasm(mnemonic: string, passphrase: string): string;

  // Signing
  acegf_sign_message_wasm(
    mnemonic: string,
    passphrase: string,
    message: string,
    curve: string,
  ): string;

  // XIdentity operations
  acegf_xidentity_sign_wasm(
    mnemonic: string,
    passphrase: string,
    message: string,
  ): string;

  acegf_xidentity_verify_wasm(
    xidentity_b64: string,
    message: string,
    signature: string,
  ): boolean;

  // Encryption (X25519 ECDH + AES-GCM)
  acegf_encrypt_for_xidentity(
    recipient_xidentity_b64: string,
    plaintext: string,
  ): string;

  acegf_decrypt_with_mnemonic_wasm(
    mnemonic: string,
    passphrase: string,
    encrypted_b64: string,
    sender_pub_b64: string,
  ): string;

  // Diffie-Hellman key exchange
  acegf_compute_dh_key_wasm(
    mnemonic: string,
    passphrase: string,
    peer_pub_b64: string,
  ): string;

  // EVM typed data signing (EIP-712)
  evm_sign_typed_data(
    mnemonic: string,
    passphrase: string,
    typed_data_hash: string,
  ): string;

  // Key derivation (sub-path)
  derive_child_key_wasm?(
    mnemonic: string,
    passphrase: string,
    path: string,
  ): string;

  // SHA-256 hashing
  sha256_wasm?(data: string): string;

  // ─── Context-Isolated Address Derivation (REV32 only) ─────────────────

  /** View all chain addresses for a given context (REV32 wallets only). */
  view_wallet_unified_with_context_wasm?(
    mnemonic: string,
    passphrase: string,
    context: string,
  ): string;

  /** Get EVM address for a given context. */
  evm_get_address_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
  ): string;

  /** Sign EIP-1559 transaction with context-derived key. */
  evm_sign_eip1559_transaction_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
    chain_id: number,
    nonce: string,
    max_priority_fee_per_gas: string,
    max_fee_per_gas: string,
    gas_limit: string,
    to: string,
    value: string,
    data: string,
  ): string;

  /** Sign personal message with context-derived key. */
  evm_sign_personal_message_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
    message: string,
  ): string;

  /** Sign EIP-712 typed data with context-derived key. */
  evm_sign_typed_data_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
    typed_data_hash: string,
  ): string;

  // ─── Context-Isolated Solana Operations (REV32 only) ─────────────────

  /** Get Solana address for a given context. */
  solana_get_address_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
  ): string;

  /** Sign a Solana transaction with context-derived Ed25519 key. */
  solana_sign_transaction_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
    transaction_b64: string,
  ): string;

  /** Sign an arbitrary message with context-derived Ed25519 key. */
  solana_sign_message_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
    message: string,
  ): string;
}

// ─── Module State ────────────────────────────────────────────────────────────

let wasmModule: AcegfWasmModule | null = null;
let initialized = false;

/**
 * Set the WASM module instance.
 * Call this after loading acegf.wasm, or inject a mock for testing.
 */
export function setWasmModule(module: AcegfWasmModule): void {
  wasmModule = module;
  initialized = true;
}

/**
 * Get the current WASM module, throwing if not initialized.
 */
export function getWasmModule(): AcegfWasmModule {
  if (!wasmModule || !initialized) {
    throw new CryptoError('WASM module not initialized. Call setWasmModule() or initWasm() first.');
  }
  return wasmModule;
}

/**
 * Check if WASM module is initialized.
 */
export function isWasmInitialized(): boolean {
  return initialized;
}

/**
 * Initialize WASM from the default path.
 * This is for browser/Node.js environments where dynamic import is available.
 */
export async function initWasm(wasmPath?: string): Promise<void> {
  if (initialized) return;

  try {
    // Dynamic import of the WASM init function
    // In a real build, this would import from '../wasm/acegf.js' or a configured path
    const path = wasmPath ?? new URL('../../wasm/acegf.js', import.meta.url).href;
    const wasmInit = await import(/* @vite-ignore */ path);

    if (typeof wasmInit.default === 'function') {
      await wasmInit.default();
    }

    // Extract all exported functions as our module interface
    wasmModule = wasmInit as unknown as AcegfWasmModule;
    initialized = true;
  } catch (error) {
    throw new CryptoError(
      `Failed to initialize WASM: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Reset WASM state (primarily for testing).
 */
export function resetWasm(): void {
  wasmModule = null;
  initialized = false;
}
