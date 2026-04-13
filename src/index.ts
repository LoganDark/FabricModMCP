import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { registerAllTools } from './tools/index.js';
import { parseCli } from './cli/args.js';
import { logger } from './logging/logger.js';
import { loadProject } from './project/loader.js';
import { ProjectStore } from './state/project-store.js';
import { projectStore } from './state/project-store.js';

const args = parseCli(process.argv.slice(2));
logger.setLevel(args.logLevel);

// Load projects from CLI flags (zero is OK — load via tools later)
for (const projectPath of args.projects) {
	try {
		const project = await loadProject(projectPath);
		const name = ProjectStore.generateProjectName(projectPath, projectStore.names());
		project.name = name;
		projectStore.set(name, project);
		logger.info('Project loaded', {
			name: project.name,
			minecraftVersion: project.gradleConfig.minecraftVersion,
			mappingEra: project.gradleConfig.mappingEra,
			sourcesJar: project.sourcesJar.path,
		});
	} catch (error) {
		if (error instanceof Error) {
			logger.error(`Failed to load project from ${projectPath}: ${error.message}`);
			if ('tried' in error && Array.isArray((error as any).tried)) {
				logger.error('Paths tried:', (error as any).tried);
			}
			if ('suggestions' in error && Array.isArray((error as any).suggestions)) {
				for (const suggestion of (error as any).suggestions as string[]) {
					logger.error(`  Suggestion: ${suggestion}`);
				}
			}
		}
		process.exit(1);
	}
}

if (args.projects.length === 0) {
	logger.info('No projects loaded at startup — use load_project tool to load projects');
}

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
