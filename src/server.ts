import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SERVER_INSTRUCTIONS } from './tools/descriptions.js';

export function createServer(): McpServer {
	return new McpServer(
		{ name: 'minecraft-dev-mcp', version: '0.1.0' },
		{ instructions: SERVER_INSTRUCTIONS },
	);
}
