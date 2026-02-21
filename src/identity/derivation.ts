/**
 * AESP — Agent Identity Derivation
 *
 * Derives deterministic agent keypairs from the master mnemonic using BIP44 sub-paths.
 * Each agent gets a unique Ed25519 keypair derived at:
 *   m/44'/501'/0'/0'/{agentIndex}'
 *
 * The agentId is SHA-256(agent_pubkey).
 */

import type {
  HexString,
  AgentDID,
  AgentCapability,
  ChainId,
} from '../types/index.js';
import type {
  AgentDerivationParams,
  DerivedAgentIdentity,
  AgentIdentityCertificate,
} from '../types/identity.js';
import { CryptoError } from '../types/index.js';
import { getWasmModule } from '../crypto/wasm-bridge.js';
import { signWithXidentity, verifyXidentitySignature } from '../crypto/signing.js';
import { sha256, hashPolicy } from '../crypto/hashing.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENT_DERIVATION_BASE = "m/44'/501'/0'/0'";
const MAX_AGENT_INDEX = 2147483647; // 2^31 - 1

// ─── Derivation ──────────────────────────────────────────────────────────────

/**
 * Derive an agent identity from the master mnemonic.
 *
 * @param params - Mnemonic, passphrase, and agent index
 * @returns Derived agent identity with ID, DID, public key, and path
 */
export async function deriveAgentIdentity(
  params: AgentDerivationParams,
): Promise<DerivedAgentIdentity> {
  const { mnemonic, passphrase, agentIndex } = params;

  if (agentIndex < 0 || agentIndex > MAX_AGENT_INDEX) {
    throw new CryptoError(
      `Agent index must be between 0 and ${MAX_AGENT_INDEX}`,
      { code: 'INVALID_AGENT_INDEX' },
    );
  }

  const path = `${AGENT_DERIVATION_BASE}/${agentIndex}'`;
  const wasm = getWasmModule();

  let publicKey: HexString;

  if (wasm.derive_child_key_wasm) {
    // Use dedicated derivation function
    try {
      const result = wasm.derive_child_key_wasm(mnemonic, passphrase, path);
      const parsed = JSON.parse(result);
      publicKey = parsed.public_key ?? parsed.publicKey;
    } catch (error) {
      throw new CryptoError(
        `Agent key derivation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    // Fallback: derive a unique public key by hashing a deterministic signature.
    // acegf_sign_message_wasm always returns the master public_key, so we cannot
    // use it directly. Instead, we use SHA-256 of the unique signature as a
    // synthetic agent public key — each agentIndex produces a different signature
    // and therefore a different public key.
    try {
      const sigResult = wasm.acegf_sign_message_wasm(
        mnemonic,
        passphrase,
        `aesp:agent:derive:${agentIndex}`,
        'ed25519',
      );
      const parsed = JSON.parse(sigResult);
      // Use sha256 of the signature (unique per agentIndex) as the synthetic public key
      publicKey = await sha256(parsed.signature);
    } catch (error) {
      throw new CryptoError(
        `Agent key derivation (fallback) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const agentId = await sha256(publicKey);

  return {
    agentId,
    did: `did:yallet:${agentId}` as AgentDID,
    publicKey,
    derivationPath: path,
  };
}

// ─── Certificate Creation ────────────────────────────────────────────────────

/**
 * Create a signed Agent Identity Certificate.
 *
 * The certificate is signed by the human owner's xidentity key,
 * establishing a provable link between the agent and its owner.
 */
export async function createAgentCertificate(params: {
  mnemonic: string;
  passphrase: string;
  agentIndex: number;
  ownerXidentity: string;
  capabilities: AgentCapability[];
  chains: ChainId[];
  maxAutonomousAmount: number;
  policy: Record<string, unknown>;
  validDays?: number;
}): Promise<AgentIdentityCertificate> {
  const {
    mnemonic,
    passphrase,
    agentIndex,
    ownerXidentity,
    capabilities,
    chains,
    maxAutonomousAmount,
    policy,
    validDays = 365,
  } = params;

  // Derive agent identity
  const identity = await deriveAgentIdentity({ mnemonic, passphrase, agentIndex });

  // Hash the policy for inclusion in certificate
  const policyHash = await hashPolicy(policy);

  const now = new Date();
  const expires = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);

  // Build the certificate (unsigned)
  const cert: AgentIdentityCertificate = {
    version: '1.0',
    agentId: identity.agentId,
    pubkey: identity.publicKey,
    ownerXidentity,
    capabilities,
    policyHash,
    maxAutonomousAmount,
    chains,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    ownerSignature: '',
  };

  const certPayload = stringifyCertificateForSigning(cert);
  cert.ownerSignature = signWithXidentity(mnemonic, passphrase, certPayload);

  return cert;
}

// ─── Certificate Verification ────────────────────────────────────────────────

/**
 * Verify an Agent Identity Certificate's owner signature.
 *
 * @param cert - The certificate to verify
 * @param trustedOwnerXidentity - If provided, the certificate's `ownerXidentity`
 *   must match this value before verification proceeds.  This acts as an external
 *   trust anchor: without it, the certificate is self-verifying (the embedded
 *   public key is used to verify its own signature, which any attacker can forge).
 *   **Always provide `trustedOwnerXidentity` in production** to bind verification
 *   to a known owner identity.
 */
export function verifyCertificate(
  cert: AgentIdentityCertificate,
  trustedOwnerXidentity?: string,
): boolean {
  // If an external trust anchor is provided, ensure the certificate's
  // ownerXidentity matches before proceeding with signature verification.
  if (trustedOwnerXidentity && cert.ownerXidentity !== trustedOwnerXidentity) {
    return false;
  }

  const certPayload = stringifyCertificateForSigning(cert);
  return verifyXidentitySignature(cert.ownerXidentity, certPayload, cert.ownerSignature);
}

/** Deterministic serialization for signing/verification (fixed key order). */
function stringifyCertificateForSigning(cert: AgentIdentityCertificate): string {
  const payload: Record<string, unknown> = {
    agentId: cert.agentId,
    capabilities: cert.capabilities,
    chains: cert.chains,
    createdAt: cert.createdAt,
    expiresAt: cert.expiresAt,
    maxAutonomousAmount: cert.maxAutonomousAmount,
    ownerXidentity: cert.ownerXidentity,
    policyHash: cert.policyHash,
    pubkey: cert.pubkey,
    version: cert.version,
  };
  return JSON.stringify(payload);
}

/**
 * Check if a certificate is expired.
 */
export function isCertificateExpired(cert: AgentIdentityCertificate): boolean {
  return new Date(cert.expiresAt) < new Date();
}

/**
 * Check if a certificate has a specific capability.
 */
export function hasCertificateCapability(
  cert: AgentIdentityCertificate,
  capability: AgentCapability,
): boolean {
  return cert.capabilities.includes(capability);
}
