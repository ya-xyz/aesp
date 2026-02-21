/**
 * AESP — Ephemeral Address Pool Manager
 *
 * Manages pre-derived context-isolated ephemeral addresses.
 * Each agent can have a pool of ready-to-use addresses per chain and direction.
 *
 * Address derivation uses ACE-GF's context isolation:
 *   context_info = build_vault_context(["agent:{agentId}", "dir:{direction}", "seq:{n}"])
 *   address = HKDF(identity_root, info="ACEGF-REV32-V1-SECP256K1-EVM:{context_info}")
 */

import type { StorageAdapter, ChainId } from '../types/index.js';
import type {
  EphemeralAddress,
  AddressPoolState,
  PrivacyLevel,
} from '../types/privacy.js';
import { AESPError } from '../types/index.js';
import { generateUUID } from '../crypto/hashing.js';
import { getWasmModule } from '../crypto/wasm-bridge.js';
import type { ContextWasmFunctions } from '../types/privacy.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const POOL_STORAGE_KEY = 'aesp:address_pool';
const DEFAULT_POOL_SIZE = 5;

// ─── Address Pool Manager ───────────────────────────────────────────────────

export class AddressPoolManager {
  private pools: Map<string, AddressPoolState> = new Map();

  constructor(private readonly storage: StorageAdapter) {}

  /**
   * Check whether the current WASM module supports context isolation (REV32 only).
   * Legacy UUID wallets do NOT support context-isolated address derivation.
   * Call this before using any privacy features to fail early with a clear message.
   */
  static supportsContextIsolation(): boolean {
    try {
      const wasm = getWasmModule() as unknown as ContextWasmFunctions & Record<string, unknown>;
      return !!(
        wasm.view_wallet_unified_with_context_wasm ||
        wasm.evm_get_address_with_context ||
        wasm.solana_get_address_with_context
      );
    } catch {
      return false;
    }
  }

  /**
   * Assert that context isolation is available; throw if not.
   */
  private static assertContextIsolation(): void {
    if (!AddressPoolManager.supportsContextIsolation()) {
      throw new AESPError(
        'Context-isolated address derivation requires a REV32 wallet. ' +
        'Legacy UUID wallets do not support this feature.',
        'REV32_REQUIRED',
      );
    }
  }

  /**
   * Build a context_info string from segments (sorted, colon-joined).
   * Mirrors ACE-GF's build_vault_context.
   */
  static buildContextInfo(segments: string[]): string {
    return [...segments].sort().join(':');
  }

  /**
   * Derive an ephemeral address for a specific transaction.
   * This is the primary method for `isolated` privacy level.
   */
  deriveEphemeralAddress(params: {
    mnemonic: string;
    passphrase: string;
    agentId: string;
    chain: ChainId;
    direction: 'inbound' | 'outbound';
    txUUID?: string;
  }): EphemeralAddress {
    AddressPoolManager.assertContextIsolation();
    const pool = this.getOrCreatePool(params.agentId, params.chain);
    const seq = pool.sequenceCounter++;
    const txId = params.txUUID ?? generateUUID();

    const contextInfo = AddressPoolManager.buildContextInfo([
      `agent:${params.agentId}`,
      `dir:${params.direction}`,
      `seq:${seq}`,
      `tx:${txId}`,
    ]);

    const address = this.deriveAddressFromContext(
      params.mnemonic,
      params.passphrase,
      params.chain,
      contextInfo,
    );

    const ephemeral: EphemeralAddress = {
      address,
      chain: params.chain,
      contextInfo,
      agentId: params.agentId,
      direction: params.direction,
      status: 'assigned',
      assignedTxUUID: txId,
      createdAt: new Date().toISOString(),
    };

    if (params.direction === 'outbound') {
      pool.outbound.push(ephemeral);
    } else {
      pool.inbound.push(ephemeral);
    }

    this.scheduleSave();
    return ephemeral;
  }

  /**
   * Get a pre-derived address from the pool (for `basic` privacy level).
   * The `basic` level uses a single context per agent+chain+direction.
   */
  getBasicAddress(params: {
    mnemonic: string;
    passphrase: string;
    agentId: string;
    chain: ChainId;
    direction: 'inbound' | 'outbound';
  }): string {
    AddressPoolManager.assertContextIsolation();
    const contextInfo = AddressPoolManager.buildContextInfo([
      `agent:${params.agentId}`,
      `dir:${params.direction}`,
      `mode:basic`,
    ]);

    return this.deriveAddressFromContext(
      params.mnemonic,
      params.passphrase,
      params.chain,
      contextInfo,
    );
  }

