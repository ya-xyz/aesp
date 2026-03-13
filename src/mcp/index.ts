/**
 * AESP — MCP Module Exports
 *
 * The standalone MCP stdio server is at ./stdio-server.ts and is started via:
 *   npx @yault/aesp        (bin: yault-mcp)
 *   node dist/mcp/stdio-server.js
 */

export {
  MCP_TOOLS,
  getAllMCPTools,
  getMCPTool,
  validateToolArgs,
} from './tools.js';

export {
  MCPServer,
  createToolResult,
  createTextResult,
  createErrorResult,
  type MCPToolHandler,
} from './server.js';
