/**
 * JDT LS Request Serialization — crash guard for `ts-lsp-client`
 *
 * `ts-lsp-client@1.x`'s `JSONRPCEndpoint` cannot service concurrent requests:
 * it matches an incoming response only when `response.id === nextId - 1`, i.e.
 * it assumes strictly sequential request/response. Any other response — which
 * happens the moment two LSP requests are in flight at once — makes the
 * endpoint emit an `'error'` event. `JSONRPCEndpoint` extends `EventEmitter`,
 * so an `'error'` with no listener is re-thrown and terminates the Node
 * process (the MCP host then reports `MCP error -32000: Connection closed`).
 *
 * The MCP host dispatches tool calls concurrently, so two JDT LS-backed tools
 * (search_symbols, find_references, find_implementations, type_hierarchy, or
 * batched read_member) can each have a request outstanding simultaneously.
 *
 * This module hardens a `JSONRPCEndpoint` so that can never crash the server:
 *
 *  1. It wraps `endpoint.send` in a promise chain (a mutex) so at most ONE
 *     request is ever in flight. Sequential requests keep the id-match
 *     invariant `response.id === nextId - 1` true, eliminating the root cause.
 *  2. It attaches an `'error'` listener to the endpoint. Even if a stray
 *     `'error'` is still emitted (e.g. a malformed message from JDT LS), it is
 *     logged instead of crashing the process.
 *
 * `endpoint.notify` (fire-and-forget notifications such as
 * `textDocument/didOpen` and `workspace/didChangeWatchedFiles`) carries no id
 * and needs no serialization, so it is left untouched.
 */

import type { JSONRPCEndpoint } from 'ts-lsp-client';
import { logger } from '../logging/logger.js';

/** Marker so a given endpoint is only hardened once. */
const HARDENED = Symbol('jdtls-request-queue-hardened');

type HardenedEndpoint = JSONRPCEndpoint & { [HARDENED]?: true };

/**
 * Serialize every `endpoint.send` call and install an `'error'` listener.
 *
 * Idempotent: calling it twice on the same endpoint is a no-op.
 */
export function hardenEndpoint(endpoint: JSONRPCEndpoint): void {
	const ep = endpoint as HardenedEndpoint;
	if (ep[HARDENED]) return;
	ep[HARDENED] = true;

	// Defense-in-depth: an unhandled 'error' on an EventEmitter is re-thrown
	// and crashes the process. A listener turns it into a logged warning.
	endpoint.on('error', (err: unknown) => {
		logger.warn('JDT LS endpoint error (suppressed to keep server alive)', {
			error: err instanceof Error ? err.message : String(err),
		});
	});

	// Mutex: each send() waits for the previous send() to settle before it is
	// dispatched, so only one request id is ever outstanding.
	const originalSend = endpoint.send.bind(endpoint);
	let tail: Promise<unknown> = Promise.resolve();

	endpoint.send = (method: string, message?: unknown): Promise<unknown> => {
		const run = tail.then(
			() => originalSend(method, message),
			// A prior request's rejection must not poison the chain.
			() => originalSend(method, message),
		);
		// Keep the chain alive regardless of how `run` settles.
		tail = run.then(() => undefined, () => undefined);
		return run;
	};
}
