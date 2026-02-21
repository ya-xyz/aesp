/**
 * AESP — Commitment Builder
 *
 * Creates, signs, and verifies EIP-712 structured commitments
 * between buyer and seller agents.
 */

import type { HexString, StorageAdapter } from '../types/index.js';
import { AESPError } from '../types/index.js';
import type {
  EIP712Commitment,
  EIP712Domain,
  CommitmentValue,
  CommitmentRecord,
  CommitmentStatus,
  CommitmentHashInput,
} from '../types/commitment.js';
import { COMMITMENT_TYPE_FIELDS as TYPE_FIELDS } from '../types/commitment.js';
import { signTypedData } from '../crypto/signing.js';
import { sha256, generateUUID } from '../crypto/hashing.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const COMMITMENTS_STORAGE_KEY = 'aesp:commitments';

// ─── Commitment Builder ──────────────────────────────────────────────────────

export class CommitmentBuilder {
  private records: Map<string, CommitmentRecord> = new Map();

  constructor(private readonly storage: StorageAdapter) {}

  /**
   * Create a new commitment draft.
   */
  createCommitment(params: {
    buyerAgent: string;
    sellerAgent: string;
    item: string;
    price: string;
    currency: string;
    deliveryDeadline: number;
    arbitrator: string;
    escrowRequired: boolean;
    chainId: number;
  }): CommitmentRecord {
    const priceNum = Number(params.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      throw new AESPError('Commitment price must be a non-negative number', 'INVALID_PRICE');
    }
    if (!Number.isFinite(params.deliveryDeadline) || params.deliveryDeadline < 0) {
      throw new AESPError('deliveryDeadline must be a non-negative number (e.g. Unix timestamp)', 'INVALID_DEADLINE');
    }
    if (!Number.isInteger(params.chainId) || params.chainId < 0) {
      throw new AESPError('chainId must be a non-negative integer', 'INVALID_CHAIN_ID');
    }

    const domain: EIP712Domain = {
      name: 'YalletAgentCommitment',
      version: '1',
      chainId: params.chainId,
    };

    const value: CommitmentValue = {
      buyerAgent: params.buyerAgent,
      sellerAgent: params.sellerAgent,
      item: params.item,
      price: params.price,
      currency: params.currency,
      deliveryDeadline: params.deliveryDeadline,
      arbitrator: params.arbitrator,
      escrowRequired: params.escrowRequired,
      // Safe integer range; for uint256/on-chain use string or bigint in future
      nonce: this.generateSecureNonce(),
    };

    const commitment: EIP712Commitment = {
      domain,
      types: {
        Commitment: [...TYPE_FIELDS],
      },
      value,
    };

    const now = new Date().toISOString();
    const record: CommitmentRecord = {
      id: generateUUID(),
      commitment,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(record.id, record);
    return record;
  }

  /**
   * Sign commitment as buyer.
   */
  async signAsBuyer(
    commitmentId: string,
    mnemonic: string,
    passphrase: string,
  ): Promise<CommitmentRecord> {
    const record = this.getRecordOrThrow(commitmentId);

    if (record.status !== 'draft' && record.status !== 'proposed') {
      throw new AESPError(
        `Cannot sign as buyer: commitment is in state '${record.status}'`,
        'INVALID_COMMITMENT_STATE',
      );
    }

    const hash = await this.computeCommitmentHash(record.commitment);
    const signature = signTypedData(mnemonic, passphrase, hash);

    record.commitment.buyerSignature = signature;
    record.status = record.commitment.sellerSignature ? 'fully_signed' : 'buyer_signed';
    record.updatedAt = new Date().toISOString();

    return record;
  }

  /**
   * Sign commitment as seller.
   */
  async signAsSeller(
    commitmentId: string,
    mnemonic: string,
    passphrase: string,
  ): Promise<CommitmentRecord> {
    const record = this.getRecordOrThrow(commitmentId);

    if (record.status !== 'draft' && record.status !== 'proposed' && record.status !== 'buyer_signed') {
      throw new AESPError(
        `Cannot sign as seller: commitment is in state '${record.status}'`,
        'INVALID_COMMITMENT_STATE',
      );
    }

    const hash = await this.computeCommitmentHash(record.commitment);
    const signature = signTypedData(mnemonic, passphrase, hash);

    record.commitment.sellerSignature = signature;
    record.status = record.commitment.buyerSignature ? 'fully_signed' : 'proposed';
    record.updatedAt = new Date().toISOString();

    return record;
  }

  /**
   * Update commitment status.
   */
  updateStatus(commitmentId: string, status: CommitmentStatus, metadata?: {
    escrowTxHash?: string;
    deliveryConfirmationHash?: string;
    releaseTxHash?: string;
    disputeId?: string;
    arweaveAuditTx?: string;
  }): CommitmentRecord {
    const record = this.getRecordOrThrow(commitmentId);

    // Validate status transition
    this.validateStatusTransition(record.status, status);

    record.status = status;
    record.updatedAt = new Date().toISOString();

    if (metadata) {
      if (metadata.escrowTxHash) record.escrowTxHash = metadata.escrowTxHash;
      if (metadata.deliveryConfirmationHash) record.deliveryConfirmationHash = metadata.deliveryConfirmationHash;
      if (metadata.releaseTxHash) record.releaseTxHash = metadata.releaseTxHash;
      if (metadata.disputeId) record.disputeId = metadata.disputeId;
      if (metadata.arweaveAuditTx) record.arweaveAuditTx = metadata.arweaveAuditTx;
    }

    return record;
  }

  // ─── Query ─────────────────────────────────────────────────────────────

  getCommitment(id: string): CommitmentRecord | undefined {
    return this.records.get(id);
  }

  getCommitmentsByStatus(status: CommitmentStatus): CommitmentRecord[] {
    return Array.from(this.records.values()).filter((r) => r.status === status);
  }

  getCommitmentsByAgent(agentId: string): CommitmentRecord[] {
    return Array.from(this.records.values()).filter(
      (r) =>
        r.commitment.value.buyerAgent === agentId ||
        r.commitment.value.sellerAgent === agentId,
    );
  }

  getAllCommitments(): CommitmentRecord[] {
    return Array.from(this.records.values());
  }

  // ─── Hash ──────────────────────────────────────────────────────────────

  /**
   * Compute a deterministic hash of a commitment for signing.
   * Note: This is SHA-256(JSON) for portability. For on-chain EIP-712 verification
   * use the full EIP-712 typeHash + structHash + domainSeparator digest (keccak256).
   */
  async computeCommitmentHash(commitment: EIP712Commitment): Promise<HexString> {
    const input: CommitmentHashInput = {
      domain: commitment.domain,
      value: commitment.value,
    };
    return sha256(JSON.stringify(input));
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  async load(): Promise<void> {
    const stored = await this.storage.get<CommitmentRecord[]>(COMMITMENTS_STORAGE_KEY);
    if (stored) {
      this.records.clear();
      for (const r of stored) {
        this.records.set(r.id, r);
      }
    }
  }

  async save(): Promise<void> {
    await this.storage.set(
      COMMITMENTS_STORAGE_KEY,
      Array.from(this.records.values()),
    );
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private generateSecureNonce(): number {
    const array = new Uint32Array(2);
    crypto.getRandomValues(array);
    // Combine two 32-bit values into a safe integer (max 2^53 - 1).
    // Use only the lower 21 bits of array[0] to stay within safe integer range
    // (21 + 32 = 53 bits ≤ Number.MAX_SAFE_INTEGER).
    const high = array[0] & 0x1FFFFF; // 21 bits
    return high * 0x100000000 + array[1];
  }

  private getRecordOrThrow(id: string): CommitmentRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new AESPError(`Commitment ${id} not found`, 'COMMITMENT_NOT_FOUND');
    }
    return record;
  }

  private validateStatusTransition(from: CommitmentStatus, to: CommitmentStatus): void {
    const validTransitions: Record<CommitmentStatus, CommitmentStatus[]> = {
      draft: ['proposed', 'buyer_signed', 'cancelled'],
      proposed: ['buyer_signed', 'fully_signed', 'cancelled'],
      buyer_signed: ['fully_signed', 'cancelled'],
      fully_signed: ['escrowed', 'cancelled'],
      escrowed: ['delivered', 'disputed'],
      delivered: ['completed', 'disputed'],
      completed: [],
      disputed: ['completed', 'cancelled'],
      cancelled: [],
    };

    const allowed = validTransitions[from];
    if (!allowed || !allowed.includes(to)) {
      throw new AESPError(
        `Invalid commitment status transition: ${from} → ${to}`,
        'INVALID_STATUS_TRANSITION',
      );
    }
  }
}
