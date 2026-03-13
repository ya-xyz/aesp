# AESP - Agent Economic Sovereignty Protocol

**Defining how AI agents operate economically under human sovereignty.**

[Website](https://yault.xyz) | [npm](https://www.npmjs.com/package/@yault/aesp)

## What Is AESP

AESP is a TypeScript SDK and MCP integration layer for agent payments under explicit human control. It is designed so that agents can execute economic actions while humans retain full economic sovereignty.

Core principles:

- **Policy-gated execution** -- every spend action is bounded by configurable policy rules (per-tx limits, daily/weekly/monthly budgets, address allowlists, time windows).
- **Human override path** -- risky actions are escalated to a review queue instead of being auto-approved.
- **Verifiable commitments** -- execution context can be tied to EIP-712 signed intent, enabling on-chain settlement guarantees.
- **Practical integration** -- MCP tools expose vault operations to AI agent frameworks; subpath exports let you import only what you need.

## Install

```bash
npm install @yault/aesp
```

Requires Node.js >= 18.

## Quick Start

### Add to Claude Desktop

Add the following to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "yault": {
      "command": "npx",
      "args": ["-y", "@yault/aesp"],
      "env": {
        "YAULT_API_KEY": "sk-yault-..."
      }
    }
  }
}
```

### Add to Claude Code

```bash
claude mcp add yault -- npx -y @yault/aesp
```

Then set the environment variable `YAULT_API_KEY` in your shell or `.claude/settings.json`.

### Run standalone

```bash
export YAULT_API_KEY="sk-yault-..."
yault-mcp                  # if installed globally
npx @yault/aesp            # via npx
```

### Get your API key

Go to [yault.xyz](https://yault.xyz) to create an account and obtain your API key (`sk-yault-*`). The key is tied to your vault — each user manages their own key. Agent developers do not need a key unless they are also vault users; it is the end-user who configures their own key in the MCP client.

### Use SDK modules

```typescript
import { PolicyEngine } from '@yault/aesp/policy';
import { getAllMCPTools } from '@yault/aesp/mcp';
import { NegotiationStateMachine } from '@yault/aesp/negotiation';

const engine = new PolicyEngine(storageAdapter);
await engine.load();

const tools = getAllMCPTools(); // 6 MCP tool definitions
```

## Modules

AESP is organized into subpath exports so you can import only what you need:

| Subpath | Description |
|---------|-------------|
| `@yault/aesp` | Unified re-export of all modules |
| `@yault/aesp/types` | Shared type definitions (`AgentExecutionRequest`, `TransferPayload`, `ChainId`, etc.) |
| `@yault/aesp/policy` | Policy engine with 8-check evaluation, budget tracking, and policy change classification |
| `@yault/aesp/identity` | Agent identity derivation, certificate creation, and hierarchy management |
| `@yault/aesp/negotiation` | Offer/counter-offer state machine with session management |
| `@yault/aesp/commitment` | EIP-712 structured commitment builder for dual-signed agreements |
| `@yault/aesp/review` | Human-in-the-loop review queue with freeze/unfreeze controls |
| `@yault/aesp/mcp` | MCP tool definitions, argument validation, and server router |
| `@yault/aesp/a2a` | Agent-card builder for cross-agent discovery (A2A protocol) |
| `@yault/aesp/crypto` | Cryptographic helpers: signing, encryption, hashing, ZK proof bridge |
| `@yault/aesp/privacy` | Context tagging, ephemeral address pools, and consolidation scheduling |

## MCP Tools

The stdio server exposes 6 backend-connected tools:

| Tool | Method + Endpoint | Purpose |
|------|-------------------|---------|
| `yault_check_balance` | `GET /api/vault/balance/:address` | Read a wallet vault balance |
| `yault_deposit` | `POST /api/vault/deposit` | Deposit underlying into vault |
| `yault_redeem` | `POST /api/vault/redeem` | Redeem vault shares |
| `yault_transfer` | `POST /api/vault/transfer` | Transfer vault allocation (parent to sub-account) |
| `yault_check_authorization` | `GET /api/vault/agent-authorization` | Read operator/allowance status |
| `yault_get_balances` | `GET /api/vault/balances/:address` | Read multi-balance breakdown |

### Backend Requirements

The MCP server is a thin API client. It expects a Yault backend providing:

- `GET /api/vault/balance/:address`
- `GET /api/vault/balances/:address`
- `GET /api/vault/agent-authorization`
- `POST /api/vault/deposit` -- `{ address, amount }`
- `POST /api/vault/redeem` -- `{ address, shares }`
- `POST /api/vault/transfer` -- `{ from_address, to_address, amount, currency? }`

Authentication: `Authorization: Bearer sk-yault-*` via `YAULT_API_KEY` env variable.

## Security Model

AESP is built around "bounded autonomy":

- Agent API keys should be policy-bound before spend execution.
- Spending controls should include per-tx and rolling limits (daily/weekly/monthly).
- Destination constraints should be allowlist-driven where applicable.
- Sensitive operations should stay outside broad agent key scopes.
- Human escalation remains the fallback for policy violations.

For vulnerability reporting, see [SECURITY.md](./SECURITY.md).

## Related Packages

| Package | Description |
|---------|-------------|
| [`@yault/elizaos-plugin-aesp`](https://github.com/ya-xyz/elizaos-plugin-aesp) | ElizaOS plugin wrapping AESP for agent frameworks |

## Development

Run tests:

```bash
npm test
```

Build TypeScript:

```bash
npm run build:ts
```

Build with WASM (requires [acegf-wallet](https://github.com/ya-xyz/acegf-wallet) as a sibling repo, or set `ACEGF_ROOT`):

```bash
npm run build:wasm
npm run build:ts
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development guide.

## License

This project is licensed under the **Apache License 2.0**. See [LICENSE](./LICENSE) for the full text.
