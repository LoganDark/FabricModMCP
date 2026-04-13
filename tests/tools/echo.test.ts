import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';

function parseEnvelope(result: Awaited<ReturnType<TestPair['client']['callTool']>>): any {
	const content = result.content as Array<{ type: string; text: string }>;
	return JSON.parse(content[0].text);
}

describe('echo tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
	});

	it('returns echoed message with empty metadata when no include specified', async () => {
		const result = await pair.client.callTool({
			name: 'echo',
			arguments: { message: 'hello' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.echoed).toBe('hello');
		expect(envelope.metadata).toEqual({});
	});

	it('returns stats metadata when include contains stats', async () => {
		const result = await pair.client.callTool({
			name: 'echo',
			arguments: { message: 'hello', include: ['stats'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.metadata.stats).toBeDefined();
		expect(envelope.metadata.stats.messageLength).toBe(5);
	});

	it('returns multiple metadata categories when include has stats and hints', async () => {
		const result = await pair.client.callTool({
			name: 'echo',
			arguments: { message: 'hello', include: ['stats', 'hints'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.metadata.stats).toBeDefined();
		expect(envelope.metadata.hints).toBeDefined();
	});

	it('returns error when message parameter is missing', async () => {
		const result = await pair.client.callTool({
			name: 'echo',
			arguments: {},
		});

		// Either MCP-level error or envelope error
		if (result.isError) {
			expect(result.isError).toBe(true);
		} else {
			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(false);
		}
	});

	it('returns error when message parameter has wrong type', async () => {
		const result = await pair.client.callTool({
			name: 'echo',
			arguments: { message: 123 },
		});

		// Either MCP-level error or envelope error
		if (result.isError) {
			expect(result.isError).toBe(true);
		} else {
			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(false);
		}
	});
});
