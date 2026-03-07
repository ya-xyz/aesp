/**
 * AESP — ZK-ACE Prover
 *
 * TypeScript wrapper for ZK-ACE zero-knowledge proof generation and
 * verification via the acegf-wallet WASM module.
 *
 * Security invariant:
 *   The REV (Root Entropy Value) is extracted from the mnemonic INSIDE the
 *   WASM sandbox, used for proof generation, then zeroized. It NEVER
 *   appears in any JavaScript variable or return value.
 *
 * Usage:
 *   1. Load proving/verifying keys (from bundled files or network).
 *   2. Call `zkProve()` with the mnemonic and witness parameters.
 *   3. Submit the proof + public inputs to the on-chain verifier.
 *   4. Optionally call `zkVerify()` for off-chain pre-validation.
 */

import { getWasmModule } from './wasm-bridge.js';
import { CryptoError } from '../types/index.js';
import type {
  ZkProveRequest,
  ZkProveResult,
  ZkSetupResult,
  ZkKeyStore,
  ZkReplayMode,
} from '../types/index.js';

// ─── Key Management ─────────────────────────────────────────────────────────

/**
 * In-memory key store for pre-loaded proving and verifying keys.
 *
 * Keys are loaded once (from bundled files or network fetch) and reused
 * for all subsequent proofs. Separate key pairs exist for each replay mode
 * because they produce incompatible circuits.
 */
const keyStore: ZkKeyStore = {
  provingKeys: { nonce: null, nullifier: null },
  verifyingKeys: { nonce: null, nullifier: null },
};

/**
 * Load a proving key into the key store.
 *
 * @param mode - Replay mode this key was generated for.
 * @param keyBytes - Raw binary proving key (from trusted setup).
 */
export function loadProvingKey(mode: ZkReplayMode, keyBytes: Uint8Array): void {
  keyStore.provingKeys[mode] = keyBytes;
}

/**
 * Load a verifying key into the key store.
 *
 * @param mode - Replay mode this key was generated for.
 * @param keyBytes - Raw binary verifying key (from trusted setup).
 */
export function loadVerifyingKey(mode: ZkReplayMode, keyBytes: Uint8Array): void {
  keyStore.verifyingKeys[mode] = keyBytes;
}

/**
 * Get the loaded proving key for a replay mode.
 * Throws if not loaded.
 */
function getProvingKey(mode: ZkReplayMode): Uint8Array {
  const pk = keyStore.provingKeys[mode];
  if (!pk) {
    throw new CryptoError(
      `ZK-ACE proving key not loaded for mode '${mode}'. ` +
        `Call loadProvingKey('${mode}', keyBytes) first.`,
    );
  }
  return pk;
}

/**
 * Get the loaded verifying key for a replay mode.
 * Throws if not loaded.
 */
function getVerifyingKey(mode: ZkReplayMode): Uint8Array {
  const vk = keyStore.verifyingKeys[mode];
  if (!vk) {
    throw new CryptoError(
      `ZK-ACE verifying key not loaded for mode '${mode}'. ` +
        `Call loadVerifyingKey('${mode}', keyBytes) first.`,
    );
  }
  return vk;
}

/**
 * Check if ZK-ACE keys are loaded for a given replay mode.
 */
export function isZkReady(mode: ZkReplayMode): boolean {
  return keyStore.provingKeys[mode] !== null;
}

/**
 * Reset the key store (primarily for testing).
 */
export function resetZkKeys(): void {
  keyStore.provingKeys.nonce = null;
  keyStore.provingKeys.nullifier = null;
  keyStore.verifyingKeys.nonce = null;
  keyStore.verifyingKeys.nullifier = null;
}

// ─── ZK-ACE Capabilities Check ──────────────────────────────────────────────

/**
 * Check if the loaded WASM module supports ZK-ACE operations.
 *
 * Returns false if the WASM module was built without the `zk` feature,
 * or if a mock module without ZK functions is injected.
 */
export function supportsZkAce(): boolean {
  try {
    const wasm = getWasmModule();
    return typeof wasm.zkace_prove_wasm === 'function';
  } catch {
    return false;
  }
}

// ─── Trusted Setup ──────────────────────────────────────────────────────────

