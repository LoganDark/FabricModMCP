import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from './helpers/client.js';

describe('MCP server', () => {
  let pair: TestPair;

  beforeEach(async () => {
    pair = await createTestPair();
  });

  afterEach(async () => {
    await pair.cleanup();
  });

  it('completes handshake and connects successfully', async () => {
    // If we got here, createTestPair completed without error,
    // which means the MCP handshake succeeded
    expect(pair.client).toBeDefined();
    expect(pair.server).toBeDefined();
  });

  it('lists echo tool in available tools', async () => {
    const result = await pair.client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('echo');
  });

  it('echo tool listing includes message parameter in inputSchema', async () => {
    const result = await pair.client.listTools();
    const echoTool = result.tools.find((t) => t.name === 'echo');
    expect(echoTool).toBeDefined();
    expect(echoTool!.inputSchema).toBeDefined();
    const properties = (echoTool!.inputSchema as any).properties;
    expect(properties).toHaveProperty('message');
  });
});
