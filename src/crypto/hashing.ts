/**
 * AESP — Hashing Utilities
 *
 * SHA-256 and other hash functions used across AESP modules.
 * Falls back to Web Crypto API if WASM sha256 is unavailable.
 */

import type { HexString } from '../types/index.js';
import { CryptoError } from '../types/index.js';
import { getWasmModule, isWasmInitialized } from './wasm-bridge.js';

// ─── SHA-256 ─────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a string.
 * Uses WASM if available, falls back to Web Crypto API.
 */
export async function sha256(data: string): Promise<HexString> {
  // Try WASM first
  if (isWasmInitialized()) {
    const wasm = getWasmModule();
    if (wasm.sha256_wasm) {
      try {
        return wasm.sha256_wasm(data);
      } catch {
        // Fall through to Web Crypto
      }
    }
  }

  // Fallback: Web Crypto API
  try {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    throw new CryptoError(
      `SHA-256 failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Synchronous SHA-256 using WASM only (throws if WASM unavailable).
 */
export function sha256Sync(data: string): HexString {
  const wasm = getWasmModule();
  if (!wasm.sha256_wasm) {
    throw new CryptoError('Synchronous SHA-256 requires WASM module with sha256_wasm export');
  }
  return wasm.sha256_wasm(data);
}

// ─── Policy Hash ─────────────────────────────────────────────────────────────

/**
 * Recursively sort object keys for deterministic serialization.
 */
function deepSortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(deepSortKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = deepSortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Compute the hash of a policy object for inclusion in identity certificates.
 * Deterministic: recursively sorts all keys before hashing.
 */
export async function hashPolicy(policy: Record<string, unknown>): Promise<HexString> {
  const normalized = JSON.stringify(deepSortKeys(policy));
  return sha256(normalized);
}

// ─── Commitment Hash (EIP-712) ───────────────────────────────────────────────

/**
 * Compute EIP-712 type hash for commitment struct.
 * This is a simplified version — full EIP-712 encoding requires:
 *   typeHash = keccak256("Commitment(address buyerAgent,address sellerAgent,...)")
 *   structHash = keccak256(abi.encode(typeHash, value...))
 *   digest = keccak256("\x19\x01" + domainSeparator + structHash)
 *
 * For the AESP protocol, we use SHA-256 as a portable hash and rely on
 * EVM-side EIP-712 verification when interacting with smart contracts.
 */
export async function hashCommitment(
  domain: Record<string, unknown>,
  value: Record<string, unknown>,
): Promise<HexString> {
  const payload = JSON.stringify(deepSortKeys({ domain, value }));
  return sha256(payload);
}

// ─── UUID Generation ─────────────────────────────────────────────────────────

/**
 * Generate a UUID v4.
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
