/**
 * AESP — MCP Server Configuration
 *
 * Generates MCP server configuration and provides the tool handler router.
 * The actual HTTP/stdio transport is left to the consumer (e.g., Yault backend).
 */

import type { MCPToolCall, MCPToolResult, MCPServerConfig, MCPResource } from '../types/mcp.js';
import type { PolicyEngine } from '../policy/engine.js';
import type { AgentExecutionRequest } from '../types/index.js';
import { generateUUID } from '../crypto/hashing.js';
import { getAllMCPTools, validateToolArgs } from './tools.js';

// ─── Tool Handler ────────────────────────────────────────────────────────────

export type MCPToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResult>;

// ─── MCP Server ──────────────────────────────────────────────────────────────

export class MCPServer {
  private handlers: Map<string, MCPToolHandler> = new Map();
  private policyEngine: PolicyEngine | null = null;

  constructor(
    private readonly config: {
      name?: string;
      version?: string;
    } = {},
  ) {}

  /**
   * Set the policy engine for checking agent budgets before tool execution.
   */
  setPolicyEngine(engine: PolicyEngine): void {
    this.policyEngine = engine;
  }

  /**
   * Get the policy engine (if set).
   */
  getPolicyEngine(): PolicyEngine | null {
    return this.policyEngine;
  }

  /**
   * Register a handler for a specific tool.
   */
  registerHandler(toolName: string, handler: MCPToolHandler): void {
    this.handlers.set(toolName, handler);
  }

  /**
   * Handle an incoming MCP tool call.
   */
  async handleToolCall(call: MCPToolCall): Promise<MCPToolResult> {
    // 1. Validate arguments
    const validationError = validateToolArgs(call.name, call.arguments);
    if (validationError) {
      return {
        content: [{ type: 'text', text: `Validation error: ${validationError}` }],
        isError: true,
      };
    }

    // 2. Optional policy enforcement for state-changing tools.
    if (this.policyEngine) {
      const request = this.buildPolicyExecutionRequest(call);
      if (request) {
        const policyId = await this.policyEngine.checkAutoApprove(request);
        if (!policyId) {
          return {
            content: [{ type: 'text', text: 'Tool execution blocked by policy engine' }],
            isError: true,
          };
        }
      }
    }

    // 2. Find handler
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return {
        content: [{ type: 'text', text: `No handler registered for tool: ${call.name}` }],
        isError: true,
      };
    }

    // 3. Execute handler
    try {
      return await handler(call.arguments);
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }

  /**
   * Generate the full MCP server configuration.
   */
  getServerConfig(): MCPServerConfig {
    const resources: MCPResource[] = [
      {
        uri: 'yault://agents/summary',
        name: 'Agent Summary',
        description: 'Aggregated view of all agent accounts with budget and status',
        mimeType: 'application/json',
      },
      {
        uri: 'yault://agents/{agentId}/transactions',
        name: 'Agent Transactions',
        description: 'Recent transaction history for a specific agent',
        mimeType: 'application/json',
      },
      {
        uri: 'yault://agents/{agentId}/policy',
        name: 'Agent Policy',
        description: 'Current policy configuration for an agent',
        mimeType: 'application/json',
      },
    ];

    return {
      name: this.config.name ?? 'yault-aesp',
      version: this.config.version ?? '1.0.0',
      transport: 'stdio',
      tools: getAllMCPTools(),
      resources,
    };
  }

  /**
   * Get the list of registered handler names.
   */
  getRegisteredHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Build a minimal policy execution request for policy-sensitive MCP tools.
   * Returns null for tools that are safe to skip policy checks (pure query tools).
   */
  private buildPolicyExecutionRequest(call: MCPToolCall): AgentExecutionRequest | null {
    const args = call.arguments;

    switch (call.name) {
      case 'yault_deposit': {
        const address = this.asString(args.address);
        const chainId = this.asString(args.chain) ?? 'unknown';
        const amount = this.asAmount(args.amount);
        if (!address || amount === null) return null;
        return {
          requestId: generateUUID(),
          vendorId: address,
          action: {
            type: 'transfer',
            payload: {
              chainId,
              token: 'native',
              toAddress: address,
              amount,
            },
          },
        };
      }

      case 'yault_redeem': {
        const address = this.asString(args.address);
        const chainId = this.asString(args.chain) ?? 'unknown';
        const shares = this.asAmount(args.shares);
        if (!address || shares === null) return null;
        return {
          requestId: generateUUID(),
          vendorId: address,
          action: {
            type: 'transfer',
            payload: {
              chainId,
              token: 'native',
              toAddress: address,
              amount: shares,
            },
          },
        };
      }

      case 'yault_create_allowance': {
        const from = this.asString(args.from_wallet_id);
        const to = this.asString(args.to_wallet_id);
        const amount = this.asAmount(args.amount);
        if (!from || !to || amount === null) return null;
        return {
          requestId: generateUUID(),
          vendorId: from,
          action: {
            type: 'transfer',
            payload: {
              chainId: 'unknown',
              token: 'native',
              toAddress: to,
              amount,
            },
          },
        };
      }

      default:
        return null;
    }
  }

  /**
   * Extract a string argument value, or null if missing / non-stringable.
   */
  private asString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) return value;
    return null;
  }

  /**
   * Extract a non-negative numeric argument and normalize to canonical decimal string.
   * Accepts both string and numeric inputs.
   */
  private asAmount(value: unknown): string | null {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
        return null;
      }
      return String(value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) return null;
      if (!/^(?:0|[1-9]\d*)(?:\.(\d+))?$/.test(trimmed)) return null;
      const parts = trimmed.split('.');
      if (parts[1] && parts[1].length > 18) return null;
      return trimmed;
    }

    if (typeof value === 'bigint') {
      if (value < 0) return null;
      return value.toString();
    }

    return null;
  }
}

// ─── Helper: Create success result ───────────────────────────────────────────

export function createToolResult(data: unknown): MCPToolResult {
  return {
    content: [{
      type: 'json',
      json: data,
    }],
  };
}

export function createTextResult(text: string): MCPToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

export function createErrorResult(message: string): MCPToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}
