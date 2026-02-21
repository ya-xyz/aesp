/**
 * AESP — Fund Consolidation Scheduler
 *
 * Manages batch sweeping of funds from ephemeral addresses back to the vault.
 * Supports both periodic (interval-based) and threshold-based consolidation.
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
const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
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

// ─── Consolidation Scheduler ────────────────────────────────────────────────

export class ConsolidationScheduler {
  private records: Map<string, ConsolidationRecord> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
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

  /**
   * Schedule periodic consolidation for an agent.
   */
  scheduleConsolidation(params: {
    agentId: string;
    chain: ChainId;
    vaultAddress: string;
    token?: TokenId;
    intervalMs?: number;
    policy?: PrivacyPolicy;
  }): void {
    const key = `${params.agentId}:${params.chain}`;
    const interval = params.intervalMs ?? DEFAULT_INTERVAL_MS;

    // Clear existing timer
    this.cancelConsolidation(params.agentId, params.chain);

    const timer = setInterval(async () => {
      try {
        await this.consolidateNow({
          agentId: params.agentId,
          chain: params.chain,
          vaultAddress: params.vaultAddress,
          token: params.token ?? 'native',
        });
      } catch (error) {
        // Keep scheduler alive even if one run fails.
        console.error('ConsolidationScheduler.scheduleConsolidation:', error);
      }
    }, interval);

    this.timers.set(key, timer);
  }

  /**
   * Cancel scheduled consolidation.
   */
  cancelConsolidation(agentId: string, chain: ChainId): void {
    const key = `${agentId}:${chain}`;
    const timer = this.timers.get(key);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(key);
    }
  }

  /**
   * Immediately consolidate all funded ephemeral addresses for an agent.
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

    const record: ConsolidationRecord = {
      id: generateUUID(),
      agentId: params.agentId,
      chain: params.chain,
      addresses: addresses.map((a) => a.address),
      totalAmount: '0', // to be filled by handler
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
      // Avoid unhandled rejection in interval-driven execution.
      console.error('ConsolidationScheduler.save:', error);
    }
    return record;
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
      clearInterval(timer);
    }
    this.timers.clear();
  }
}
