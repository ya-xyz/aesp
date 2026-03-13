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
    it('should have 6 tool definitions', () => {
      const tools = getAllMCPTools();
      expect(tools.length).toBe(6);
    });

    it('should have correct tool names', () => {
      const names = getAllMCPTools().map((t) => t.name);
      expect(names).toContain('yault_check_balance');
      expect(names).toContain('yault_deposit');
      expect(names).toContain('yault_redeem');
      expect(names).toContain('yault_transfer');
      expect(names).toContain('yault_check_authorization');
      expect(names).toContain('yault_get_balances');
    });

    it('should not contain removed tool names', () => {
      const names = getAllMCPTools().map((t) => t.name);
      expect(names).not.toContain('yault_create_allowance');
      expect(names).not.toContain('yault_cancel_allowance');
      expect(names).not.toContain('yault_file_dispute');
      expect(names).not.toContain('yault_check_budget');
      expect(names).not.toContain('yault_list_agents');
    });

    it('should get tool by name', () => {
      const tool = getMCPTool('yault_check_balance');
      expect(tool).toBeTruthy();
      expect(tool?.name).toBe('yault_check_balance');
      expect(tool?.inputSchema.type).toBe('object');
    });

    it('should have correct required fields for check_balance', () => {
      const tool = getMCPTool('yault_check_balance');
      expect(tool?.inputSchema.required).toEqual(['address']);
    });

    it('should have correct required fields for deposit', () => {
      const tool = getMCPTool('yault_deposit');
      expect(tool?.inputSchema.required).toEqual(['address', 'amount']);
    });

    it('should have correct required fields for redeem', () => {
      const tool = getMCPTool('yault_redeem');
      expect(tool?.inputSchema.required).toEqual(['address', 'shares']);
    });

    it('should have correct required fields for transfer', () => {
      const tool = getMCPTool('yault_transfer');
      expect(tool?.inputSchema.required).toContain('from_address');
      expect(tool?.inputSchema.required).toContain('to_address');
      expect(tool?.inputSchema.required).toContain('amount');
    });

    it('should have no required fields for check_authorization', () => {
      const tool = getMCPTool('yault_check_authorization');
      expect(tool?.inputSchema.required).toEqual([]);
    });

    it('should have correct required fields for get_balances', () => {
      const tool = getMCPTool('yault_get_balances');
      expect(tool?.inputSchema.required).toEqual(['address']);
    });
  });

  // ─── Validation ─────────────────────────────────────────────────────────

  describe('Tool Argument Validation', () => {
    it('should accept valid check_balance arguments', () => {
      const error = validateToolArgs('yault_check_balance', {
        address: '0x123',
      });
      expect(error).toBeNull();
    });

    it('should accept valid deposit arguments', () => {
      const error = validateToolArgs('yault_deposit', {
        address: '0x123',
        amount: '100.5',
      });
      expect(error).toBeNull();
    });

    it('should accept valid transfer arguments', () => {
      const error = validateToolArgs('yault_transfer', {
        from_address: '0xabc',
        to_address: '0xdef',
        amount: '50',
      });
      expect(error).toBeNull();
    });

    it('should accept transfer with optional currency', () => {
      const error = validateToolArgs('yault_transfer', {
        from_address: '0xabc',
        to_address: '0xdef',
        amount: '50',
        currency: 'USDC',
      });
      expect(error).toBeNull();
    });

    it('should accept check_authorization with no args', () => {
      const error = validateToolArgs('yault_check_authorization', {});
      expect(error).toBeNull();
    });

    it('should accept high-precision amount strings', () => {
      const error = validateToolArgs('yault_deposit', {
        address: '0x123',
        amount: '0.000000000000000001',
      });
      expect(error).toBeNull();
    });

    it('should reject missing required fields', () => {
      const error = validateToolArgs('yault_check_balance', {});
      expect(error).toContain('Missing required parameter: address');
    });

    it('should reject missing amount for deposit', () => {
      const error = validateToolArgs('yault_deposit', {
        address: '0x123',
      });
      expect(error).toContain('Missing required parameter: amount');
    });

    it('should reject overly precise amount values', () => {
      const error = validateToolArgs('yault_deposit', {
        address: '0x123',
        amount: '0.0000000000000000001',
      });
      expect(error).toContain('Invalid amount');
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
        return createToolResult({ balance: '1000' });
      });

      expect(server.getRegisteredHandlers()).toContain('yault_check_balance');
    });

    it('should handle tool calls', async () => {
      server.registerHandler('yault_check_balance', async (args) => {
        return createToolResult({ balance: '1000', address: args.address });
      });

      const result = await server.handleToolCall({
        name: 'yault_check_balance',
        arguments: { address: '0x123' },
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('json');
      expect(result.content[0].json).toEqual({ balance: '1000', address: '0x123' });
    });

    it('should return error for unregistered handler', async () => {
      const result = await server.handleToolCall({
        name: 'yault_check_balance',
        arguments: { address: '0x123' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No handler registered');
    });

    it('should return validation error for invalid args', async () => {
      server.registerHandler('yault_deposit', async () => {
        return createToolResult({});
      });

      const result = await server.handleToolCall({
        name: 'yault_deposit',
        arguments: { address: '0x123' }, // missing amount
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
        arguments: { address: '0x123' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network timeout');
    });

    it('should generate server config', () => {
      const config = server.getServerConfig();

      expect(config.name).toBe('test-server');
      expect(config.version).toBe('0.1.0');
      expect(config.transport).toBe('stdio');
      expect(config.tools.length).toBe(6);
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
