/**
 * AESP — MCP Types
 *
 * Model Context Protocol tool definitions for Yault agent capabilities.
 */

// ─── MCP Tool Schema ─────────────────────────────────────────────────────────

export interface MCPToolProperty {
  type: string;
  description: string;
  enum?: string[];
}

export interface MCPToolInputSchema {
  type: 'object';
  properties: Record<string, MCPToolProperty>;
  required: string[];
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
}

// ─── MCP Tool Names ──────────────────────────────────────────────────────────

export type MCPToolName =
  | 'yault_check_balance'
  | 'yault_deposit'
  | 'yault_redeem'
  | 'yault_transfer'
  | 'yault_check_authorization'
  | 'yault_get_balances'
  | 'yault_send_payment';

// ─── MCP Tool Call / Result ──────────────────────────────────────────────────

export interface MCPToolCall {
  name: MCPToolName;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'json';
    text?: string;
    json?: unknown;
  }>;
  isError?: boolean;
}

// ─── MCP Resource ────────────────────────────────────────────────────────────

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// ─── MCP Server Config ───────────────────────────────────────────────────────

export type MCPTransport = 'stdio' | 'sse';

export interface MCPServerConfig {
  name: string;
  version: string;
  transport: MCPTransport;
  tools: MCPToolDefinition[];
  resources?: MCPResource[];
}
