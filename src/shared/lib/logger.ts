type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
}

function createLogger(options: LoggerOptions = {}) {
  const minLevel = LOG_LEVELS[options.level ?? 'info'];
  const jsonMode = options.json ?? false;

  function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (LOG_LEVELS[level] < minLevel) return;

    if (jsonMode) {
      const entry = { level, message, timestamp: new Date().toISOString(), ...data };
      process.stderr.write(JSON.stringify(entry) + '\n');
    } else {
      const prefix = level === 'error' ? '\x1b[31m' // red
        : level === 'warn' ? '\x1b[33m' // yellow
        : level === 'debug' ? '\x1b[90m' // grey
        : '';
      const reset = prefix ? '\x1b[0m' : '';
      const dataStr = data ? ` ${JSON.stringify(data)}` : '';
      process.stderr.write(`${prefix}[${level}]${reset} ${message}${dataStr}\n`);
    }
  }

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data),
    child: (defaults: Record<string, unknown>) => {
      const parent = createLogger(options);
      return {
        debug: (msg: string, data?: Record<string, unknown>) =>
          parent.debug(msg, { ...defaults, ...data }),
        info: (msg: string, data?: Record<string, unknown>) =>
          parent.info(msg, { ...defaults, ...data }),
        warn: (msg: string, data?: Record<string, unknown>) =>
          parent.warn(msg, { ...defaults, ...data }),
        error: (msg: string, data?: Record<string, unknown>) =>
          parent.error(msg, { ...defaults, ...data }),
      };
    },
  };
}

/** Global logger instance — configure via setLoggerOptions() */
export let logger = createLogger();

export function setLoggerOptions(options: LoggerOptions): void {
  logger = createLogger(options);
}
