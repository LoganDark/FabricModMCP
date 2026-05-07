import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope } from '../helpers/factories.js';

describe('record_feedback', () => {
	let pair: TestPair;
	let tmpDir: string;
	let feedbackPath: string;
	const originalEnv = process.env.FEEDBACK_PATH;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'fabricmodmcp-feedback-'));
		feedbackPath = join(tmpDir, 'FEEDBACK.txt');
		process.env.FEEDBACK_PATH = feedbackPath;
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
		if (originalEnv === undefined) delete process.env.FEEDBACK_PATH;
		else process.env.FEEDBACK_PATH = originalEnv;
	});

	it('appends a new entry containing timestamp, cwd, and message', async () => {
		expect(existsSync(feedbackPath)).toBe(false);

		const result = await pair.client.callTool({
			name: 'record_feedback',
			arguments: { message: 'list_members is confusing when JDT LS is unavailable.' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.path).toBe(feedbackPath);
		expect(envelope.data.cwd).toBe(process.cwd());
		expect(envelope.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		expect(envelope.data.bytesAppended).toBeGreaterThan(0);
		expect(envelope.metadata).toEqual({ tool: 'record_feedback' });

		const text = readFileSync(feedbackPath, 'utf-8');
		expect(text).toContain(`[${envelope.data.timestamp}]`);
		expect(text).toContain(`cwd=${process.cwd()}`);
		expect(text).toContain('list_members is confusing when JDT LS is unavailable.');
		expect(text.endsWith('\n\n')).toBe(true);
	});

	it('appends multiple entries without clobbering prior ones', async () => {
		const messages = [
			'first feedback',
			'second feedback',
			'third feedback',
		];
		for (const m of messages) {
			const result = await pair.client.callTool({
				name: 'record_feedback',
				arguments: { message: m },
			});
			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
		}
		const text = readFileSync(feedbackPath, 'utf-8');
		for (const m of messages) {
			expect(text).toContain(m);
		}
		// Three records → three blocks → three blank-line separators.
		const blocks = text.split(/\n\n/).filter((s) => s.length > 0);
		expect(blocks).toHaveLength(3);
	});

	it('preserves existing file contents on append', async () => {
		// Pre-populate the file with a sentinel (e.g. simulating a previous run).
		const sentinel = '[2099-01-01T00:00:00.000Z] cwd=/old\nlegacy message\n\n';
		writeFileSync(feedbackPath, sentinel, 'utf-8');

		const result = await pair.client.callTool({
			name: 'record_feedback',
			arguments: { message: 'new entry' },
		});
		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);

		const text = readFileSync(feedbackPath, 'utf-8');
		expect(text.startsWith(sentinel)).toBe(true);
		expect(text).toContain('new entry');
	});

	it('preserves multi-line messages verbatim and trims trailing whitespace', async () => {
		const message = 'line one\nline two\n\nline four with blank above\n   \n\n';
		const result = await pair.client.callTool({
			name: 'record_feedback',
			arguments: { message },
		});
		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);

		const text = readFileSync(feedbackPath, 'utf-8');
		const expectedBody = 'line one\nline two\n\nline four with blank above';
		expect(text).toContain(expectedBody);
		// Each block ends with exactly one blank line separator.
		expect(text.endsWith(`${expectedBody}\n\n`)).toBe(true);
	});

	it('rejects empty messages and does not write the file', async () => {
		const raw = await pair.client.callTool({
			name: 'record_feedback',
			arguments: { message: '' },
		});
		// Either the SDK turned it into an error response, or the envelope is an error.
		// What we care about is that the file isn't created from an empty submission.
		const isError = raw.isError === true;
		const envelope = parseEnvelope(raw);
		const envelopeFailed = envelope !== undefined && envelope.success === false;
		expect(isError || envelopeFailed || existsSync(feedbackPath) === false).toBe(true);
		expect(existsSync(feedbackPath)).toBe(false);
	});

	it('honors FEEDBACK_PATH env override over the install-root default', async () => {
		// beforeEach already set FEEDBACK_PATH to feedbackPath in tmpDir.
		// The install-root default would be <repo>/FEEDBACK.txt — we never want
		// tests to write there. Just confirm the override is what's used.
		const result = await pair.client.callTool({
			name: 'record_feedback',
			arguments: { message: 'env override check' },
		});
		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.path).toBe(feedbackPath);
		expect(existsSync(feedbackPath)).toBe(true);
	});
});