/**
 * Run a ZK-ACE trusted setup (development/testing only).
 *
 * In production, proving and verifying keys come from a multi-party
 * computation ceremony (MPC). This function is for development convenience.
 *
 * @param mode - Replay mode to generate keys for.
 * @returns Setup result with hex-encoded pk and vk.
 */
export function zkSetup(mode: ZkReplayMode): ZkSetupResult {
  const wasm = getWasmModule();
  if (!wasm.zkace_setup_wasm) {
    throw new CryptoError('WASM module does not support zkace_setup_wasm. Build with --features zk.');
  }

  const resultJson = wasm.zkace_setup_wasm(mode);
  const parsed = JSON.parse(resultJson) as { pk_hex: string; vk_hex: string };

  return {
    pkHex: parsed.pk_hex,
    vkHex: parsed.vk_hex,
  };
}

/**
 * Run trusted setup and immediately load keys into the key store.
 *
 * Convenience function for development. Combines `zkSetup()` +
 * `loadProvingKey()` + `loadVerifyingKey()`.
 *
 * @param mode - Replay mode to generate and load keys for.
 */
export function zkSetupAndLoad(mode: ZkReplayMode): ZkSetupResult {
  const result = zkSetup(mode);

  // Convert hex to Uint8Array
  const pkBytes = hexToBytes(result.pkHex);
  const vkBytes = hexToBytes(result.vkHex);

  loadProvingKey(mode, pkBytes);
  loadVerifyingKey(mode, vkBytes);

  return result;
}

// ─── Prove ──────────────────────────────────────────────────────────────────

/**
 * Generate a ZK-ACE authorization proof.
 *
 * The mnemonic (containing the REV) is passed to WASM where the REV is
 * extracted, used for proof generation, and then securely zeroized.
 * The REV never appears in JavaScript memory.
 *
 * @param request - Proof generation parameters.
 * @returns Groth16 proof and public inputs.
 *
 * @example
 * ```typescript
 * const result = zkProve({
 *   mnemonic: '...',        // 24-word BIP39
 *   passphrase: '...',      // wallet passphrase
 *   salt: '12345',          // identity commitment salt
 *   ctx: { algId: '0', domain: '1', index: '0' },
 *   nonce: '42',            // replay-prevention nonce
 *   txHash: '0xabcd...',    // transaction hash to authorize
 *   replayMode: 'nonce',    // NonceRegistry mode
 * });
 *
 * // result.proof     → "0x..." (Groth16 proof)
 * // result.publicInputs → ["0x...", "0x...", ...] (5 elements)
 * ```
 */
export function zkProve(request: ZkProveRequest): ZkProveResult {
  const wasm = getWasmModule();
  if (!wasm.zkace_prove_wasm) {
    throw new CryptoError('WASM module does not support zkace_prove_wasm. Build with --features zk.');
  }

  const pk = getProvingKey(request.replayMode);

  const resultJson = wasm.zkace_prove_wasm(
    request.mnemonic,
    request.passphrase,
    request.salt,
    request.ctx.algId,
    request.ctx.domain,
    request.ctx.index,
    request.nonce,
    request.txHash,
    request.replayMode,
    pk,
  );

  return JSON.parse(resultJson) as ZkProveResult;
}

// ─── Verify ─────────────────────────────────────────────────────────────────

/**
 * Verify a ZK-ACE authorization proof off-chain.
 *
 * This is primarily for pre-validation before submitting to the on-chain
 * verifier. The canonical verification happens in the Solidity contract.
 *
 * @param proofResult - The result from `zkProve()`.
 * @param mode - Replay mode the proof was generated for.
 * @returns `true` if the proof is valid.
 */
export function zkVerify(proofResult: ZkProveResult, mode: ZkReplayMode): boolean {
  const wasm = getWasmModule();
  if (!wasm.zkace_verify_wasm) {
    throw new CryptoError(
      'WASM module does not support zkace_verify_wasm. Build with --features zk.',
    );
  }

  const vk = getVerifyingKey(mode);
  const proofJson = JSON.stringify(proofResult);

  return wasm.zkace_verify_wasm(proofJson, vk);
}

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Convert a "0x"-prefixed hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
