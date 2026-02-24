# AESP — Agent Economic Sovereignty Protocol

**Defining how AI agents operate economically under human sovereignty.**

AESP is a TypeScript protocol SDK that enables AI agents to autonomously negotiate, transact, and settle payments — all within human-defined policy boundaries. It bridges the gap between autonomous agent capabilities and the non-negotiable requirement for human control over economic actions.

```
┌─────────────────────────────────────────────────┐
│  DSE (Digital Sovereign Entity)                  │
│  Human controls everything via Yallet            │
├─────────────────────────────────────────────────┤
│  AESP Protocol Layer                             │
│  Identity │ Policy │ Negotiation │ Commitment    │
│  Review   │ MCP    │ A2A         │ Privacy       │
├─────────────────────────────────────────────────┤
│  MCP / A2A / AP2 Bridge                          │
│  External AI frameworks discover & call Yault    │
├─────────────────────────────────────────────────┤
│  Yault Settlement Layer                          │
│  Vaults │ Escrow │ Allowances │ Authority        │
└─────────────────────────────────────────────────┘
```

## Core Idea

Agents should be economically capable but never economically sovereign. AESP enforces this principle through:

- **Policy-gated execution** — Every agent action is checked against human-defined spending limits, allowlists, time windows, and chain restrictions before it can proceed.
- **Human-in-the-loop review** — Actions that exceed policy boundaries are routed to the human's mobile device for biometric approval.
- **Cryptographic commitments** — Agent-to-agent agreements are structured as EIP-712 typed data, signed by both parties, and settled on-chain via escrow.
- **Context-isolated privacy** — Each transaction uses HKDF-derived ephemeral addresses so that on-chain activity cannot be correlated across agent contexts.

## Modules

| Module | Description |
|---|---|
| **Identity** | BIP44-derived agent keypairs, identity certificates, and hierarchy management (human → parent agent → sub-agents, max 5 levels) |
| **Policy** | Authorization engine with per-tx/daily/weekly/monthly budget tracking, allowlist enforcement, time-window restrictions, and critical policy change escalation (auto / review / biometric) |
| **Negotiation** | FSM-based agent-to-agent negotiation protocol with E2E encrypted messaging, counter-offers, and automatic agreement hashing |
| **Commitment** | EIP-712 structured commitment builder with dual-signing (buyer + seller), status lifecycle tracking, and escrow integration |
| **Review** | Human-in-the-loop approval queue with urgency levels, expiration deadlines, event-driven notifications, and emergency agent freeze |
| **MCP** | Model Context Protocol tool definitions (8 tools) for balance checks, deposits, redemptions, allowances, disputes, and agent management |
| **A2A** | Google A2A agent card generation for cross-framework agent discovery and capability advertisement |
| **Privacy** | Context-isolated ephemeral address pools, Arweave-archived audit context tags, batched consolidation with timing jitter and shuffle |
| **Crypto** | Ed25519/secp256k1 signing, ECDH encryption, SHA-256 hashing via WASM (acegf) with Web Crypto fallback |

## Install

```bash
npm install @yallet/aesp
```

## Quick Start

```typescript
import {
  initWasm,
  deriveAgentIdentity,
  createAgentCertificate,
  PolicyEngine,
  BudgetTracker,
  NegotiationProtocol,
  CommitmentBuilder,
  ReviewManager,
} from '@yallet/aesp';

// 1. Initialize WASM crypto backend
const wasmBinary = await fetch('/wasm/acegf_bg.wasm').then(r => r.arrayBuffer());
await initWasm(wasmBinary);

// 2. Derive an agent identity from the owner's mnemonic
const agent = await deriveAgentIdentity({
  mnemonic: 'your mnemonic ...',
  passphrase: '',
  agentIndex: 0,
  label: 'grocery-shopper',
});

// 3. Create a signed identity certificate
const cert = await createAgentCertificate({
  agentId: agent.agentId,
  agentPublicKey: agent.publicKey,
  ownerXidentity: 'base64-owner-xidentity',
  ownerMnemonic: 'your mnemonic ...',
  ownerPassphrase: '',
  capabilities: ['payment', 'negotiation'],
  policyHash: '0x...',
  maxAutonomousAmount: '50.00',
  supportedChains: ['solana', 'ethereum'],
});

// 4. Set up policy engine with spending rules
const policyEngine = new PolicyEngine();
policyEngine.addPolicy({
  id: 'grocery-policy',
  agentId: agent.agentId,
  ownerXidentity: 'base64-owner-xidentity',
  scope: 'auto_payment',
  conditions: {
    maxAmountPerTx: '20.00',
    maxAmountPerDay: '100.00',
    allowListChains: ['solana'],
  },
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
});

// 5. Check if an action is auto-approved
const policyId = await policyEngine.checkAutoApprove({
  id: 'req-1',
  agentId: agent.agentId,
  action: { type: 'transfer', to: '0x...', amount: '15.00', chain: 'solana' },
  requestedAt: new Date().toISOString(),
});

if (policyId) {
  // Auto-approved — proceed with execution
} else {
  // Route to human review
}
```