  /**
   * Pre-derive a batch of ephemeral addresses to fill the pool.
   */
  replenishPool(params: {
    mnemonic: string;
    passphrase: string;
    agentId: string;
    chain: ChainId;
    direction: 'inbound' | 'outbound';
    count?: number;
  }): EphemeralAddress[] {
    AddressPoolManager.assertContextIsolation();
    const pool = this.getOrCreatePool(params.agentId, params.chain);
    const count = params.count ?? DEFAULT_POOL_SIZE;
    const derived: EphemeralAddress[] = [];

    const targetList = params.direction === 'outbound' ? pool.outbound : pool.inbound;
    const availableCount = targetList.filter((a) => a.status === 'available').length;
    const toDerive = Math.max(0, count - availableCount);

    for (let i = 0; i < toDerive; i++) {
      const seq = pool.sequenceCounter++;
      const contextInfo = AddressPoolManager.buildContextInfo([
        `agent:${params.agentId}`,
        `dir:${params.direction}`,
        `seq:${seq}`,
        `pool:pre`,
      ]);

      const address = this.deriveAddressFromContext(
        params.mnemonic,
        params.passphrase,
        params.chain,
        contextInfo,
      );

      const ephemeral: EphemeralAddress = {
        address,
        chain: params.chain,
        contextInfo,
        agentId: params.agentId,
        direction: params.direction,
        status: 'available',
        createdAt: new Date().toISOString(),
      };

      targetList.push(ephemeral);
      derived.push(ephemeral);
    }

    if (derived.length > 0) {
      this.scheduleSave();
    }
    return derived;
  }

  /**
   * Claim an available address from the pool and assign it to a transaction.
   */
  claimFromPool(params: {
    agentId: string;
    chain: ChainId;
    direction: 'inbound' | 'outbound';
    txUUID: string;
  }): EphemeralAddress | null {
    const pool = this.pools.get(this.poolKey(params.agentId, params.chain));
    if (!pool) return null;

    const list = params.direction === 'outbound' ? pool.outbound : pool.inbound;
    const available = list.find((a) => a.status === 'available');
    if (!available) return null;

    available.status = 'assigned';
    available.assignedTxUUID = params.txUUID;
    available.usedAt = new Date().toISOString();
    this.scheduleSave();
    return available;
  }

  /**
   * Update the status of an ephemeral address.
   */
  updateAddressStatus(
    agentId: string,
    chain: ChainId,
    address: string,
    status: EphemeralAddress['status'],
  ): void {
    const pool = this.pools.get(this.poolKey(agentId, chain));
    if (!pool) return;

    const all = [...pool.outbound, ...pool.inbound];
    const found = all.find((a) => a.address === address);
    if (found) {
      found.status = status;
      if (status === 'spent' || status === 'consolidated') {
        found.usedAt = new Date().toISOString();
      }
      this.scheduleSave();
    }
  }

  /**
   * Get all derived addresses for an agent (for reconciliation).
   */
  getAllDerivedAddresses(agentId: string): EphemeralAddress[] {
    const result: EphemeralAddress[] = [];
    for (const [key, pool] of this.pools) {
      if (key.startsWith(`${agentId}:`)) {
        result.push(...pool.outbound, ...pool.inbound);
      }
    }
    return result;
  }

  /**
   * Get addresses that need consolidation (funded inbound addresses).
   */
  getAddressesForConsolidation(agentId: string, chain: ChainId): EphemeralAddress[] {
    const pool = this.pools.get(this.poolKey(agentId, chain));
    if (!pool) return [];
    return pool.inbound.filter((a) => a.status === 'funded');
  }

