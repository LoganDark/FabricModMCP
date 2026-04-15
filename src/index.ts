import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { registerAllTools } from './tools/index.js';
import { parseCli } from './cli/args.js';
import { logger } from './logging/logger.js';
import { projectStore } from './state/project-store.js';
import type { Project } from './project/types.js';
import { initJdtLsSession } from './jdtls/startup.js';

const args = parseCli(process.argv.slice(2));
logger.setLevel(args.logLevel);

const initialProject: Project = {
	name: 'default',
	children: new Map(),
};
projectStore.set('default', initialProject);
initialProject.jdtls = await initJdtLsSession();
logger.info('Default project created', { jdtlsAvailable: initialProject.jdtls.available });

const server = createServer();
registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

logger.info('Server started', { transport: 'stdio' });

process.on('SIGINT', async () => {
	logger.info('Shutting down...');
	await server.close();
	process.exit(0);
});
