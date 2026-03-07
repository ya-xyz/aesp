/**
 * AESP — ZK-ACE Types
 *
 * Type definitions for the ZK-ACE (Zero-Knowledge Authorization for
 * Cryptographic Entities) integration layer.
 *
 * ZK-ACE allows agents to prove authorization without revealing their
 * identity root (REV). The proof stays in WASM; the REV never leaves.
 */

// ─── Replay Mode ────────────────────────────────────────────────────────────

/**
 * Replay prevention mode for ZK-ACE proofs.
 *
 * - `nonce`: NonceRegistry model (account-style). Each proof includes a
 *   nonce commitment; the verifier checks that the nonce hasn't been used
 *   before for this identity.
 * - `nullifier`: NullifierSet model (privacy-style). The replay commitment
 *   is derived from the authorization token, preventing proof reuse
 *   without revealing identity linkage across transactions.
 */
export type ZkReplayMode = 'nonce' | 'nullifier';

// ─── Derivation Context ──────────────────────────────────────────────────────

/**
 * ZK-ACE derivation context.
 *
 * Determines which cryptographic target the proof binds to.
 * Maps to the paper's Ctx = (AlgID, Domain, Index).
 */
export interface ZkDerivationContext {
  /** Target algorithm ID: "0"=Ed25519, "1"=Secp256k1, "2"=ML-DSA, etc. */
  algId: string;
  /** Chain/application domain tag (e.g., "1" for Ethereum mainnet). */
  domain: string;
  /** Derivation index (e.g., "0" for the first key). */
  index: string;
}

// ─── Prove Request ───────────────────────────────────────────────────────────

/**
 * Parameters for generating a ZK-ACE authorization proof.
 *
 * The mnemonic (REV) never leaves the WASM sandbox.
 * All field element values are passed as decimal or "0x"-prefixed hex strings.
 */
export interface ZkProveRequest {
  /** 24-word BIP39 mnemonic (256-bit entropy = REV). */
  mnemonic: string;
  /** Wallet passphrase (reserved for future authentication). */
  passphrase: string;
  /** Identity commitment salt (field element as string). */
  salt: string;
  /** Derivation context for target binding. */
  ctx: ZkDerivationContext;
  /** Replay-prevention nonce (field element as string). */
  nonce: string;
  /** Transaction hash to authorize (field element as string). */
  txHash: string;
  /** Replay prevention mode. */
  replayMode: ZkReplayMode;
}

// ─── Prove Result ────────────────────────────────────────────────────────────

/**
 * Result of a ZK-ACE proof generation.
 *
 * Contains the Groth16 proof and public inputs needed for on-chain
 * or off-chain verification.
 */
export interface ZkProveResult {
  /** Hex-encoded compressed Groth16 proof bytes. */
  proof: string;
  /**
   * Public inputs as hex-encoded field elements.
   * Order: [id_com, tx_hash, domain, target, rp_com]
   */
  publicInputs: string[];
}

// ─── Setup Result ────────────────────────────────────────────────────────────

/**
 * Result of a ZK-ACE trusted setup.
 *
 * Both keys are hex-encoded compressed byte representations.
 * In production, these come from a multi-party ceremony (MPC).
 */
export interface ZkSetupResult {
  /** Hex-encoded proving key bytes. */
  pkHex: string;
  /** Hex-encoded verifying key bytes. */
  vkHex: string;
}

// ─── Key Store ───────────────────────────────────────────────────────────────

/**
 * Pre-loaded ZK-ACE key material for proof generation and verification.
 *
 * The proving key (~1-2 MB) is loaded once and reused for all proofs.
 * Separate key pairs are needed for each replay mode.
 */
export interface ZkKeyStore {
  /** Proving key binary (Uint8Array), one per replay mode. */
  provingKeys: Record<ZkReplayMode, Uint8Array | null>;
  /** Verifying key binary (Uint8Array), one per replay mode. */
  verifyingKeys: Record<ZkReplayMode, Uint8Array | null>;
}
