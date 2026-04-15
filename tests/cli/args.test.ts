import { describe, it, expect } from 'vitest';
import { parseCli } from '../../src/cli/args.js';

describe('parseCli', () => {
	it('returns default logLevel info', () => {
		const args = parseCli([]);
		expect(args.logLevel).toEqual('info');
	});

	it('--verbose flag sets logLevel to debug', () => {
		const args = parseCli(['--verbose']);
		expect(args.logLevel).toEqual('debug');
	});

	it('-v short flag sets logLevel to debug', () => {
		const args = parseCli(['-v']);
		expect(args.logLevel).toEqual('debug');
	});

	it('--log-level sets logLevel', () => {
		const args = parseCli(['--log-level', 'warn']);
		expect(args.logLevel).toEqual('warn');
	});

	it('--verbose overrides --log-level', () => {
		const args = parseCli(['--log-level', 'warn', '--verbose']);
		expect(args.logLevel).toEqual('debug');
	});

	it('invalid --log-level falls back to default', () => {
		const args = parseCli(['--log-level', 'invalid']);
		expect(args.logLevel).toEqual('info');
	});

	it('unknown flag --project throws', () => {
		expect(() => parseCli(['--project', '/path'])).toThrow();
	});
});
