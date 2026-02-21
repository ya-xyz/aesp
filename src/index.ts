/**
 * AESP — Agent Economic Sovereignty Protocol
 *
 * Unified export for the entire protocol stack.
 *
 * ┌─────────────────────────────────────────────────┐
 * │  DSE (Digital Sovereign Entity)                  │
 * │  Human controls everything via Yallet            │
 * ├─────────────────────────────────────────────────┤
 * │  AESP Protocol Layer                             │
 * │  Identity │ Policy │ Negotiation │ Commitment    │
 * │  Review   │ MCP    │ A2A         │ Crypto        │
 * ├─────────────────────────────────────────────────┤
 * │  MCP / A2A / AP2 Bridge                          │
 * │  External AI frameworks discover & call Yault    │
 * ├─────────────────────────────────────────────────┤
 * │  Yault Settlement Layer                          │
 * │  Vaults │ Escrow │ Allowances │ Authority        │
 * └─────────────────────────────────────────────────┘
 */

// ─── Types ───────────────────────────────────────────────────────────────────
export * from './types/index.js';

// ─── Crypto ──────────────────────────────────────────────────────────────────
export {
  setWasmModule,
  getWasmModule,
  isWasmInitialized,
  initWasm,
  resetWasm,
  signMessage,
  signWithXidentity,
  verifyXidentitySignature,
  signTypedData,
  signWithAgentKey,
  encryptForXidentity,
  decryptWithMnemonic,
  computeSharedKey,
  encryptAgentMessage,
  decryptAgentMessage,
  sha256,
  sha256Sync,
  hashPolicy,
  hashCommitment,
  generateUUID,
} from './crypto/index.js';
export type { AcegfWasmModule, EncryptedEnvelope } from './crypto/index.js';

// ─── Identity ────────────────────────────────────────────────────────────────
export {
  deriveAgentIdentity,
  createAgentCertificate,
  verifyCertificate,
  isCertificateExpired,
  hasCertificateCapability,
  AgentHierarchyManager,
} from './identity/index.js';

// ─── Policy ──────────────────────────────────────────────────────────────────
export {
  PolicyEngine,
  BudgetTracker,
} from './policy/index.js';

// ─── Negotiation ─────────────────────────────────────────────────────────────
export {
  NegotiationStateMachine,
  NegotiationProtocol,
} from './negotiation/index.js';
export type { NegotiationMessageSender } from './negotiation/index.js';

// ─── Commitment ──────────────────────────────────────────────────────────────
export {
  CommitmentBuilder,
} from './commitment/index.js';

// ─── Review ──────────────────────────────────────────────────────────────────
export {
  ReviewManager,
} from './review/index.js';
export type { ReviewEventType, ReviewEventHandler } from './review/index.js';

// ─── MCP ─────────────────────────────────────────────────────────────────────
export {
  MCP_TOOLS,
  getAllMCPTools,
  getMCPTool,
  validateToolArgs,
  MCPServer,
  createToolResult,
  createTextResult,
  createErrorResult,
} from './mcp/index.js';
export type { MCPToolHandler } from './mcp/index.js';

// ─── A2A ─────────────────────────────────────────────────────────────────────
export {
  AgentCardBuilder,
  generateAgentCard,
} from './a2a/index.js';

// ─── Privacy ────────────────────────────────────────────────────────────────
export {
  AddressPoolManager,
  ContextTagManager,
  ConsolidationScheduler,
} from './privacy/index.js';
export type { ArweaveUploader, AuditNFTMinter, ConsolidationHandler } from './privacy/index.js';

// ─── Version ─────────────────────────────────────────────────────────────────
export const AESP_VERSION = '0.1.0';
export const AESP_PROTOCOL_VERSION = '1.0';
