/**
 * AESP — MCP Tool Definitions
 *
 * Defines the 8 MCP tools that expose Yault agent capabilities
 * to external AI agent frameworks (Claude, LangChain, etc.).
 */

import type { MCPToolDefinition, MCPToolName } from '../types/mcp.js';

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const MCP_TOOLS: Record<MCPToolName, MCPToolDefinition> = {
  yault_check_balance: {
    name: 'yault_check_balance',
    description: 'Check the balance of an agent account on a specific chain',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Wallet address or agent account ID',
        },
        chain: {
          type: 'string',
          description: 'Blockchain to check (solana, ethereum, polygon, base, arbitrum)',
        },
        token: {
          type: 'string',
          description: 'Token to check balance for (native or contract address). Defaults to native.',
        },
      },
      required: ['address', 'chain'],
    },
  },

  yault_deposit: {
    name: 'yault_deposit',
    description: 'Deposit assets into a Yault ERC-4626 vault for yield generation',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Agent wallet address',
        },
        amount: {
          type: 'string',
          description: 'Amount to deposit in underlying asset units (e.g., USDC amount)',
        },
        chain: {
          type: 'string',
          description: 'Target chain for deposit',
        },
        vault_id: {
          type: 'string',
          description: 'Specific vault ID to deposit into. If omitted, uses default agent vault.',
        },
      },
      required: ['address', 'amount', 'chain'],
    },
  },

  yault_redeem: {
    name: 'yault_redeem',
    description: 'Redeem shares from a Yault vault to get underlying assets back',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Agent wallet address',
        },
        shares: {
          type: 'string',
          description: 'Number of vault shares to redeem',
        },
        chain: {
          type: 'string',
          description: 'Chain to redeem on',
        },
        vault_id: {
          type: 'string',
          description: 'Vault ID to redeem from',
        },
      },
      required: ['address', 'shares', 'chain'],
    },
  },

  yault_create_allowance: {
    name: 'yault_create_allowance',
    description: 'Create a one-time or recurring payment allowance from one agent account to another',
    inputSchema: {
      type: 'object',
      properties: {
        from_wallet_id: {
          type: 'string',
          description: "Sender agent's Yault account ID",
        },
        to_wallet_id: {
          type: 'string',
          description: "Recipient's Yault account ID",
        },
        amount: {
          type: 'string',
          description: 'Amount in underlying asset (e.g., USDC)',
        },
        type: {
          type: 'string',
          description: 'Allowance type: one_time or recurring',
          enum: ['one_time', 'recurring'],
        },
        frequency: {
          type: 'string',
          description: 'Frequency for recurring allowances',
          enum: ['daily', 'weekly', 'monthly'],
        },
        memo: {
          type: 'string',
          description: 'Human-readable description of the payment',
        },
      },
      required: ['from_wallet_id', 'to_wallet_id', 'amount', 'type'],
    },
  },

  yault_cancel_allowance: {
    name: 'yault_cancel_allowance',
    description: 'Cancel an existing payment allowance',
    inputSchema: {
      type: 'object',
      properties: {
        allowance_id: {
          type: 'string',
          description: 'The allowance ID to cancel',
        },
      },
      required: ['allowance_id'],
    },
  },

  yault_file_dispute: {
    name: 'yault_file_dispute',
    description: 'File a dispute through the Yault authority judgment system. Triggers the on-chain arbitration flow.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_id: {
          type: 'string',
          description: 'The wallet ID filing the dispute',
        },
        recipient_index: {
          type: 'string',
          description: 'Index of the recipient in the dispute',
        },
        reason_code: {
          type: 'string',
          description: 'Dispute reason code',
          enum: ['unauthorized_tx', 'non_delivery', 'quality_issue', 'overcharge', 'other'],
        },
        evidence_hash: {
          type: 'string',
          description: 'Arweave hash or IPFS CID of evidence documents',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of the dispute',
        },
      },
      required: ['wallet_id', 'recipient_index', 'reason_code', 'evidence_hash'],
    },
  },

  yault_check_budget: {
    name: 'yault_check_budget',
    description: 'Check the remaining budget for an agent (daily, weekly, monthly spending limits)',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent ID to check budget for',
        },
      },
      required: ['agent_id'],
    },
  },

  yault_list_agents: {
    name: 'yault_list_agents',
    description: 'List all agent sub-accounts under a parent wallet with their status, budget, and recent activity',
    inputSchema: {
      type: 'object',
      properties: {
        parent_wallet_id: {
          type: 'string',
          description: 'Parent wallet ID to list agents for',
        },
        status_filter: {
          type: 'string',
          description: 'Filter by agent status',
          enum: ['active', 'frozen', 'expired', 'all'],
        },
      },
      required: ['parent_wallet_id'],
    },
  },
};

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Get all MCP tool definitions as an array (for MCP server registration).
 */
export function getAllMCPTools(): MCPToolDefinition[] {
  return Object.values(MCP_TOOLS);
}

/**
 * Get a specific MCP tool definition by name.
 */
export function getMCPTool(name: MCPToolName): MCPToolDefinition | undefined {
  return MCP_TOOLS[name];
}

const MAX_STRING_LENGTH = 10_000;
const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;

function parseNonNegativeNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return null;
  return n;
}

function validateStringLength(value: unknown, maxLen: number): boolean {
  if (value === undefined || value === null) return true;
  const s = String(value);
  return s.length <= maxLen;
}

/**
 * Validate tool call arguments against the tool's input schema.
 * Returns null if valid, or an error message if invalid.
 */
export function validateToolArgs(
  toolName: MCPToolName,
  args: Record<string, unknown>,
): string | null {
  const tool = MCP_TOOLS[toolName];
  if (!tool) return `Unknown tool: ${toolName}`;

  const schema = tool.inputSchema;
  for (const required of schema.required) {
    if (!(required in args) || args[required] === undefined || args[required] === null) {
      return `Missing required parameter: ${required}`;
    }
  }

  // Validate enum values
  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (prop?.enum && !prop.enum.includes(String(value))) {
      return `Invalid value for ${key}: ${value}. Must be one of: ${prop.enum.join(', ')}`;
    }
  }

  // Type and range checks for known fields
  const amountKeys = ['amount', 'shares', 'value'];
  for (const key of amountKeys) {
    if (!(key in args)) continue;
    const v = args[key];
    if (v === undefined || v === null) continue;
    const n = parseNonNegativeNumber(v);
    if (n === null) {
      return `Invalid ${key}: must be a non-negative number`;
    }
  }

  if ('evidence_hash' in args && args.evidence_hash != null) {
    if (!validateStringLength(args.evidence_hash, MAX_STRING_LENGTH)) {
      return `evidence_hash must be at most ${MAX_STRING_LENGTH} characters`;
    }
  }
  if ('description' in args && args.description != null) {
    if (!validateStringLength(args.description, MAX_STRING_LENGTH)) {
      return `description must be at most ${MAX_STRING_LENGTH} characters`;
    }
  }
  if ('memo' in args && args.memo != null) {
    if (!validateStringLength(args.memo, MAX_STRING_LENGTH)) {
      return `memo must be at most ${MAX_STRING_LENGTH} characters`;
    }
  }

  return null;
}
