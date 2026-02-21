/**
 * AESP — Common Types
 *
 * Shared type definitions used across all AESP modules.
 */

// ─── Primitives ──────────────────────────────────────────────────────────────

/** Hex-encoded string (without 0x prefix) */
export type HexString = string;

/** Base64-encoded string */
export type Base64String = string;

/** ISO 8601 timestamp string */
export type ISOTimestamp = string;

/** UUID v4 string */
export type UUID = string;

/** Blockchain chain identifier */
export type ChainId = 'solana' | 'ethereum' | 'polygon' | 'base' | 'arbitrum' | 'bitcoin' | string;

/** Token identifier — 'native' or contract address */
export type TokenId = 'native' | string;

/** DID format: did:yallet:<agentId> */
export type AgentDID = `did:yallet:${string}`;

// ─── Crypto ──────────────────────────────────────────────────────────────────

export type CurveType = 'ed25519' | 'secp256k1';

export interface KeyPair {
  publicKey: HexString;
  secretKey: Uint8Array;
}

export interface SignatureResult {
  signature: HexString;
  publicKey: HexString;
}

// ─── Agent Basics ────────────────────────────────────────────────────────────

export type AgentCapability =
  | 'payment'
  | 'negotiation'
  | 'data_query'
  | 'commitment'
  | 'delegation'
  | 'arbitration';

export type AgentScope =
  | 'auto_payment'
  | 'negotiation'
  | 'commitment'
  | 'full';

export type EscalationAction =
  | 'block'
  | 'ask_parent_agent'
  | 'ask_human';

export type UrgencyLevel = 'low' | 'normal' | 'high' | 'critical';

// ─── Execution ───────────────────────────────────────────────────────────────

export interface TransferPayload {
  chainId: ChainId;
  token: TokenId;
  toAddress: string;
  amount: string;
  memo?: string;
}

export interface SignPersonalPayload {
  message: string;
  chainId?: ChainId;
}

export interface SignTypedDataPayload {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
  chainId?: ChainId;
}

export interface SendTransactionPayload {
  chainId: ChainId;
  to: string;
  value?: string;
  data?: string;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export type ExecutionAction =
  | { type: 'transfer'; payload: TransferPayload }
  | { type: 'sign_personal'; payload: SignPersonalPayload }
  | { type: 'sign_typed_data'; payload: SignTypedDataPayload }
  | { type: 'send_transaction'; payload: SendTransactionPayload };

export interface AgentExecutionRequest {
  requestId: UUID;
  vendorId: string;
  policyId?: string;
  action: ExecutionAction;
  reason?: string;
}

export interface AgentExecutionResult {
  success: boolean;
  requestId: UUID;
  signedPayload?: string;
  txHash?: string;
  error?: string;
  timestamp: number;
}

// ─── Messaging ───────────────────────────────────────────────────────────────

export type AgentMessageType =
  | 'negotiation_offer'
  | 'negotiation_counter'
  | 'negotiation_accept'
  | 'negotiation_reject'
  | 'commitment_proposal'
  | 'commitment_signed'
  | 'dispute_evidence'
  | 'review_request';

export interface AgentMessage {
  id: UUID;
  type: AgentMessageType | string;
  senderXidentity: Base64String;
  recipientXidentity?: Base64String;
  payload: unknown;
  /** Optional detached signature over serialized message content. */
  signature?: string;
  timestamp: number;
  threadId?: string;
}

export interface MessageContext {
  walletAddress: string;
  xidentity: Base64String;
  decryptPayload: (encrypted: string) => Promise<unknown>;
}

export interface MessageHandleResult {
  consumed: boolean;
  reply?: Omit<AgentMessage, 'id' | 'timestamp'>;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

// ─── Event System ────────────────────────────────────────────────────────────

export type AESPEventType =
  | 'policy:violation'
  | 'policy:auto_approved'
  | 'budget:warning'
  | 'budget:exceeded'
  | 'negotiation:state_changed'
  | 'commitment:created'
  | 'commitment:signed'
  | 'review:requested'
  | 'review:responded'
  | 'identity:created'
  | 'identity:expired';

export interface AESPEvent<T = unknown> {
  type: AESPEventType;
  timestamp: number;
  agentId: string;
  data: T;
}

export type AESPEventHandler<T = unknown> = (event: AESPEvent<T>) => void | Promise<void>;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class AESPError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AESPError';
  }
}

export class PolicyViolationError extends AESPError {
  constructor(
    rule: string,
    actual: string,
    limit: string,
  ) {
    super(
      `Policy violation: ${rule} (actual: ${actual}, limit: ${limit})`,
      'POLICY_VIOLATION',
      { rule, actual, limit },
    );
    this.name = 'PolicyViolationError';
  }
}

export class BudgetExceededError extends AESPError {
  constructor(
    period: string,
    spent: string,
    limit: string,
  ) {
    super(
      `Budget exceeded for ${period} (spent: ${spent}, limit: ${limit})`,
      'BUDGET_EXCEEDED',
      { period, spent, limit },
    );
    this.name = 'BudgetExceededError';
  }
}

export class NegotiationError extends AESPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NEGOTIATION_ERROR', details);
    this.name = 'NegotiationError';
  }
}

export class CryptoError extends AESPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CRYPTO_ERROR', details);
    this.name = 'CryptoError';
  }
}
