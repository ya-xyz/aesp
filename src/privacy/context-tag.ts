/**
 * AESP — Context Tag Manager
 *
 * Creates, encrypts, and stores context tag audit records.
 * Context tags link ephemeral addresses back to their transactions,
 * enabling the owner to reconstruct full transaction history.
 *
 * Storage pipeline:
 *   ContextTagRecord → ECIES encrypt → Arweave upload → cNFT mint
 *
 * Supports configurable audit batching strategies to amortize Arweave
 * upload costs for high-frequency, low-value agent transactions.
 */

import type { StorageAdapter, ChainId, TokenId } from '../types/index.js';
import type {
  ContextTagRecord,
  PrivacyLevel,
  AuditStorage,
  AuditBatchingConfig,
} from '../types/privacy.js';
import { generateUUID } from '../crypto/hashing.js';
import { encryptForXidentity } from '../crypto/encryption.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAGS_STORAGE_KEY = 'aesp:context_tags';
const MAX_LOCAL_TAGS = 10000;
const DEFAULT_BATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_BATCH_COUNT_THRESHOLD = 50;

// ─── Arweave Upload Interface ───────────────────────────────────────────────

/** Interface for Arweave upload (to be implemented by the consumer). */
export interface ArweaveUploader {
  upload(data: Uint8Array, contentType: string): Promise<string>; // returns txId
}

/** Interface for cNFT minting (to be implemented by the consumer). */
export interface AuditNFTMinter {
  mint(arweaveTxId: string, metadata: Record<string, string>): Promise<string>; // returns mintTxId
}

// ─── Context Tag Manager ────────────────────────────────────────────────────

export class ContextTagManager {
  private tags: Map<string, ContextTagRecord> = new Map();
  private arweaveUploader?: ArweaveUploader;
  private nftMinter?: AuditNFTMinter;

  // ─── Batch Archiving State ──────────────────────────────────────────
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchingConfig: AuditBatchingConfig | null = null;
  private batchOwnerXidentity: string | null = null;

  constructor(private readonly storage: StorageAdapter) {}

  /**
   * Set the Arweave uploader implementation.
   */
  setArweaveUploader(uploader: ArweaveUploader): void {
    this.arweaveUploader = uploader;
  }

  /**
   * Set the cNFT minter implementation.
   */
  setNFTMinter(minter: AuditNFTMinter): void {
    this.nftMinter = minter;
  }

  /**
   * Create a context tag record for a transaction.
   */
  createTag(params: {
    agentId: string;
    contextInfo: string;
    derivedAddress: string;
    chain: ChainId;
    direction: 'inbound' | 'outbound';
    amount: string;
    token: TokenId;
    counterpartyAddress: string;
    txHash?: string;
    commitmentId?: string;
    negotiationSessionId?: string;
    privacyLevel: PrivacyLevel;
  }): ContextTagRecord {
    const tag: ContextTagRecord = {
      id: generateUUID(),
      agentId: params.agentId,
      contextInfo: params.contextInfo,
      derivedAddress: params.derivedAddress,
      chain: params.chain,
      direction: params.direction,
      amount: params.amount,
      token: params.token,
      counterpartyAddress: params.counterpartyAddress,
      txHash: params.txHash,
      commitmentId: params.commitmentId,
      negotiationSessionId: params.negotiationSessionId,
      timestamp: Date.now(),
      privacyLevel: params.privacyLevel,
    };

    this.tags.set(tag.id, tag);

    // Trim local tags if exceeding limit
    if (this.tags.size > MAX_LOCAL_TAGS) {
      const entries = Array.from(this.tags.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, entries.length - MAX_LOCAL_TAGS);
      for (const [key] of toRemove) {
        this.tags.delete(key);
      }
    }

    this.scheduleSave();

    // Check count_threshold trigger
    if (this.batchingConfig?.strategy === 'count_threshold') {
      const threshold = this.batchingConfig.countThreshold ?? DEFAULT_BATCH_COUNT_THRESHOLD;
      const unarchived = this.getUnarchivedConfirmedCount();
      if (unarchived >= threshold && this.batchOwnerXidentity) {
        // Trigger immediate batch archive
        this.batchArchive(this.batchOwnerXidentity, 'arweave').catch(() => { /* silent */ });
      }
    }

    return tag;
  }

