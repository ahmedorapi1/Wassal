import pino, { type LoggerOptions } from 'pino';

export * from './audit.js';
export * from './errors.js';

export function createLogger(service: string, options: LoggerOptions = {}) {
  return pino({
    base: { service },
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'phone',
        '*.phone',
        'otp',
        '*.otp',
        'authorization',
        'req.headers.authorization',
      ],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...options,
  });
}
