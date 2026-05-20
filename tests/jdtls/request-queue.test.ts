/**
 * Regression tests for `hardenEndpoint` — the crash guard for
 * `ts-lsp-client@1.x`'s `JSONRPCEndpoint`.
 *
 * Root cause being guarded against (debug session `server-crash-search-symbols`):
 * `JSONRPCEndpoint` matches a response only when `response.id === nextId - 1`.
 * With two requests in flight at once, the first response no longer matches and
 * the endpoint emits an `'error'` event. `JSONRPCEndpoint` is an `EventEmitter`,
 * so an `'error'` with no listener is re-thrown and terminates the process.
 *
 * `hardenEndpoint` must (1) serialize `send()` so only one request id is ever
 * outstanding, and (2) attach an `'error'` listener so a stray emit cannot crash
 * the process.
 */

import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { JSONRPCEndpoint } from 'ts-lsp-client';
import { hardenEndpoint } from '../../src/jdtls/request-queue.js';

/**
 * Build a JSONRPCEndpoint wired to in-memory streams.
 *
 * - `outbound` receives every Content-Length framed request the endpoint sends.
 * - `inbound` is the stream the endpoint reads responses from; feed it with
 *   `frame()` output.
 */
function makeEndpoint(): { endpoint: JSONRPCEndpoint; outbound: PassThrough; inbound: PassThrough } {
	const outbound = new PassThrough();
	const inbound = new PassThrough();
	const endpoint = new JSONRPCEndpoint(outbound, inbound);
	return { endpoint, outbound, inbound };
}

/** LSP-frame a JSON-RPC payload (Content-Length header + body). */
function frame(obj: unknown): string {
	const body = JSON.stringify(obj);
	return `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;
}

/** Collect the JSON-RPC request ids written to the outbound stream. */
function readRequestIds(chunk: string): number[] {
	const ids: number[] = [];
	const re = /\{[^]*?\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(chunk)) !== null) {
		try {
			const parsed = JSON.parse(m[0]);
			if (typeof parsed.id === 'number') ids.push(parsed.id);
		} catch { /* header noise — ignore */ }
	}
	return ids;
}

describe('hardenEndpoint', () => {
	it('is idempotent — hardening twice does not double-wrap', () => {
		const { endpoint } = makeEndpoint();
		hardenEndpoint(endpoint);
		const afterFirst = endpoint.send;
		hardenEndpoint(endpoint);
		expect(endpoint.send).toBe(afterFirst);
	});

	it('attaches an "error" listener so a stray emit cannot crash the process', () => {
		const { endpoint } = makeEndpoint();
		hardenEndpoint(endpoint);
		expect(endpoint.listenerCount('error')).toBe(1);
		// An emit with a listener present must NOT throw.
		expect(() => endpoint.emit('error', 'simulated transport error')).not.toThrow();
	});

	it('serializes concurrent send() calls — only one request id outstanding at a time', async () => {
		const { endpoint, outbound, inbound } = makeEndpoint();
		hardenEndpoint(endpoint);

		let written = '';
		outbound.on('data', (c: Buffer) => { written += c.toString('utf-8'); });

		// Fire two requests "concurrently".
		const p1 = endpoint.send('first');
		const p2 = endpoint.send('second');

		// Let microtasks flush — the second request must NOT be dispatched yet
		// because the first has not been answered.
		await new Promise((r) => setImmediate(r));
		expect(readRequestIds(written)).toEqual([0]);

		// Answer request 0. Its id matches nextId-1 (1-1=0), so no 'error'.
		inbound.write(frame({ jsonrpc: '2.0', id: 0, result: 'r0' }));
		await expect(p1).resolves.toBe('r0');

		// Only now is the second request dispatched.
		await new Promise((r) => setImmediate(r));
		expect(readRequestIds(written)).toEqual([0, 1]);

		inbound.write(frame({ jsonrpc: '2.0', id: 1, result: 'r1' }));
		await expect(p2).resolves.toBe('r1');
	});

	it('does not emit "error" across many serialized requests (no id mismatch)', async () => {
		const { endpoint, inbound } = makeEndpoint();
		hardenEndpoint(endpoint);

		const errorSpy = vi.fn();
		// Replace the hardening listener with a spy to detect any emit.
		endpoint.removeAllListeners('error');
		endpoint.on('error', errorSpy);

		const results: Promise<unknown>[] = [];
		for (let i = 0; i < 5; i++) {
			results.push(endpoint.send(`req${i}`));
		}

		// Answer each request in order; serialization guarantees each response's
		// id equals nextId-1 at the moment it arrives.
		for (let i = 0; i < 5; i++) {
			await new Promise((r) => setImmediate(r));
			inbound.write(frame({ jsonrpc: '2.0', id: i, result: i }));
			await results[i];
		}

		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('a rejected request does not poison the serialization chain', async () => {
		const { endpoint, inbound } = makeEndpoint();
		hardenEndpoint(endpoint);

		const p1 = endpoint.send('will-fail');
		const p2 = endpoint.send('will-succeed');

		await new Promise((r) => setImmediate(r));
		inbound.write(frame({ jsonrpc: '2.0', id: 0, error: { code: -1, message: 'boom' } }));
		await expect(p1).rejects.toBeDefined();

		// The chain must still advance to the second request.
		await new Promise((r) => setImmediate(r));
		inbound.write(frame({ jsonrpc: '2.0', id: 1, result: 'ok' }));
		await expect(p2).resolves.toBe('ok');
	});
});
