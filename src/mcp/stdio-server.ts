#!/usr/bin/env node
/**
 * AESP — MCP Stdio Server
 *
 * Standalone MCP server process that exposes Yault agent capabilities
 * over the standard stdio transport. Compatible with Claude Desktop,
 * Claude Code, and any MCP-compliant client.
 *
 * Usage:
 *   npx @yault/aesp               # via npx
 *   yault-mcp                      # if installed globally
 *
 * Configuration (environment variables):
 *   YAULT_API_URL  — Yault backend base URL  (default: https://api.yault.xyz)
 *   YAULT_API_KEY  — API key for authentication (sk-yault-*)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AESP_VERSION } from '../index.js';

// ─── Yault API Client (thin HTTP wrapper) ───────────────────────────────────

const YAULT_API_URL = process.env.YAULT_API_URL ?? 'https://api.yault.xyz';
const YAULT_API_KEY = process.env.YAULT_API_KEY ?? '';

/**
 * POST helper — used for deposit, redeem, transfer, allowance creation.
 */
async function yaultPost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${YAULT_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(YAULT_API_KEY ? { Authorization: `Bearer ${YAULT_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Yault API error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * GET helper — used for balance, authorization, budget queries.
 */
async function yaultGet(
  endpoint: string,
): Promise<unknown> {
  const res = await fetch(`${YAULT_API_URL}${endpoint}`, {
    method: 'GET',
    headers: {
      ...(YAULT_API_KEY ? { Authorization: `Bearer ${YAULT_API_KEY}` } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Yault API error ${res.status}: ${text}`);
  }

  return res.json();
}

// ─── Server ─────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'yault-aesp', version: AESP_VERSION },
  { capabilities: { tools: {} } },
);

// ─── Tools ──────────────────────────────────────────────────────────────────
// Route mapping: AESP tools → Yault backend /api/* endpoints
//
// Balance:           GET  /api/vault/balance/:address
// Deposit:           POST /api/vault/deposit     { address, amount }
// Redeem:            POST /api/vault/redeem      { address, shares }
// Transfer:          POST /api/vault/transfer    { from_address, to_address, amount, currency? }
// Authorization:     GET  /api/vault/agent-authorization
// Balances:          GET  /api/vault/balances/:address

server.tool(
  'yault_check_balance',
  'Check the vault balance for a wallet address',
  {
    address: z.string().describe('Wallet address (hex, with or without 0x prefix)'),
  },
  async ({ address }) => {
    const data = await yaultGet(`/api/vault/balance/${encodeURIComponent(address)}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'yault_deposit',
  'Deposit assets into a Yault ERC-4626 vault for yield generation',
  {
    address: z.string().describe('Agent wallet address (must match the API key owner)'),
    amount: z.string().describe('Amount to deposit in underlying asset units (e.g., "100.5" USDC)'),
  },
  async ({ address, amount }) => {
    const data = await yaultPost('/api/vault/deposit', { address, amount });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'yault_redeem',
  'Redeem shares from a Yault vault to get underlying assets back',
  {
    address: z.string().describe('Agent wallet address (must match the API key owner)'),
    shares: z.string().describe('Number of vault shares to redeem (use "max" to redeem all)'),
  },
  async ({ address, shares }) => {
    const data = await yaultPost('/api/vault/redeem', { address, shares });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'yault_transfer',
  'Transfer vault shares from one account to another (must be parent→sub-account)',
  {
    from_address: z.string().describe('Sender wallet address (must match API key owner)'),
    to_address: z.string().describe('Recipient wallet address (must be an active sub-account)'),
    amount: z.string().describe('Amount to transfer in underlying asset units'),
    currency: z.string().optional().describe('Currency (default: "USDC")'),
  },
  async ({ from_address, to_address, amount, currency }) => {
    const data = await yaultPost('/api/vault/transfer', { from_address, to_address, amount, currency });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'yault_check_authorization',
  'Check agent authorization status: operator address, on-chain allowances, and chain config',
  {},
  async () => {
    const data = await yaultGet('/api/vault/agent-authorization');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'yault_get_balances',
  'Get comprehensive balance breakdown including vault shares, underlying assets, and yield',
  {
    address: z.string().describe('Wallet address'),
  },
  async ({ address }) => {
    const data = await yaultGet(`/api/vault/balances/${encodeURIComponent(address)}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'yault_send_payment',
  'Send tokens from a wallet to an arbitrary recipient address (direct ERC-20 transfer)',
  {
    from_address: z.string().describe('Sender wallet address (must match API key owner)'),
    to_address: z.string().describe('Recipient wallet address'),
    amount: z.string().describe('Amount to send in underlying asset units (e.g., "0.1" WETH)'),
    memo: z.string().optional().describe('Optional memo/note for the payment'),
  },
  async ({ from_address, to_address, amount, memo }) => {
    const data = await yaultPost('/api/vault/send', { from_address, to_address, amount, memo });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ─── Start ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`yault-mcp fatal: ${err}\n`);
  process.exit(1);
});
