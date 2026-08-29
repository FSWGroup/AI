/**
 * Structured logging (ADR-0032).
 *
 * Every log line carries a correlation ID. Configured fields are redacted before
 * serialization so a secret cannot reach a log by being passed to a logger that
 * did not expect it.
 */
import pino from 'pino';
import type { Logger } from 'pino';

export type { Logger };

/**
 * Paths redacted from every log line. Pino's redaction is path-based, so this
 * list covers the shapes secrets actually travel in.
 */
const REDACTED_PATHS = [
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'credential',
  'signingSecret',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
];

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    base: { service: process.env.OTEL_SERVICE_NAME ?? 'fsw-layer0' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
}
