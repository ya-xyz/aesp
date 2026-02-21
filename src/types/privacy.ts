/**
 * AESP — Privacy Types
 *
 * Types for the context-isolated ephemeral address system.
 */

import type { UUID, ISOTimestamp, ChainId, TokenId } from './common.js';

// ─── Privacy Levels ─────────────────────────────────────────────────────────

/** Privacy level for agent transactions */
export type PrivacyLevel = 'transparent' | 'basic' | 'isolated';

/** Storage backend for audit context tags */
export type AuditStorage = 'memory' | 'local' | 'arweave';

// ─── Privacy Policy ─────────────────────────────────────────────────────────

/**
 * Audit batching strategy for context tag archiving.
 *
 * Controls how context tags are aggregated before uploading to Arweave,
 * enabling cost amortization for high-frequency, low-value transactions.
 *
 * - `immediate`: Archive each tag individually as soon as tx is confirmed.
 * - `time_window`: Accumulate tags and archive in bulk after a time window.
 * - `count_threshold`: Archive once the number of unarchived tags reaches a count.
 */
export type AuditBatchingStrategy = 'immediate' | 'time_window' | 'count_threshold';

/**
 * Configuration for audit batching when strategy is not 'immediate'.
 */
export interface AuditBatchingConfig {
  /** Batching strategy. Default: 'immediate'. */
  strategy: AuditBatchingStrategy;

  /**
   * Time window in milliseconds for 'time_window' strategy.
   * Tags are accumulated for this duration before a batch archive.
   * Default: 300_000 (5 minutes).
   */
  windowMs?: number;

  /**
   * Tag count threshold for 'count_threshold' strategy.
   * A batch archive is triggered when unarchived tag count reaches this value.
   * Default: 50.
   */
  countThreshold?: number;

  /**
   * Minimum transaction amount (as string, e.g. "1.00") below which tags are
   * automatically batched regardless of strategy. Tags for transactions below
   * this amount are never archived individually — they wait for the next batch.
   * Default: "0" (all tags follow the main strategy).
   */
  lowValueThreshold?: string;
}

export interface PrivacyPolicy {
  /** Privacy level: transparent (direct), basic (per-agent), isolated (per-tx) */
  level: PrivacyLevel;
  /** Where to store context tag audit records */
  auditStorage: AuditStorage;
  /** Whether to batch-consolidate ephemeral address funds back to vault */
  batchConsolidation: boolean;
  /** Number of pending ephemeral address balances before triggering consolidation */
  consolidationThreshold: number;
  /** Number of ephemeral addresses to pre-derive for the pool */
  preDerivationPoolSize: number;
  /** Audit batching configuration for cost optimization. Default: immediate. */
  auditBatching?: AuditBatchingConfig;
}

// ─── Context Tag Record ─────────────────────────────────────────────────────

export interface ContextTagRecord {
  id: UUID;
  agentId: string;
  contextInfo: string;
  derivedAddress: string;
  chain: ChainId;
  direction: 'inbound' | 'outbound';
  amount: string;
  token: TokenId;
  counterpartyAddress: string;
  txHash?: string;
  vaultConsolidationTxHash?: string;
  commitmentId?: string;
  negotiationSessionId?: string;
  timestamp: number;
  privacyLevel: PrivacyLevel;
  /** Set after the tag has been archived to Arweave (prevents duplicate archiving) */
  archivedAt?: number;
  /** Arweave transaction ID from the archive upload */
  arweaveTxId?: string;
}

// ─── Ephemeral Address ──────────────────────────────────────────────────────

export type EphemeralAddressStatus = 'available' | 'assigned' | 'funded' | 'spent' | 'consolidated';

export interface EphemeralAddress {
  address: string;
  chain: ChainId;
  contextInfo: string;
  agentId: string;
  direction: 'inbound' | 'outbound';
  status: EphemeralAddressStatus;
  assignedTxUUID?: UUID;
  createdAt: ISOTimestamp;
  usedAt?: ISOTimestamp;
}

// ─── Address Pool ───────────────────────────────────────────────────────────

export interface AddressPoolState {
  agentId: string;
  chain: ChainId;
  outbound: EphemeralAddress[];
  inbound: EphemeralAddress[];
  sequenceCounter: number;
}

// ─── Consolidation ──────────────────────────────────────────────────────────

export type ConsolidationStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ConsolidationRecord {
  id: UUID;
  agentId: string;
  chain: ChainId;
  addresses: string[];
  totalAmount: string;
  token: TokenId;
  txHash?: string;
  status: ConsolidationStatus;
  createdAt: ISOTimestamp;
  completedAt?: ISOTimestamp;
}

// ─── WASM Context Functions ─────────────────────────────────────────────────

/** Interface for context-aware WASM functions */
export interface ContextWasmFunctions {
  view_wallet_unified_with_context_wasm?(
    mnemonic: string,
    passphrase: string,
    context: string,
  ): string;

  evm_get_address_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
  ): string;

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

  evm_sign_personal_message_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
    message: string,
  ): string;

  evm_sign_typed_data_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
    typed_data_hash: string,
  ): string;

  // Solana context-isolated operations
  solana_get_address_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
  ): string;

  solana_sign_transaction_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
    transaction_b64: string,
  ): string;

  solana_sign_message_with_context?(
    mnemonic: string,
    passphrase: string,
    context: string,
    message: string,
  ): string;
}
