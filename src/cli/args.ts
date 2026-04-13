import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { LogLevel } from '../logging/logger.js';

export interface CliArgs {
	projects: string[];
	logLevel: LogLevel;
}

const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function isValidLogLevel(value: string): value is LogLevel {
	return (VALID_LOG_LEVELS as readonly string[]).includes(value);
}

export function parseCli(argv: string[]): CliArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			project: { type: 'string', short: 'p', multiple: true },
			verbose: { type: 'boolean', short: 'v' },
			'log-level': { type: 'string' },
		},
		strict: true,
	});

	// Priority: --verbose > --log-level > LOG_LEVEL env > default 'info'
	let logLevel: LogLevel = 'info';

	const envLevel = process.env.LOG_LEVEL;
	if (envLevel && isValidLogLevel(envLevel)) {
		logLevel = envLevel;
	}

	if (values['log-level']) {
		const cliLevel = values['log-level'];
		if (isValidLogLevel(cliLevel)) {
			logLevel = cliLevel;
		}
	}

	if (values.verbose) {
		logLevel = 'debug';
	}

	return {
		projects: (values.project ?? []).map(p => resolve(p)),
		logLevel,
	};
}
