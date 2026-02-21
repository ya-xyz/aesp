/**
 * AESP — Fund Consolidation Scheduler
 *
 * Manages batch sweeping of funds from ephemeral addresses back to the vault.
 * Supports both periodic (interval-based) and threshold-based consolidation.
 *
 * Privacy-hardened: uses randomized jitter and batched sweeps to prevent
 * chain-analysis tools from fingerprinting consolidation patterns.
 */

import type { StorageAdapter, ChainId, TokenId } from '../types/index.js';
import type {
  ConsolidationRecord,
  PrivacyPolicy,
} from '../types/privacy.js';
import { generateUUID } from '../crypto/hashing.js';
import { AddressPoolManager } from './address-pool.js';
import { ContextTagManager } from './context-tag.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const CONSOLIDATION_STORAGE_KEY = 'aesp:consolidation';
const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours base interval

/**
 * Default jitter ratio applied to the base interval.
 * A jitter of 0.3 means ±30%, so a 4-hour base becomes 2h48m – 5h12m.
 */
const DEFAULT_JITTER_RATIO = 0.3;

/**
 * Default maximum number of addresses consolidated per batch.
 * When more addresses are eligible, they are split into multiple batches
 * with random inter-batch delays to break temporal fingerprints.
 */
const DEFAULT_MAX_BATCH_SIZE = 5;

/**
 * Range (ms) for random delay between consecutive batches within a single
 * consolidation run. [min, max].
 */
const DEFAULT_INTER_BATCH_DELAY_RANGE: [number, number] = [
  10 * 60 * 1000,   // 10 minutes
  60 * 60 * 1000,    // 60 minutes
];

const MAX_CONSOLIDATION_RECORDS = 1000;

// ─── Consolidation Handler Interface ────────────────────────────────────────

/**
 * Interface for executing the actual on-chain consolidation transaction.
 * Implemented by the consumer (e.g., Yault backend).
 */
export interface ConsolidationHandler {
  /**
   * Execute a batch transfer from multiple ephemeral addresses to the vault.
   * @returns Transaction hash
   */
  consolidate(params: {
    fromAddresses: string[];
    toVaultAddress: string;
    chain: ChainId;
    token: TokenId;
  }): Promise<string>;
}

// ─── Consolidation Options ──────────────────────────────────────────────────

/**
 * Privacy-hardening options for consolidation scheduling.
 */
export interface ConsolidationPrivacyOptions {
  /**
   * Jitter ratio applied to the scheduling interval (0–1).
   * E.g. 0.3 adds ±30% randomness to each tick.
   * Default: 0.3
   */
  jitterRatio?: number;

  /**
   * Maximum addresses consolidated in a single on-chain batch.
   * Larger sets are split into multiple batches with inter-batch delays.
   * Default: 5
   */
  maxBatchSize?: number;

  /**
   * [min, max] milliseconds of random delay between consecutive batches.
   * Default: [600_000, 3_600_000] (10m – 60m)
   */
  interBatchDelayRange?: [number, number];
}

// ─── Consolidation Scheduler ────────────────────────────────────────────────

