import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';

export function registerSetActiveChildTool(server: McpServer): void {
	server.registerTool(
		'set_active_child',
		{
			title: 'Set Active Child',
			description: TOOL_DESCRIPTIONS.set_active_child,
			inputSchema: {
				project: PARAMS.project,
				child: z.string().describe('Name of the child to set as active'),
			},
		},
		async ({ project, child }) => {
			logger.debug('set_active_child called', { project, child });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			if (!loadedProject.children.has(child)) {
				return returnError(
					'CHILD_NOT_FOUND',
					`Child '${child}' not found in project '${loadedProject.name}'`,
					[child],
					['Check available members with get_project_info'],
				);
			}

			const childEntry = loadedProject.children.get(child)!;
			if (childEntry.kind !== 'fabric-mod') {
				return returnError(
					'INVALID_CHILD_TYPE',
					'Only fabric mods can be set as active child',
					[child],
					['Study jars cannot be set as active child'],
				);
			}

			loadedProject.activeChild = child;

			const envelope = makeSuccess({
				project: loadedProject.name,
				activeChild: child,
			}, {
				provenance: { tool: 'set_active_child', project: loadedProject.name },
			});

			return {
				content: [{ type: 'text' as const, text: `Set active child to '${child}' on project '${loadedProject.name}'` }],
				structuredContent: envelope,
			};
		},
	);
}
