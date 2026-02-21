/**
 * AESP — MCP Server Configuration
 *
 * Generates MCP server configuration and provides the tool handler router.
 * The actual HTTP/stdio transport is left to the consumer (e.g., Yault backend).
 */

import type { MCPToolCall, MCPToolResult, MCPServerConfig, MCPResource } from '../types/mcp.js';
import type { PolicyEngine } from '../policy/engine.js';
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
