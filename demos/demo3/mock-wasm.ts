/**
 * AESP Demo — Browser-Compatible WASM Mock
 *
 * Rewrites tests/helpers.ts createMockWasm() replacing all Node.js Buffer
 * usage with browser-native APIs (TextEncoder, btoa, atob, Uint8Array).
 */

import type { AcegfWasmModule } from '../src/crypto/wasm-bridge.js';
import { setWasmModule } from '../src/crypto/wasm-bridge.js';

// ─── Browser-Compatible Helpers ─────────────────────────────────────────────

function textToHex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function textToBase64(text: string): string {
  return btoa(text);
}

function base64ToText(b64: string): string {
  return atob(b64);
}

/** Simple deterministic hash for mock addresses */
function simpleHash(data: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    const c = data.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x811c9dc5);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return (part1 + part2).repeat(4);
}

// ─── Mock WASM Module ────────────────────────────────────────────────────────

let signCounter = 0;

export function createBrowserMockWasm(): AcegfWasmModule {
  signCounter = 0;

  return {
    generate_wasm(passphrase: string): string {
      return JSON.stringify({
        mnemonic:
          'mock mnemonic word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12',
        passphrase,
      });
    },

    view_wallet_unified_wasm(_mnemonic: string, _passphrase: string): string {
      return JSON.stringify({
        solana: { address: 'So1ana1111111111111111111111111111111111111' },
        ethereum: { address: '0x1234567890abcdef1234567890abcdef12345678' },
        xidentity: textToBase64('mock_xidentity'),
      });
    },

    acegf_sign_message_wasm(
      _mnemonic: string,
      _passphrase: string,
      message: string,
      curve: string,
    ): string {
      signCounter++;
      const mockSig = textToHex(
        `sig_${curve}_${signCounter}_${message.slice(0, 16)}`,
      );
      const mockPub = textToHex(`pub_${curve}_${signCounter}`);
      return JSON.stringify({
        signature: mockSig,
        public_key: mockPub,
      });
    },

    acegf_xidentity_sign_wasm(
      _mnemonic: string,
      _passphrase: string,
      message: string,
    ): string {
      return textToHex(`xid_sig_${message.slice(0, 20)}`);
    },

    acegf_xidentity_verify_wasm(
      _xidentity_b64: string,
      _message: string,
      _signature: string,
    ): boolean {
      return true;
    },

    acegf_encrypt_for_xidentity(
      _recipient_xidentity_b64: string,
      plaintext: string,
    ): string {
      return textToBase64(`encrypted:${plaintext}`);
    },

    acegf_decrypt_with_mnemonic_wasm(
      _mnemonic: string,
      _passphrase: string,
      encrypted_b64: string,
      _sender_pub_b64: string,
    ): string {
      const decoded = base64ToText(encrypted_b64);
      return decoded.replace('encrypted:', '');
    },

    acegf_compute_dh_key_wasm(
      _mnemonic: string,
      _passphrase: string,
      _peer_pub_b64: string,
    ): string {
      return textToBase64('mock_shared_key_32bytes_here!!!!');
    },

    evm_sign_typed_data(
      _mnemonic: string,
      _passphrase: string,
      typed_data_hash: string,
    ): string {
      return textToHex(`eip712_sig_${typed_data_hash.slice(0, 16)}`);
    },

    derive_child_key_wasm(
      _mnemonic: string,
      _passphrase: string,
      path: string,
    ): string {
      const mockPub = textToHex(`child_pub_${path}`);
      return JSON.stringify({
        public_key: mockPub,
        path,
      });
    },

    sha256_wasm(data: string): string {
      let h1 = 0x811c9dc5;
      let h2 = 0x01000193;
      for (let i = 0; i < data.length; i++) {
        const c = data.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193);
        h2 = Math.imul(h2 ^ c, 0x811c9dc5);
      }
      const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
      const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
      return (part1 + part2).repeat(4);
    },

    // ─── Context-Isolated Address Derivation (REV32 mock) ─────────────

    view_wallet_unified_with_context_wasm(
      _mnemonic: string,
      _passphrase: string,
      context: string,
    ): string {
      const ctxHash = simpleHash(context);
      return JSON.stringify({
        solana: { address: `SoCtx${ctxHash.slice(0, 38)}` },
        ethereum: { address: `0x${ctxHash.slice(0, 40)}` },
        bitcoin: { address: `bc1q${ctxHash.slice(0, 38)}` },
        xidentity: textToBase64(`ctx_xid_${context.slice(0, 10)}`),
      });
    },

    evm_get_address_with_context(
      _mnemonic: string,
      _passphrase: string,
      context: string,
    ): string {
      const ctxHash = simpleHash(context);
      return `0x${ctxHash.slice(0, 40)}`;
    },

    evm_sign_eip1559_transaction_with_context(
      _mnemonic: string,
      _passphrase: string,
      context: string,
      _chain_id: number,
      _nonce: string,
      _max_priority_fee_per_gas: string,
      _max_fee_per_gas: string,
      _gas_limit: string,
      _to: string,
      _value: string,
      _data: string,
    ): string {
      return JSON.stringify({
        raw_tx: `0xctx_signed_${context.slice(0, 20)}`,
        tx_hash: `0xhash_${context.slice(0, 20)}`,
      });
    },

    evm_sign_personal_message_with_context(
      _mnemonic: string,
      _passphrase: string,
      context: string,
      _message: string,
    ): string {
      return textToHex(`ctx_personal_sig_${context.slice(0, 20)}`);
    },

    evm_sign_typed_data_with_context(
      _mnemonic: string,
      _passphrase: string,
      context: string,
      _typed_data_hash: string,
    ): string {
      return textToHex(`ctx_eip712_sig_${context.slice(0, 20)}`);
    },

    // ─── Context-Isolated Solana Operations (REV32 mock) ──────────────

    solana_get_address_with_context(
      _mnemonic: string,
      _passphrase: string,
      context: string,
    ): string {
      const ctxHash = simpleHash(context);
      return `SoCtx${ctxHash.slice(0, 39)}`;
    },

    solana_sign_transaction_with_context(
      _mnemonic: string,
      _passphrase: string,
      context: string,
      _transaction_b64: string,
    ): string {
      return textToBase64(`ctx_sol_tx_sig_${context.slice(0, 20)}`);
    },

    solana_sign_message_with_context(
      _mnemonic: string,
      _passphrase: string,
      context: string,
      _message: string,
    ): string {
      return textToBase64(`ctx_sol_msg_sig_${context.slice(0, 20)}`);
    },
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setupBrowserMockWasm(): AcegfWasmModule {
  const mock = createBrowserMockWasm();
  setWasmModule(mock);
  return mock;
}
