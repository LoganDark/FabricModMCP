export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
	debug: 0, info: 1, warn: 2, error: 3,
};

class Logger {
	private level: LogLevel = 'info';

	setLevel(level: LogLevel) {
		this.level = level;
	}

	getLevel(): LogLevel {
		return this.level;
	}

	private log(level: LogLevel, message: string, data?: unknown) {
		if (LEVELS[level] < LEVELS[this.level]) return;
		const timestamp = new Date().toISOString();
		const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
		if (data !== undefined) {
			console.error(`${prefix} ${message}`, typeof data === 'string' ? data : JSON.stringify(data));
		} else {
			console.error(`${prefix} ${message}`);
		}
	}

	debug(msg: string, data?: unknown) { this.log('debug', msg, data); }
	info(msg: string, data?: unknown) { this.log('info', msg, data); }
	warn(msg: string, data?: unknown) { this.log('warn', msg, data); }
	error(msg: string, data?: unknown) { this.log('error', msg, data); }
}

export const logger = new Logger();
