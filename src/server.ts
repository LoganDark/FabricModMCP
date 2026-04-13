import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function createServer(): McpServer {
	return new McpServer(
		{ name: 'minecraft-dev-mcp', version: '0.1.0' },
		{ instructions: 'Minecraft mod development tools for browsing and navigating decompiled source code.' },
	);
}