  /**
   * Resolve an address back to the privacy level that should be used.
   * - transparent: use vault address directly; returns address '' — caller must use vault address.
   * - basic: agent-level address.
   * - isolated: per-tx ephemeral address.
   *
   * @returns For transparent, address is ''; do not use as a valid chain address — use vault address instead.
   */
  resolveAddress(params: {
    mnemonic: string;
    passphrase: string;
    agentId: string;
    chain: ChainId;
    direction: 'inbound' | 'outbound';
    privacyLevel: PrivacyLevel;
    txUUID?: string;
  }): { address: string; contextInfo: string | null; ephemeral: EphemeralAddress | null } {
    if (params.privacyLevel === 'transparent') {
      return { address: '', contextInfo: null, ephemeral: null }; // caller uses vault address
    }

    if (params.privacyLevel === 'basic') {
      const address = this.getBasicAddress({
        mnemonic: params.mnemonic,
        passphrase: params.passphrase,
        agentId: params.agentId,
        chain: params.chain,
        direction: params.direction,
      });
      const contextInfo = AddressPoolManager.buildContextInfo([
        `agent:${params.agentId}`,
        `dir:${params.direction}`,
        `mode:basic`,
      ]);
      return { address, contextInfo, ephemeral: null };
    }

    // isolated: try pool first, then derive fresh
    const txUUID = params.txUUID ?? generateUUID();
    const pooled = this.claimFromPool({
      agentId: params.agentId,
      chain: params.chain,
      direction: params.direction,
      txUUID,
    });
    if (pooled) {
      return { address: pooled.address, contextInfo: pooled.contextInfo, ephemeral: pooled };
    }

    const ephemeral = this.deriveEphemeralAddress({
      mnemonic: params.mnemonic,
      passphrase: params.passphrase,
      agentId: params.agentId,
      chain: params.chain,
      direction: params.direction,
      txUUID,
    });
    return { address: ephemeral.address, contextInfo: ephemeral.contextInfo, ephemeral };
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  async load(): Promise<void> {
    const stored = await this.storage.get<Record<string, AddressPoolState>>(POOL_STORAGE_KEY);
    if (stored) {
      this.pools.clear();
      for (const [key, value] of Object.entries(stored)) {
        this.pools.set(key, value);
      }
    }
  }

  async save(): Promise<void> {
    const data: Record<string, AddressPoolState> = {};
    for (const [key, value] of this.pools) {
      data[key] = value;
    }
    await this.storage.set(POOL_STORAGE_KEY, data);
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private poolKey(agentId: string, chain: ChainId): string {
    return `${agentId}:${chain}`;
  }

  private getOrCreatePool(agentId: string, chain: ChainId): AddressPoolState {
    const key = this.poolKey(agentId, chain);
    let pool = this.pools.get(key);
    if (!pool) {
      pool = {
        agentId,
        chain,
        outbound: [],
        inbound: [],
        sequenceCounter: 0,
      };
      this.pools.set(key, pool);
    }
    return pool;
  }

  private deriveAddressFromContext(
    mnemonic: string,
    passphrase: string,
    chain: ChainId,
    contextInfo: string,
  ): string {
    const wasm = getWasmModule() as unknown as ContextWasmFunctions & Record<string, unknown>;

    // EVM chains: use evm_get_address_with_context if available
    const evmChains: ChainId[] = ['ethereum', 'polygon', 'base', 'arbitrum'];
    if (evmChains.includes(chain) && wasm.evm_get_address_with_context) {
      return wasm.evm_get_address_with_context(mnemonic, passphrase, contextInfo);
    }

    // Solana: use solana_get_address_with_context if available
    if (chain === 'solana' && wasm.solana_get_address_with_context) {
      return wasm.solana_get_address_with_context(mnemonic, passphrase, contextInfo);
    }

    // Generic fallback: use view_wallet_unified_with_context_wasm
    if (wasm.view_wallet_unified_with_context_wasm) {
      const result = wasm.view_wallet_unified_with_context_wasm(mnemonic, passphrase, contextInfo);
      const parsed = JSON.parse(result);
      // Return chain-specific address from the unified view
      if (chain === 'solana' && parsed.solana?.address) return parsed.solana.address;
      if (chain === 'bitcoin' && parsed.bitcoin?.address) return parsed.bitcoin.address;
      if (parsed.ethereum?.address) return parsed.ethereum.address; // fallback for EVM
      throw new Error(`Chain ${chain} not found in context-derived wallet`);
    }

    // Fallback: generate a deterministic pseudo-address from context (for testing)
    return `ctx:${chain}:${contextInfo.slice(0, 20)}`;
  }

  /**
   * Cancel any pending save timer (for cleanup / shutdown).
   */
  dispose(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
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
}
