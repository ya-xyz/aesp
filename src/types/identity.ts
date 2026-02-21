/**
 * AESP — Identity Types
 *
 * Agent identity certificate, derivation, and DID definitions.
 */

import type {
  HexString,
  Base64String,
  ISOTimestamp,
  ChainId,
  AgentCapability,
  AgentDID,
} from './common.js';

// ─── Agent Identity Certificate ──────────────────────────────────────────────

export interface AgentIdentityCertificate {
  version: '1.0';
  agentId: string;
  pubkey: HexString;
  ownerXidentity: Base64String;
  capabilities: AgentCapability[];
  policyHash: HexString;
  maxAutonomousAmount: number;
  chains: ChainId[];
  createdAt: ISOTimestamp;
  expiresAt: ISOTimestamp;
  ownerSignature: HexString;
  registrationTx?: string;
}

// ─── Agent Derivation ────────────────────────────────────────────────────────

export interface AgentDerivationParams {
  mnemonic: string;
  passphrase: string;
  agentIndex: number;
}

export interface DerivedAgentIdentity {
  agentId: string;
  did: AgentDID;
  publicKey: HexString;
  derivationPath: string;
}

// ─── Agent Metadata ──────────────────────────────────────────────────────────

export interface AgentMetadata {
  agentType: 'shopping' | 'research' | 'finance' | 'dca' | 'data' | 'custom';
  modelProvider?: string;
  modelName?: string;
  capabilities: AgentCapability[];
  description?: string;
  parentAgentId?: string;
  createdBy: 'human' | 'agent';
}

// ─── Agent Sub-Account ───────────────────────────────────────────────────────

export interface AgentSubAccountPermissions {
  allowedOperations: string[];
  allowedChains: ChainId[];
  maxConcurrentTxs: number;
  timeWindow?: {
    start: string;
    end: string;
  };
}

export interface AgentSubAccount {
  accountId: string;
  agentId: string;
  role: 'agent';
  agentMetadata: AgentMetadata;
  permissions: AgentSubAccountPermissions;
  status: 'active' | 'frozen' | 'expired';
  createdAt: ISOTimestamp;
}

// ─── Agent Hierarchy ─────────────────────────────────────────────────────────

export interface AgentHierarchyNode {
  agentId: string;
  label: string;
  parentAgentId?: string;
  children: AgentHierarchyNode[];
  depth: number;
  maxDepth: number;
}

export interface AgentHierarchy {
  root: AgentHierarchyNode;
  totalAgents: number;
  maxDepth: number;
}
