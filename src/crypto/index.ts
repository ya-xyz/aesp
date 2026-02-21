/**
 * AESP — Crypto Module Exports
 */

export {
  setWasmModule,
  getWasmModule,
  isWasmInitialized,
  initWasm,
  resetWasm,
  type AcegfWasmModule,
} from './wasm-bridge.js';

export {
  signMessage,
  signWithXidentity,
  verifyXidentitySignature,
  signTypedData,
  signWithAgentKey,
} from './signing.js';

export {
  encryptForXidentity,
  decryptWithMnemonic,
  computeSharedKey,
  encryptAgentMessage,
  decryptAgentMessage,
  type EncryptedEnvelope,
} from './encryption.js';

export {
  sha256,
  sha256Sync,
  hashPolicy,
  hashCommitment,
  generateUUID,
} from './hashing.js';
