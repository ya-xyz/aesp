/**
 * AESP — Cryptographic Signing
 *
 * Signing and verification operations using acegf-wallet WASM.
 * Supports Ed25519 (Solana/general), secp256k1 (EVM), and EIP-712 typed data.
 */

import type { HexString, Base64String, CurveType, SignatureResult } from '../types/index.js';
import { CryptoError } from '../types/index.js';
import { getWasmModule } from './wasm-bridge.js';

// ─── Message Signing ─────────────────────────────────────────────────────────

/**
 * Sign a message with the master key using the specified curve.
 */
export function signMessage(
  mnemonic: string,
  passphrase: string,
  message: string,
  curve: CurveType = 'ed25519',
): SignatureResult {
  const wasm = getWasmModule();
  try {
    const result = wasm.acegf_sign_message_wasm(mnemonic, passphrase, message, curve);
    const parsed = JSON.parse(result);
    return {
      signature: parsed.signature,
      publicKey: parsed.public_key ?? parsed.publicKey,
    };
  } catch (error) {
    throw new CryptoError(
      `Failed to sign message: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── XIdentity Signing ──────────────────────────────────────────────────────

/**
 * Sign a message using the xidentity key (Ed25519).
 * This produces signatures verifiable by any party with the xidentity public key.
 */
export function signWithXidentity(
  mnemonic: string,
  passphrase: string,
  message: string,
): string {
  const wasm = getWasmModule();
  try {
    return wasm.acegf_xidentity_sign_wasm(mnemonic, passphrase, message);
  } catch (error) {
    throw new CryptoError(
      `Failed to sign with xidentity: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verify a signature against an xidentity public key.
 */
export function verifyXidentitySignature(
  xidentityB64: Base64String,
  message: string,
  signature: string,
): boolean {
  const wasm = getWasmModule();
  try {
    return wasm.acegf_xidentity_verify_wasm(xidentityB64, message, signature);
  } catch (error) {
    throw new CryptoError(
      `Failed to verify xidentity signature: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── EIP-712 Typed Data Signing ──────────────────────────────────────────────

/**
 * Sign EIP-712 typed data hash (for agent commitments).
 * The caller is responsible for computing the typed data hash per EIP-712 spec.
 */
export function signTypedData(
  mnemonic: string,
  passphrase: string,
  typedDataHash: HexString,
): string {
  const wasm = getWasmModule();
  try {
    return wasm.evm_sign_typed_data(mnemonic, passphrase, typedDataHash);
  } catch (error) {
    throw new CryptoError(
      `Failed to sign typed data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── Agent Sub-Key Signing ───────────────────────────────────────────────────

/**
 * Sign a message using a derived agent sub-key.
 * Uses BIP44 path: m/44'/501'/0'/0'/{agentIndex}'
 *
 * The signature is produced by the master key with the derivation path prepended
 * to the message, ensuring path-scoped uniqueness.  The returned `publicKey` is
 * the master signing key that actually produced the signature — this is the key
 * a verifier needs.  The derived child public key is returned separately as
 * `agentPublicKey` for identity/linking purposes only.
 */
export function signWithAgentKey(
  mnemonic: string,
  passphrase: string,
  message: string,
  agentIndex: number,
): SignatureResult & { agentPublicKey: HexString } {
  const wasm = getWasmModule();

  if (wasm.derive_child_key_wasm) {
    try {
      const path = `m/44'/501'/0'/0'/${agentIndex}'`;
      const derivedResult = wasm.derive_child_key_wasm(mnemonic, passphrase, path);
      const derivedParsed = JSON.parse(derivedResult);
      const agentPublicKey: string = derivedParsed.public_key ?? derivedParsed.publicKey;

      // Sign using master key with path-scoped message for uniqueness.
      const sigResult = wasm.acegf_sign_message_wasm(
        mnemonic,
        passphrase,
        `${path}:${message}`,
        'ed25519',
      );
      const sigParsed = JSON.parse(sigResult);

      return {
        signature: sigParsed.signature,
        // publicKey = the key that produced the signature (master key)
        publicKey: sigParsed.public_key ?? sigParsed.publicKey,
        // agentPublicKey = the derived child key (for agent identity only)
        agentPublicKey,
      };
    } catch (error) {
      throw new CryptoError(
        `Failed to sign with agent key: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new CryptoError(
    'Agent key signing requires WASM with derive_child_key_wasm (no fallback to master key)',
    { code: 'WASM_AGENT_KEY_REQUIRED' },
  );
}