export class ConsolidationScheduler {
  private records: Map<string, ConsolidationRecord> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private handler?: ConsolidationHandler;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly addressPool: AddressPoolManager,
    private readonly tagManager: ContextTagManager,
  ) {}

  /**
   * Set the consolidation handler (executes on-chain transactions).
   */
  setHandler(handler: ConsolidationHandler): void {
    this.handler = handler;
  }

  // ─── Jitter Utilities ─────────────────────────────────────────────────

  /**
   * Apply random jitter to a base interval.
   * Returns value in range [base * (1 - ratio), base * (1 + ratio)].
   *
   * @internal Exposed as static for testability.
   */
  static applyJitter(baseMs: number, jitterRatio: number): number {
    const ratio = Math.max(0, Math.min(1, jitterRatio));
    const min = baseMs * (1 - ratio);
    const max = baseMs * (1 + ratio);
    return Math.floor(min + Math.random() * (max - min));
  }

  /**
   * Random integer in [min, max] range.
   * @internal
   */
  static randomInRange(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min));
  }

  // ─── Scheduling ───────────────────────────────────────────────────────

  /**
   * Schedule periodic consolidation for an agent with privacy-hardening.
   *
   * Unlike a fixed `setInterval`, each tick uses a randomized delay
   * (`setTimeout` chain with jitter) so the consolidation cadence is
   * unpredictable on-chain.
   */
  scheduleConsolidation(params: {
    agentId: string;
    chain: ChainId;
    vaultAddress: string;
    token?: TokenId;
    intervalMs?: number;
    policy?: PrivacyPolicy;
    privacyOptions?: ConsolidationPrivacyOptions;
  }): void {
    const key = `${params.agentId}:${params.chain}`;
    const baseInterval = params.intervalMs ?? DEFAULT_INTERVAL_MS;
    const jitterRatio = params.privacyOptions?.jitterRatio ?? DEFAULT_JITTER_RATIO;
    const maxBatchSize = params.privacyOptions?.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    const interBatchRange = params.privacyOptions?.interBatchDelayRange ?? DEFAULT_INTER_BATCH_DELAY_RANGE;

    // Clear existing timer
    this.cancelConsolidation(params.agentId, params.chain);

    const scheduleNext = () => {
      const jitteredDelay = ConsolidationScheduler.applyJitter(baseInterval, jitterRatio);
      const timer = setTimeout(async () => {
        try {
          await this.consolidateBatched({
            agentId: params.agentId,
            chain: params.chain,
            vaultAddress: params.vaultAddress,
            token: params.token ?? 'native',
            maxBatchSize,
            interBatchRange,
          });
        } catch (error) {
          // Keep scheduler alive even if one run fails.
          console.error('ConsolidationScheduler.scheduleConsolidation:', error);
        }
        // Schedule the next tick (recursive setTimeout for jitter)
        if (this.timers.has(key)) {
          scheduleNext();
        }
      }, jitteredDelay);

      this.timers.set(key, timer);
    };

    scheduleNext();
  }

  /**
   * Cancel scheduled consolidation.
   */
  cancelConsolidation(agentId: string, chain: ChainId): void {
    const key = `${agentId}:${chain}`;
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  // ─── Batched Consolidation ────────────────────────────────────────────

  /**
   * Consolidate funded addresses in randomized batches.
   *
   * Splits eligible addresses into batches of `maxBatchSize` and inserts
   * random delays between batches to defeat temporal fingerprinting.
   * Each batch results in a separate `ConsolidationRecord`.
   *
   * @returns Array of consolidation records (one per batch).
   */
  async consolidateBatched(params: {
    agentId: string;
    chain: ChainId;
    vaultAddress: string;
    token: TokenId;
    maxBatchSize?: number;
    interBatchRange?: [number, number];
  }): Promise<ConsolidationRecord[]> {
    const maxBatchSize = params.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    const interBatchRange = params.interBatchRange ?? DEFAULT_INTER_BATCH_DELAY_RANGE;

    const allAddresses = this.addressPool.getAddressesForConsolidation(
      params.agentId,
      params.chain,
    );

    if (allAddresses.length === 0) return [];

    // Shuffle addresses to avoid deterministic ordering
    const shuffled = [...allAddresses];
    ConsolidationScheduler.shuffleArray(shuffled);

    // Split into batches
    const batches: typeof allAddresses[] = [];
    for (let i = 0; i < shuffled.length; i += maxBatchSize) {
      batches.push(shuffled.slice(i, i + maxBatchSize));
    }

    const results: ConsolidationRecord[] = [];
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      // Inter-batch delay (skip before first batch)
      if (batchIdx > 0) {
        const delay = ConsolidationScheduler.randomInRange(
          interBatchRange[0],
          interBatchRange[1],
        );
        await ConsolidationScheduler.sleep(delay);
      }

      const record = await this.consolidateSingleBatch({
        agentId: params.agentId,
        chain: params.chain,
        vaultAddress: params.vaultAddress,
        token: params.token,
        addresses: batches[batchIdx],
      });

      if (record) {
        results.push(record);
      }
    }

    return results;
  }

  /**
   * Immediately consolidate all funded ephemeral addresses for an agent
   * in a single batch (no splitting, no delays).
   *
   * Use `consolidateBatched` for privacy-hardened consolidation.
   */
  async consolidateNow(params: {
    agentId: string;
    chain: ChainId;
    vaultAddress: string;
    token: TokenId;
  }): Promise<ConsolidationRecord | null> {
    const addresses = this.addressPool.getAddressesForConsolidation(
      params.agentId,
      params.chain,
    );

    if (addresses.length === 0) return null;

    return this.consolidateSingleBatch({
      agentId: params.agentId,
      chain: params.chain,
      vaultAddress: params.vaultAddress,
      token: params.token,
      addresses,
    });
  }

  /**
   * Check if consolidation should be triggered based on threshold.
   */
  shouldConsolidate(
    agentId: string,
    chain: ChainId,
    policy: PrivacyPolicy,
  ): boolean {
    const addresses = this.addressPool.getAddressesForConsolidation(agentId, chain);
    return addresses.length >= policy.consolidationThreshold;
  }

  // ─── Query ─────────────────────────────────────────────────────────────

  getConsolidationHistory(agentId: string): ConsolidationRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.agentId === agentId,
    );
  }

  getRecord(id: string): ConsolidationRecord | undefined {
    return this.records.get(id);
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  async load(): Promise<void> {
    const stored = await this.storage.get<ConsolidationRecord[]>(CONSOLIDATION_STORAGE_KEY);
    if (stored) {
      this.records.clear();
      for (const r of stored) {
        this.records.set(r.id, r);
      }
    }
  }

  async save(): Promise<void> {
    await this.storage.set(
      CONSOLIDATION_STORAGE_KEY,
      Array.from(this.records.values()),
    );
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  /**
   * Stop all scheduled consolidations (for shutdown).
   */
  dispose(): void {
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  /**
   * Consolidate a single batch of addresses.
   * @internal
   */
  private async consolidateSingleBatch(params: {
    agentId: string;
    chain: ChainId;
    vaultAddress: string;
    token: TokenId;
    addresses: import('../types/privacy.js').EphemeralAddress[];
  }): Promise<ConsolidationRecord | null> {
    const { addresses } = params;
    if (addresses.length === 0) return null;

    const record: ConsolidationRecord = {
      id: generateUUID(),
      agentId: params.agentId,
      chain: params.chain,
      addresses: addresses.map((a) => a.address),
      totalAmount: '0',
      token: params.token,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.records.set(record.id, record);

    if (this.handler) {
      try {
        record.status = 'in_progress';
        const txHash = await this.handler.consolidate({
          fromAddresses: record.addresses,
          toVaultAddress: params.vaultAddress,
          chain: params.chain,
          token: params.token,
        });

        record.txHash = txHash;
        record.status = 'completed';
        record.completedAt = new Date().toISOString();

        // Update address statuses
        for (const addr of addresses) {
          this.addressPool.updateAddressStatus(
            params.agentId,
            params.chain,
            addr.address,
            'consolidated',
          );

          // Update context tags with consolidation tx hash
          const tags = this.tagManager.getTagsByAddress(addr.address);
          for (const tag of tags) {
            this.tagManager.updateTagConsolidation(tag.id, txHash);
          }
        }
      } catch {
        record.status = 'failed';
      }
    } else {
      record.status = 'failed';
    }

    // Trim old records
    if (this.records.size > MAX_CONSOLIDATION_RECORDS) {
      const entries = Array.from(this.records.entries());
      entries.sort((a, b) => {
        const tA = new Date(a[1].createdAt).getTime();
        const tB = new Date(b[1].createdAt).getTime();
        return tA - tB;
      });
      const toRemove = entries.slice(0, entries.length - MAX_CONSOLIDATION_RECORDS);
      for (const [key] of toRemove) {
        this.records.delete(key);
      }
    }

    try {
      await this.save();
    } catch (error) {
      console.error('ConsolidationScheduler.save:', error);
    }

    return record;
  }

  /**
   * Fisher-Yates shuffle — in-place random permutation.
   * @internal Exposed as static for testability.
   */
  static shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
  }

  /**
   * Promise-based delay.
   * @internal Exposed as static for testability / mocking.
   */
  static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
