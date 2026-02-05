export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export interface Logger {
  error: (message: string) => void;
  warn: (message: string) => void;
  info: (message: string) => void;
  debug: (message: string) => void;
}

export function createLogger(level: LogLevel): Logger {
  const threshold = LEVEL_ORDER[level];

  return {
    error: (message) => log('error', message, threshold),
    warn: (message) => log('warn', message, threshold),
    info: (message) => log('info', message, threshold),
    debug: (message) => log('debug', message, threshold),
  };
}

function log(level: Exclude<LogLevel, 'silent'>, message: string, threshold: number): void {
  if (LEVEL_ORDER[level] > threshold || threshold === LEVEL_ORDER.silent) {
    return;
  }
  process.stderr.write(`[${level.toUpperCase()}] ${message}\n`);
}
