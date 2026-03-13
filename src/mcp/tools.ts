/**
 * AESP — MCP Tool Definitions
 *
 * Defines the 6 MCP tools that expose Yault agent capabilities
 * to external AI agent frameworks (Claude, LangChain, etc.).
 */

import type { MCPToolDefinition, MCPToolName } from '../types/mcp.js';

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const MCP_TOOLS: Record<MCPToolName, MCPToolDefinition> = {
  yault_check_balance: {
    name: 'yault_check_balance',
    description: 'Check the vault balance for a wallet address',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Wallet address (hex, with or without 0x prefix)',
        },
      },
      required: ['address'],
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
          description: 'Agent wallet address (must match the API key owner)',
        },
        amount: {
          type: 'string',
          description: 'Amount to deposit in underlying asset units (e.g., "100.5" USDC)',
        },
      },
      required: ['address', 'amount'],
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
          description: 'Agent wallet address (must match the API key owner)',
        },
        shares: {
          type: 'string',
          description: 'Number of vault shares to redeem (use "max" to redeem all)',
        },
      },
      required: ['address', 'shares'],
    },
  },

  yault_transfer: {
    name: 'yault_transfer',
    description: 'Transfer vault shares from one account to another (must be parent→sub-account)',
    inputSchema: {
      type: 'object',
      properties: {
        from_address: {
          type: 'string',
          description: 'Sender wallet address (must match API key owner)',
        },
        to_address: {
          type: 'string',
          description: 'Recipient wallet address (must be an active sub-account)',
        },
        amount: {
          type: 'string',
          description: 'Amount to transfer in underlying asset units',
        },
        currency: {
          type: 'string',
          description: 'Currency (default: "USDC")',
        },
      },
      required: ['from_address', 'to_address', 'amount'],
    },
  },

  yault_check_authorization: {
    name: 'yault_check_authorization',
    description: 'Check agent authorization status: operator address, on-chain allowances, and chain config',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  yault_get_balances: {
    name: 'yault_get_balances',
    description: 'Get comprehensive balance breakdown including vault shares, underlying assets, and yield',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Wallet address',
        },
      },
      required: ['address'],
    },
  },

  yault_send_payment: {
    name: 'yault_send_payment',
    description: 'Send tokens from a wallet to an arbitrary recipient address (direct ERC-20 transfer)',
    inputSchema: {
      type: 'object',
      properties: {
        from_address: {
          type: 'string',
          description: 'Sender wallet address (must match API key owner)',
        },
        to_address: {
          type: 'string',
          description: 'Recipient wallet address',
        },
        amount: {
          type: 'string',
          description: 'Amount to send in underlying asset units (e.g., "0.1" WETH)',
        },
        memo: {
          type: 'string',
          description: 'Optional memo/note for the payment',
        },
      },
      required: ['from_address', 'to_address', 'amount'],
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
const MAX_DECIMAL_PLACES = 18;
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

function parseNonNegativeAmount(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
      return false;
    }
    return true;
  }

  if (typeof value === 'bigint') {
    return value >= 0n;
  }

  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const m = DECIMAL_AMOUNT_PATTERN.exec(trimmed);
  if (!m) return false;
  const fraction = m[1];
  return !fraction || fraction.length <= MAX_DECIMAL_PLACES;
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
    if (!parseNonNegativeAmount(v)) {
      return `Invalid ${key}: must be a non-negative number`;
    }
  }

  // Validate string length for free-text fields
  for (const key of ['currency']) {
    if (key in args && args[key] != null) {
      if (!validateStringLength(args[key], MAX_STRING_LENGTH)) {
        return `${key} must be at most ${MAX_STRING_LENGTH} characters`;
      }
    }
  }

  return null;
}
