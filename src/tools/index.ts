import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEchoTool } from './echo.js';
import { registerCreateProjectTool } from './create-project.js';
import { registerAddFabricModTool } from './add-fabric-mod.js';
import { registerRemoveProjectTool } from './remove-project.js';
import { registerRemoveProjectMemberTool } from './remove-project-member.js';
import { registerListProjectsTool } from './list-projects.js';
import { registerSetActiveProjectTool } from './set-active-project.js';
import { registerSetActiveChildTool } from './set-active-child.js';
import { registerGetProjectInfoTool } from './get-project-info.js';
import { registerGetMemberInfoTool } from './get-member-info.js';
import { registerRefreshProjectTool } from './refresh-project.js';
import { registerRefreshProjectMembersTool } from './refresh-project-members.js';
import { registerConfigureFiltersTool } from './configure-filters.js';
import { registerReadJarEntryTool } from './read-jar-entry.js';
import { registerListPackagesTool } from './list-packages.js';
import { registerListClassesTool } from './list-classes.js';
import { registerReadSourceTool } from './read-source.js';
import { registerSearchClassesTool } from './search-classes.js';
import { registerLocateInSourceTool } from './locate-in-source.js';
import { registerFindDefinitionTool } from './find-definition.js';
import { registerFindReferencesTool } from './find-references.js';
import { registerListMembersTool } from './list-members.js';
import { registerGetSymbolInfoTool } from './get-symbol-info.js';
import { registerFindImplementationsTool } from './find-implementations.js';
import { registerTypeHierarchyTool } from './type-hierarchy.js';
import { registerSearchSymbolsTool } from './search-symbols.js';
import { registerAddStudyJarTool } from './add-study-jar.js';
import { registerListStudyJarsTool } from './list-study-jars.js';
import { registerConfigureStudyJarTool } from './configure-study-jar.js';
import { registerReadMemberTool } from './read-member.js';

export function registerAllTools(server: McpServer): void {
	// Project lifecycle
	registerEchoTool(server);
	registerCreateProjectTool(server);
	registerAddFabricModTool(server);
	registerRemoveProjectTool(server);
	registerRemoveProjectMemberTool(server);
	registerListProjectsTool(server);
	registerSetActiveProjectTool(server);
	registerSetActiveChildTool(server);
	registerGetProjectInfoTool(server);
	registerGetMemberInfoTool(server);
	registerRefreshProjectTool(server);
	registerRefreshProjectMembersTool(server);
	// Configuration
	registerConfigureFiltersTool(server);
	registerConfigureStudyJarTool(server);
	// Browsing
	registerReadJarEntryTool(server);
	registerListPackagesTool(server);
	registerListClassesTool(server);
	registerReadSourceTool(server);
	registerSearchClassesTool(server);
	registerLocateInSourceTool(server);
	registerListMembersTool(server);
	registerReadMemberTool(server);
	// LSP navigation
	registerFindDefinitionTool(server);
	registerFindReferencesTool(server);
	registerFindImplementationsTool(server);
	registerGetSymbolInfoTool(server);
	registerSearchSymbolsTool(server);
	registerTypeHierarchyTool(server);
	// Study jars
	registerAddStudyJarTool(server);
	registerListStudyJarsTool(server);
}