## Sub-path Imports

Each module is available as a separate entry point for tree-shaking:

```typescript
import { PolicyEngine } from '@yallet/aesp/policy';
import { AddressPoolManager } from '@yallet/aesp/privacy';
import { getAllMCPTools } from '@yallet/aesp/mcp';
import { AgentCardBuilder } from '@yallet/aesp/a2a';
import type { AgentPolicy, EIP712Commitment } from '@yallet/aesp/types';
```

## MCP Tools

AESP exposes 8 MCP tools for integration with any MCP-compatible AI framework:

| Tool | Description |
|---|---|
| `yault_check_balance` | Check agent account balance |
| `yault_deposit` | Deposit to ERC-4626 vault |
| `yault_redeem` | Redeem vault shares |
| `yault_create_allowance` | Create one-time or recurring allowance |
| `yault_cancel_allowance` | Cancel an existing allowance |
| `yault_file_dispute` | File on-chain dispute with evidence |
| `yault_check_budget` | Check remaining daily/weekly/monthly budget |
| `yault_list_agents` | List sub-agents with status and budget |

## Protocol Flow

A typical agent-to-agent transaction follows this path:

```
Agent A starts negotiation  ──→  Agent B receives offer
                                        │
        ┌───────────────────────────────┘
        ↓
Counter-offers exchanged (E2E encrypted)
        │
        ↓
Both accept  ──→  Agreement hash computed
        │
        ↓
EIP-712 commitment created & dual-signed
        │
        ↓
PolicyEngine.checkAutoApprove()
        │
   ┌────┴────┐
   ↓         ↓
Approved   Violation → ReviewManager → Human approves on mobile
   │                                        │
   └────────────────┬───────────────────────┘
                    ↓
        Execution recorded → Audit trail
        (Privacy: routed through ephemeral addresses)
```

## Privacy Architecture

AESP implements context-isolated privacy to prevent on-chain correlation:

- **Ephemeral addresses** — HKDF-derived from the master wallet per transaction context (agent + chain + counterparty + direction). Each address is used once.
- **Consolidation scheduler** — Batches ephemeral address funds back to the vault with randomized timing jitter (±30%) and Fisher-Yates address shuffle to resist chain analysis.
- **Audit context tags** — Every ephemeral transaction is tagged with encrypted metadata (agent, policy, commitment) and archived to Arweave. Batching strategies (immediate / time window / count threshold) amortize archiving costs.

## WASM Crypto Backend

AESP uses [acegf-wallet](https://github.com/AcegfWallet) (Rust → WASM) for cryptographic operations:

- Ed25519 signing and verification (Solana-compatible)
- secp256k1 signing (EVM-compatible)
- EIP-712 typed data signing
- HKDF context-isolated key derivation (REV32)
- SHA-256 hashing (with Web Crypto API fallback)

## Supported Chains

Solana, Ethereum, Polygon, Base, Arbitrum, Bitcoin.

## Testing

```bash
npm test            # Run all tests (vitest)
npm run test:watch  # Watch mode
```

208 tests across 9 test suites covering all modules.

## Building

```bash
npm run build:wasm  # Build WASM from acegf-wallet Rust source
npm run build:ts    # Compile TypeScript
npm run build       # Full build (WASM + TS)
```

## Project Structure

```
src/
├── types/          # Shared type definitions
├── crypto/         # WASM bridge, signing, encryption, hashing
├── identity/       # Agent derivation, certificates, hierarchy
├── policy/         # Policy engine, budget tracker
├── negotiation/    # FSM, E2E encrypted negotiation protocol
├── commitment/     # EIP-712 commitment builder
├── review/         # Human-in-the-loop approval queue
├── mcp/            # MCP tool definitions and server
├── a2a/            # A2A agent card builder
└── privacy/        # Ephemeral addresses, context tags, consolidation
docs/               # Architecture docs, scenarios, risk analysis
wasm/               # Pre-built WASM binaries (acegf)
tests/              # Vitest test suites
```

## Documentation

Detailed architecture documents are available in the [`docs/`](./docs/) directory, covering:

- Agentic economy vision and agent design patterns
- Agent hierarchy and mobile approval flows
- Yault settlement layer architecture
- Privacy features and context isolation
- Risk analysis and mitigation strategies
- Platform-level regulatory and liquidity risk recommendations

## License

All rights reserved.
