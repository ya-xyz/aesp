/**
 * AESP — MCP Module Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MCP_TOOLS,
  getAllMCPTools,
  getMCPTool,
  validateToolArgs,
} from '../src/mcp/tools.js';
import {
  MCPServer,
  createToolResult,
  createTextResult,
  createErrorResult,
} from '../src/mcp/server.js';

describe('MCP Module', () => {
  // ─── Tool Definitions ───────────────────────────────────────────────────

  describe('Tool Definitions', () => {
    it('should have 8 tool definitions', () => {
      const tools = getAllMCPTools();
      expect(tools.length).toBe(8);
    });

    it('should have correct tool names', () => {
      const names = getAllMCPTools().map((t) => t.name);
      expect(names).toContain('yault_check_balance');
      expect(names).toContain('yault_deposit');
      expect(names).toContain('yault_redeem');
      expect(names).toContain('yault_create_allowance');
      expect(names).toContain('yault_cancel_allowance');
      expect(names).toContain('yault_file_dispute');
      expect(names).toContain('yault_check_budget');
      expect(names).toContain('yault_list_agents');
    });

    it('should get tool by name', () => {
      const tool = getMCPTool('yault_check_balance');
      expect(tool).toBeTruthy();
      expect(tool?.name).toBe('yault_check_balance');
      expect(tool?.inputSchema.type).toBe('object');
    });

    it('should have required fields in schemas', () => {
      const tool = getMCPTool('yault_create_allowance');
      expect(tool?.inputSchema.required).toContain('from_wallet_id');
      expect(tool?.inputSchema.required).toContain('to_wallet_id');
      expect(tool?.inputSchema.required).toContain('amount');
      expect(tool?.inputSchema.required).toContain('type');
    });

    it('should have enum values where applicable', () => {
      const tool = getMCPTool('yault_create_allowance');
      expect(tool?.inputSchema.properties.type.enum).toEqual(['one_time', 'recurring']);
      expect(tool?.inputSchema.properties.frequency.enum).toEqual(['daily', 'weekly', 'monthly']);
    });
  });

  // ─── Validation ─────────────────────────────────────────────────────────

  describe('Tool Argument Validation', () => {
    it('should accept valid arguments', () => {
      const error = validateToolArgs('yault_check_balance', {
        address: '0x123',
        chain: 'solana',
      });
      expect(error).toBeNull();
    });

    it('should reject missing required fields', () => {
      const error = validateToolArgs('yault_check_balance', {
        address: '0x123',
      });
      expect(error).toContain('Missing required parameter: chain');
    });

    it('should reject invalid enum values', () => {
      const error = validateToolArgs('yault_create_allowance', {
        from_wallet_id: 'w1',
        to_wallet_id: 'w2',
        amount: '100',
        type: 'invalid_type',
      });
      expect(error).toContain('Invalid value for type');
    });

    it('should accept valid enum values', () => {
      const error = validateToolArgs('yault_create_allowance', {
        from_wallet_id: 'w1',
        to_wallet_id: 'w2',
        amount: '100',
        type: 'recurring',
        frequency: 'monthly',
      });
      expect(error).toBeNull();
    });

    it('should reject unknown tool names', () => {
      const error = validateToolArgs('nonexistent_tool' as any, {});
      expect(error).toContain('Unknown tool');
    });
  });

  // ─── MCP Server ─────────────────────────────────────────────────────────

  describe('MCPServer', () => {
    let server: MCPServer;

    beforeEach(() => {
      server = new MCPServer({ name: 'test-server', version: '0.1.0' });
    });

    it('should register handlers', () => {
      server.registerHandler('yault_check_balance', async (args) => {
        return createToolResult({ balance: '1000', chain: args.chain });
      });

      expect(server.getRegisteredHandlers()).toContain('yault_check_balance');
    });

    it('should handle tool calls', async () => {
      server.registerHandler('yault_check_balance', async (args) => {
        return createToolResult({ balance: '1000', chain: args.chain });
      });

      const result = await server.handleToolCall({
        name: 'yault_check_balance',
        arguments: { address: '0x123', chain: 'solana' },
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('json');
      expect(result.content[0].json).toEqual({ balance: '1000', chain: 'solana' });
    });

    it('should return error for unregistered handler', async () => {
      const result = await server.handleToolCall({
        name: 'yault_check_balance',
        arguments: { address: '0x123', chain: 'solana' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No handler registered');
    });

    it('should return validation error for invalid args', async () => {
      server.registerHandler('yault_check_balance', async () => {
        return createToolResult({});
      });

      const result = await server.handleToolCall({
        name: 'yault_check_balance',
        arguments: { address: '0x123' }, // missing chain
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });

    it('should handle handler errors gracefully', async () => {
      server.registerHandler('yault_check_balance', async () => {
        throw new Error('Network timeout');
      });

      const result = await server.handleToolCall({
        name: 'yault_check_balance',
        arguments: { address: '0x123', chain: 'solana' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network timeout');
    });

    it('should generate server config', () => {
      const config = server.getServerConfig();

      expect(config.name).toBe('test-server');
      expect(config.version).toBe('0.1.0');
      expect(config.transport).toBe('stdio');
      expect(config.tools.length).toBe(8);
      expect(config.resources?.length).toBeGreaterThan(0);
    });
  });

  // ─── Result Helpers ─────────────────────────────────────────────────────

  describe('Result Helpers', () => {
    it('should create JSON result', () => {
      const result = createToolResult({ key: 'value' });
      expect(result.content[0].type).toBe('json');
      expect(result.content[0].json).toEqual({ key: 'value' });
    });

    it('should create text result', () => {
      const result = createTextResult('Operation completed');
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Operation completed');
    });

    it('should create error result', () => {
      const result = createErrorResult('Something failed');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Something failed');
    });
  });
});
