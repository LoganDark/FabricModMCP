import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { registerAllTools } from './tools/index.js';
import { parseCli } from './cli/args.js';
import { logger } from './logging/logger.js';
import { projectStore } from './state/project-store.js';
import type { Project } from './project/types.js';
import { initJdtLsSession } from './jdtls/startup.js';
import { cleanupTempDir } from './jdtls/workspace.js';
import { setJavaHome } from './jdtls/client.js';

const args = parseCli(process.argv.slice(2));
logger.setLevel(args.logLevel);
setJavaHome(args.javaHome);

// Crash guard (defense-in-depth). The MCP server is a long-lived stdio process;
// a single unhandled exception or promise rejection — e.g. a stray 'error'
// event from the JDT LS JSON-RPC transport — would otherwise terminate it and
// surface to the MCP host as `MCP error -32000: Connection closed`, destroying
// the in-memory workspace. Logging instead of exiting keeps the session alive;
// the offending tool call still fails locally and returns its own error.
process.on('uncaughtException', (err) => {
	logger.error('Uncaught exception (suppressed to keep server alive)', {
		error: err instanceof Error ? err.stack ?? err.message : String(err),
	});
});
process.on('unhandledRejection', (reason) => {
	logger.error('Unhandled promise rejection (suppressed to keep server alive)', {
		error: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
	});
});

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

async function cleanupAllSessions(): Promise<void> {
	for (const project of projectStore.list()) {
		if (!project.jdtls) continue;
		if (project.jdtls.tempDir) {
			try { await cleanupTempDir(project.jdtls.tempDir); } catch (err) {
				logger.warn('Failed to clean up tempDir', { dir: project.jdtls.tempDir, error: String(err) });
			}
		}
		if (project.jdtls.dataDir) {
			try { await cleanupTempDir(project.jdtls.dataDir); } catch (err) {
				logger.warn('Failed to clean up dataDir', { dir: project.jdtls.dataDir, error: String(err) });
			}
		}
	}
}

process.on('SIGINT', async () => {
	logger.info('Shutting down...');
	await server.close();
	await cleanupAllSessions();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	logger.info('Shutting down (SIGTERM)...');
	await server.close();
	await cleanupAllSessions();
	process.exit(0);
});
