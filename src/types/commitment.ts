/**
 * AESP — Commitment Types
 *
 * EIP-712 structured commitment definitions for agent agreements.
 */

import type { HexString, ISOTimestamp, UUID } from './common.js';

// ─── EIP-712 Domain ──────────────────────────────────────────────────────────

export interface EIP712Domain {
  name: 'YalletAgentCommitment';
  version: '1';
  chainId: number;
}

// ─── EIP-712 Types ───────────────────────────────────────────────────────────

export interface EIP712TypeField {
  name: string;
  type: string;
}

export const COMMITMENT_TYPE_FIELDS: readonly EIP712TypeField[] = [
  { name: 'buyerAgent', type: 'address' },
  { name: 'sellerAgent', type: 'address' },
  { name: 'item', type: 'string' },
  { name: 'price', type: 'uint256' },
  { name: 'currency', type: 'address' },
  { name: 'deliveryDeadline', type: 'uint256' },
  { name: 'arbitrator', type: 'address' },
  { name: 'escrowRequired', type: 'bool' },
  { name: 'nonce', type: 'uint256' },
] as const;

// ─── Commitment Value ────────────────────────────────────────────────────────

export interface CommitmentValue {
  buyerAgent: string;
  sellerAgent: string;
  item: string;
  price: string;
  currency: string;
  deliveryDeadline: number;
  arbitrator: string;
  escrowRequired: boolean;
  nonce: number;
}

// ─── EIP-712 Commitment ──────────────────────────────────────────────────────

export interface EIP712Commitment {
  domain: EIP712Domain;
  types: {
    Commitment: EIP712TypeField[];
  };
  value: CommitmentValue;
  buyerSignature?: HexString;
  sellerSignature?: HexString;
}

// ─── Commitment Lifecycle ────────────────────────────────────────────────────

export type CommitmentStatus =
  | 'draft'
  | 'proposed'
  | 'buyer_signed'
  | 'fully_signed'
  | 'escrowed'
  | 'delivered'
  | 'completed'
  | 'disputed'
  | 'cancelled';

export interface CommitmentRecord {
  id: UUID;
  commitment: EIP712Commitment;
  status: CommitmentStatus;
  escrowTxHash?: string;
  deliveryConfirmationHash?: string;
  releaseTxHash?: string;
  disputeId?: string;
  arweaveAuditTx?: string;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

// ─── Commitment Hash ─────────────────────────────────────────────────────────

export interface CommitmentHashInput {
  domain: EIP712Domain;
  value: CommitmentValue;
}
