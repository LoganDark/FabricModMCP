import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEchoTool } from './echo.js';
import { registerConfigureFiltersTool } from './configure-filters.js';
import { registerRefreshDependenciesTool } from './refresh-dependencies.js';
import { registerReadJarEntryTool } from './read-jar-entry.js';
import { registerLoadProjectTool } from './load-project.js';
import { registerUnloadProjectTool } from './unload-project.js';
import { registerListProjectsTool } from './list-projects.js';
import { registerSetDefaultProjectTool } from './set-default-project.js';
import { registerGetProjectMetadataTool } from './get-project-metadata.js';
import { registerListPackagesTool } from './list-packages.js';
import { registerListClassesTool } from './list-classes.js';

export function registerAllTools(server: McpServer): void {
	registerEchoTool(server);
	registerConfigureFiltersTool(server);
	registerRefreshDependenciesTool(server);
	registerReadJarEntryTool(server);
	registerLoadProjectTool(server);
	registerUnloadProjectTool(server);
	registerListProjectsTool(server);
	registerSetDefaultProjectTool(server);
	registerGetProjectMetadataTool(server);
	registerListPackagesTool(server);
	registerListClassesTool(server);
}
