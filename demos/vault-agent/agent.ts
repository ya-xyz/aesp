#!/usr/bin/env npx tsx
/**
 * AESP Vault Agent Demo
 *
 * An interactive AI agent that manages a Yault testnet vault.
 * It connects to the AESP MCP server and can:
 *   - Check vault balances
 *   - Deposit assets into ERC-4626 vaults
 *   - Redeem vault shares
 *   - Transfer between parent and sub-accounts
 *   - Check agent authorization status
 *
 * Usage:
 *   export ANTHROPIC_API_KEY="sk-ant-..."
 *   export YAULT_API_KEY="sk-yault-..."
 *   npx tsx agent.ts
 *
 * Or with a one-shot command:
 *   npx tsx agent.ts "check my balance for 0x1234..."
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import * as readline from 'readline';

// ─── Config ──────────────────────────────────────────────────────────────────

const YAULT_API_KEY = process.env.YAULT_API_KEY;
const YAULT_API_URL = process.env.YAULT_API_URL ?? 'https://api.yault.xyz';

if (!YAULT_API_KEY) {
  console.error('Error: YAULT_API_KEY is required. Get one at https://yault.xyz');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY is required. Get one at https://console.anthropic.com');
  process.exit(1);
}

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Vault Manager agent powered by AESP (Agent Economic Sovereignty Protocol).

You help the user manage their Yault vault on testnet. You have access to 6 MCP tools for vault operations.

## Your capabilities
- **Check balances**: Query vault balance or detailed multi-asset breakdown for any wallet address
- **Deposit**: Deposit test tokens into an ERC-4626 vault for yield generation
- **Redeem**: Redeem vault shares back to underlying test tokens
- **Transfer**: Transfer vault allocations between parent and sub-accounts
- **Check authorization**: View the agent's on-chain operator status and allowances

## Important context
- This is a TESTNET environment — all tokens are test tokens, no real money involved
- The Yault API is at ${YAULT_API_URL} (staging)
- When the user provides a wallet address, use it directly
- Always confirm the result of operations clearly
- If an operation fails, explain the error and suggest what to do

## Interaction style
- Be concise and direct
- Show relevant numbers (balances, amounts, shares)
- When depositing or redeeming, summarize what happened (amount in, shares out, etc.)
`;

// ─── Agent Runner ────────────────────────────────────────────────────────────

async function runAgent(userMessage: string): Promise<void> {
  console.log('\n🤖 Agent thinking...\n');

  for await (const message of query({
    prompt: userMessage,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 10,

      // Connect to the AESP MCP server (local build)
      mcpServers: {
        yault: {
          command: 'node',
          args: [`${import.meta.dirname}/../../dist/mcp/stdio-server.js`],
          env: {
            ...process.env as Record<string, string>,
            YAULT_API_KEY: YAULT_API_KEY!,
            YAULT_API_URL: YAULT_API_URL,
          },
        },
      },

      // Allow all yault MCP tools
      allowedTools: ['mcp__yault__*'],
    },
  })) {
    // ── MCP server init ──
    if (message.type === 'system' && message.subtype === 'init') {
      const servers = (message as any).mcp_servers;
      if (servers) {
        for (const [name, info] of Object.entries(servers) as [string, any][]) {
          const status = info.status === 'connected' ? '✅' : '❌';
          console.log(`  MCP ${status} ${name} (${info.tools?.length ?? 0} tools)`);
        }
      }
    }

    // ── Tool calls ──
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'tool_use' && block.name.startsWith('mcp__yault__')) {
          const toolName = block.name.replace('mcp__yault__', '');
          console.log(`  🔧 ${toolName}(${JSON.stringify(block.input)})`);
        }
      }
    }

    // ── Tool results ──
    if (message.type === 'tool') {
      // Tool results are handled internally by the SDK
    }

    // ── Final result ──
    if (message.type === 'result') {
      if (message.subtype === 'success') {
        console.log(message.result);
        console.log(`\n  💰 Cost: $${(message as any).total_cost_usd?.toFixed(4) ?? '?'}`);
      } else {
        console.error(`\n❌ Agent error: ${message.subtype}`);
        if ((message as any).error) {
          console.error(`   ${(message as any).error}`);
        }
      }
    }
  }
}

// ─── Interactive REPL ────────────────────────────────────────────────────────

async function repl(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  AESP Vault Agent — Testnet Demo                ║');
  console.log('║  Type a command or question. Ctrl+C to exit.    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('Examples:');
  console.log('  "Check balance for 0xABC..."');
  console.log('  "Deposit 100 tokens from 0xABC..."');
  console.log('  "Show my authorization status"');
  console.log('  "Transfer 50 from 0xABC to 0xDEF"');
  console.log('  "Redeem all shares for 0xABC..."');
  console.log('');

  const ask = (): void => {
    rl.question('You: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        ask();
        return;
      }

      try {
        await runAgent(trimmed);
      } catch (err: any) {
        console.error(`\n❌ Error: ${err.message}`);
      }

      console.log('');
      ask();
    });
  };

  ask();
}

// ─── Main ────────────────────────────────────────────────────────────────────

const oneShotMessage = process.argv.slice(2).join(' ');

if (oneShotMessage) {
  // One-shot mode: run a single command and exit
  runAgent(oneShotMessage).catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
} else {
  // Interactive mode: REPL
  repl();
}
