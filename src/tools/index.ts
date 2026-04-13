import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEchoTool } from './echo.js';
import { registerConfigureFiltersTool } from './configure-filters.js';
import { registerRefreshDependenciesTool } from './refresh-dependencies.js';
import { registerReadJarEntryTool } from './read-jar-entry.js';

export function registerAllTools(server: McpServer): void {
	registerEchoTool(server);
	registerConfigureFiltersTool(server);
	registerRefreshDependenciesTool(server);
	registerReadJarEntryTool(server);
}
