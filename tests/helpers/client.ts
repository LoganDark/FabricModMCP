import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { registerAllTools } from '../../src/tools/index.js';

export interface TestPair {
	client: Client;
	server: McpServer;
	cleanup: () => Promise<void>;
}

export async function createTestPair(): Promise<TestPair> {
	const server = createServer();
	registerAllTools(server);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);

	const client = new Client({ name: 'test-client', version: '0.0.1' });
	await client.connect(clientTransport);

	return {
		client,
		server,
		cleanup: async () => {
			await client.close();
			await server.close();
		},
	};
}