  /**
   * Update a tag with transaction hash (after on-chain confirmation).
   */
  updateTagTxHash(tagId: string, txHash: string): void {
    const tag = this.tags.get(tagId);
    if (tag) {
      tag.txHash = txHash;
      this.scheduleSave();

      // Check count_threshold trigger after tx confirmation
      if (this.batchingConfig?.strategy === 'count_threshold') {
        const threshold = this.batchingConfig.countThreshold ?? DEFAULT_BATCH_COUNT_THRESHOLD;
        const unarchived = this.getUnarchivedConfirmedCount();
        if (unarchived >= threshold && this.batchOwnerXidentity) {
          this.batchArchive(this.batchOwnerXidentity, 'arweave').catch(() => { /* silent */ });
        }
      }
    }
  }

  /**
   * Update a tag with consolidation transaction hash.
   */
  updateTagConsolidation(tagId: string, consolidationTxHash: string): void {
    const tag = this.tags.get(tagId);
    if (tag) {
      tag.vaultConsolidationTxHash = consolidationTxHash;
      this.scheduleSave();
    }
  }

  /**
   * Encrypt and upload a tag to Arweave.
   * @param ownerXidentityB64 - Owner's xidentity public key for encryption
   */
  async uploadToArweave(
    tagId: string,
    ownerXidentityB64: string,
  ): Promise<string | null> {
    if (!this.arweaveUploader) return null;

    const tag = this.tags.get(tagId);
    if (!tag) return null;

    const plaintext = JSON.stringify(tag);
    const encrypted = encryptForXidentity(ownerXidentityB64, plaintext);
    const data = new TextEncoder().encode(encrypted);

    const arweaveTxId = await this.arweaveUploader.upload(data, 'application/octet-stream');
    return arweaveTxId;
  }

  /**
   * Mint an audit cNFT for a tag that has been uploaded to Arweave.
   */
  async mintAuditNFT(
    arweaveTxId: string,
    agentId: string,
    chain: ChainId,
  ): Promise<string | null> {
    if (!this.nftMinter) return null;

    return this.nftMinter.mint(arweaveTxId, {
      type: 'aesp:context_tag',
      agentId,
      chain,
      arweaveTxId,
    });
  }

  /**
   * Upload and mint for a tag in a single call.
   */
  async archiveTag(
    tagId: string,
    ownerXidentityB64: string,
  ): Promise<{ arweaveTxId: string | null; mintTxId: string | null }> {
    const tag = this.tags.get(tagId);
    if (!tag) return { arweaveTxId: null, mintTxId: null };

    const arweaveTxId = await this.uploadToArweave(tagId, ownerXidentityB64);
    let mintTxId: string | null = null;

    if (arweaveTxId) {
      mintTxId = await this.mintAuditNFT(arweaveTxId, tag.agentId, tag.chain);
      // Mark the tag as archived to prevent duplicate archiving
      tag.archivedAt = Date.now();
      tag.arweaveTxId = arweaveTxId;
      this.scheduleSave();
    }

    return { arweaveTxId, mintTxId };
  }

  /**
   * Batch archive all unarchived tags with confirmed transactions.
   */
  async batchArchive(
    ownerXidentityB64: string,
    auditStorage: AuditStorage,
  ): Promise<number> {
    if (auditStorage !== 'arweave' || !this.arweaveUploader) return 0;

    let archived = 0;
    for (const tag of this.tags.values()) {
      if (!tag.txHash || tag.archivedAt) continue;
      const result = await this.archiveTag(tag.id, ownerXidentityB64);
      if (result.arweaveTxId) archived++;
    }
    return archived;
  }

  // ─── Scheduled Batch Archiving ──────────────────────────────────────

