/**
 * Optional logging surface. The library core is *silent* — it never writes to
 * stdout/stderr (only `cli.ts` does). All diagnostics flow through an injected
 * `Logger`; the default is a no-op so embedding ChatKit produces no output unless
 * the consumer opts in. Follows the tunnelkit logging convention.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured fields attached to a log line. Never put credentials here. */
export type LogFields = Record<string, unknown>;

export interface Logger {
	debug(message: string, fields?: LogFields): void;
	info(message: string, fields?: LogFields): void;
	warn(message: string, fields?: LogFields): void;
	error(message: string, fields?: LogFields): void;
}

/** A logger that discards everything. The default. */
export const noopLogger: Logger = {
	debug() {},
	info() {},
	warn() {},
	error() {}
};

/**
 * A small console-backed logger for examples and the CLI. Filters by level and
 * emits a single line per call. Not used by the core unless explicitly injected.
 */
export function consoleLogger(minLevel: LogLevel = 'info'): Logger {
	const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
	const enabled = (level: LogLevel) => order[level] >= order[minLevel];
	const emit = (level: LogLevel, message: string, fields?: LogFields) => {
		if (!enabled(level)) return;
		const suffix = fields && Object.keys(fields).length ? ' ' + JSON.stringify(fields) : '';
		const line = `[chatkit:${level}] ${message}${suffix}`;
		if (level === 'error') console.error(line);
		else if (level === 'warn') console.warn(line);
		else console.log(line);
	};
	return {
		debug: (m, f) => emit('debug', m, f),
		info: (m, f) => emit('info', m, f),
		warn: (m, f) => emit('warn', m, f),
		error: (m, f) => emit('error', m, f)
	};
}

/** Prefix every line of a logger with a stable tag (e.g. an account id). */
export function prefixedLogger(base: Logger, prefix: string): Logger {
	return {
		debug: (m, f) => base.debug(`${prefix} ${m}`, f),
		info: (m, f) => base.info(`${prefix} ${m}`, f),
		warn: (m, f) => base.warn(`${prefix} ${m}`, f),
		error: (m, f) => base.error(`${prefix} ${m}`, f)
	};
}
