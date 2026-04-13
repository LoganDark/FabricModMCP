import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEchoTool } from './echo.js';

export function registerAllTools(server: McpServer): void {
	registerEchoTool(server);
}
