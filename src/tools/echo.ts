import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { includeSchema } from '../types/include.js';
import type { IncludeCategory } from '../types/include.js';
import { logger } from '../logging/logger.js';

export function registerEchoTool(server: McpServer): void {
	server.registerTool(
		'echo',
		{
			title: 'Echo',
			description: 'Echo back the input message with optional metadata. Demonstrates the response envelope pattern.',
			inputSchema: {
				message: z.string().describe('The message to echo back'),
				include: includeSchema,
			},
		},
		async ({ message, include }) => {
			logger.debug('echo tool called', { message, include });

			const data = { echoed: message };
			const metadata: Record<string, unknown> = {};

			const categories = (include ?? []) as IncludeCategory[];

			if (categories.includes('stats')) {
				metadata.stats = { messageLength: message.length };
			}

			if (categories.includes('hints')) {
				metadata.hints = {
					tip: 'The echo tool demonstrates the response envelope pattern used by all tools.',
				};
			}

			if (categories.includes('provenance')) {
				metadata.provenance = { tool: 'echo', server: 'minecraft-dev-mcp' };
			}

			const envelope = makeSuccess(data, metadata);
			return {
				content: [{ type: 'text' as const, text: `Echoed: ${message}` }],
				structuredContent: envelope,
			};
		},
	);
}
