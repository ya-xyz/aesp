# AESP Vault Agent Demo

An interactive AI agent that manages a Yault testnet vault using AESP MCP tools.

## Prerequisites

- Node.js >= 18
- An [Anthropic API key](https://console.anthropic.com)
- A [Yault API key](https://yault.xyz) (testnet)
- Build the parent AESP project first: `cd ../.. && npm run build:ts`

## Setup

```bash
cd demos/vault-agent
npm install
```

## Run

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export YAULT_API_KEY="sk-yault-..."

# Interactive mode (REPL)
npx tsx agent.ts

# One-shot mode
npx tsx agent.ts "check balance for 0x1234..."
```

## What the agent can do

| Command | AESP Tool |
|---------|-----------|
| "Check my balance" | `yault_check_balance` |
| "Show detailed balances" | `yault_get_balances` |
| "Deposit 100 tokens" | `yault_deposit` |
| "Redeem all shares" | `yault_redeem` |
| "Transfer 50 to 0xABC" | `yault_transfer` |
| "Am I authorized?" | `yault_check_authorization` |

## Architecture

```
User input (natural language)
  → Claude (LLM reasoning)
    → AESP MCP tools (vault operations)
      → Yault testnet API (on-chain execution)
        → Result back to user
```

The agent connects to the AESP MCP stdio server as a child process. Claude decides which tools to call based on the user's intent, executes them, and summarizes the results.