  /**
   * Start scheduled batch archiving with the given batching configuration.
   *
   * For `time_window` strategy: sets up a recurring timer that triggers
   * `batchArchive` every `windowMs` milliseconds.
   *
   * For `count_threshold` strategy: batch archive is triggered automatically
   * when the number of unarchived confirmed tags reaches `countThreshold`.
   *
   * For `immediate` strategy: no scheduling needed (tags are archived on creation).
   *
   * @param ownerXidentityB64 Owner's xidentity for encryption.
   * @param config Batching configuration.
   */
  startBatchArchiving(
    ownerXidentityB64: string,
    config: AuditBatchingConfig,
  ): void {
    this.stopBatchArchiving();
    this.batchingConfig = config;
    this.batchOwnerXidentity = ownerXidentityB64;

    if (config.strategy === 'time_window') {
      const windowMs = config.windowMs ?? DEFAULT_BATCH_WINDOW_MS;
      this.scheduleBatchTimer(windowMs);
    }
    // count_threshold is handled reactively in createTag / updateTagTxHash
    // immediate does not need scheduling
  }

  /**
   * Stop scheduled batch archiving and cancel any pending batch timer.
   */
  stopBatchArchiving(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.batchingConfig = null;
    this.batchOwnerXidentity = null;
  }

  /**
   * Get the number of unarchived tags with confirmed transactions.
   */
  getUnarchivedConfirmedCount(): number {
    let count = 0;
    for (const tag of this.tags.values()) {
      if (tag.txHash && !tag.archivedAt) count++;
    }
    return count;
  }

  /**
   * Check whether a tag should be archived immediately or batched.
   *
   * Returns `true` if the tag should wait for a batch (i.e., do NOT archive now).
   * Returns `false` if the tag should be archived immediately.
   */
  shouldDeferArchiving(tag: ContextTagRecord): boolean {
    if (!this.batchingConfig) return false; // no batching config → archive immediately

    const { strategy, lowValueThreshold } = this.batchingConfig;

    // Immediate strategy never defers
    if (strategy === 'immediate') return false;

    // Low-value transactions are always deferred to batch
    if (lowValueThreshold) {
      const threshold = Number(lowValueThreshold);
      const amount = Number(tag.amount);
      if (Number.isFinite(threshold) && Number.isFinite(amount) && amount < threshold) {
        return true;
      }
    }

    // time_window and count_threshold strategies defer by default
    return strategy === 'time_window' || strategy === 'count_threshold';
  }

  // ─── Query ─────────────────────────────────────────────────────────────

  getTag(tagId: string): ContextTagRecord | undefined {
    return this.tags.get(tagId);
  }

  getTagsByAgent(agentId: string): ContextTagRecord[] {
    return Array.from(this.tags.values()).filter((t) => t.agentId === agentId);
  }

  getTagsByAddress(address: string): ContextTagRecord[] {
    return Array.from(this.tags.values()).filter(
      (t) => t.derivedAddress === address || t.counterpartyAddress === address,
    );
  }

  getTagsByChain(chain: ChainId): ContextTagRecord[] {
    return Array.from(this.tags.values()).filter((t) => t.chain === chain);
  }

  getAllTags(): ContextTagRecord[] {
    return Array.from(this.tags.values());
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  async load(): Promise<void> {
    const stored = await this.storage.get<ContextTagRecord[]>(TAGS_STORAGE_KEY);
    if (stored) {
      this.tags.clear();
      for (const tag of stored) {
        this.tags.set(tag.id, tag);
      }
    }
  }

  async save(): Promise<void> {
    await this.storage.set(
      TAGS_STORAGE_KEY,
      Array.from(this.tags.values()),
    );
  }

  /**
   * Cancel any pending save timer and batch timer (for cleanup / shutdown).
   */
  dispose(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch(() => { /* silent */ });
    }, 100);
  }

  private scheduleBatchTimer(windowMs: number): void {
    this.batchTimer = setTimeout(async () => {
      if (this.batchOwnerXidentity) {
        try {
          await this.batchArchive(this.batchOwnerXidentity, 'arweave');
        } catch {
          // Keep timer alive even if one run fails
        }
      }
      // Re-schedule if still active
      if (this.batchingConfig?.strategy === 'time_window') {
        this.scheduleBatchTimer(windowMs);
      }
    }, windowMs);
  }
}
