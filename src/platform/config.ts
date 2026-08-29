/**
 * Configuration is read once, validated once, and frozen. Nothing else in the
 * system reads process.env, so what the application requires is enumerated in one
 * place and a missing value fails at startup rather than at 3am.
 */
import { readFileSync } from 'node:fs';

export type Environment = 'development' | 'test' | 'staging' | 'production';

export interface DatabaseConfig {
  readonly url: string;
  readonly migrationUrl: string;
  readonly readonlyUrl: string | undefined;
  readonly poolMax: number;
  readonly statementTimeoutMs: number;
}

export interface ObjectStoreConfig {
  readonly driver: 'filesystem' | 's3';
  readonly root: string;
  readonly bucket: string | undefined;
  readonly endpoint: string | undefined;
  readonly region: string | undefined;
}

export interface Config {
  readonly env: Environment;
  readonly port: number;
  readonly logLevel: string;
  readonly database: DatabaseConfig;
  readonly objectStore: ObjectStoreConfig;
  readonly auth: {
    /** Local/test only. Bypasses OIDC validation. Refused outside development. */
    readonly devBypass: boolean;
    readonly jwksCacheTtlSeconds: number;
  };
  readonly webhook: { readonly maxAttempts: number; readonly timeoutMs: number };
}

class ConfigError extends Error {
  constructor(message: string) {
    super(`Configuration error: ${message}`);
    this.name = 'ConfigError';
  }
}

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(`${name} is required but not set`);
  }
  return value;
}

function optional(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function integer(name: string, env: NodeJS.ProcessEnv, fallback: number): number {
  const raw = optional(name, env);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) throw new ConfigError(`${name} must be an integer`);
  return parsed;
}

function boolean_(name: string, env: NodeJS.ProcessEnv, fallback: boolean): boolean {
  const raw = optional(name, env);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ConfigError(`${name} must be 'true' or 'false'`);
}

function environment(env: NodeJS.ProcessEnv): Environment {
  const raw = optional('NODE_ENV', env) ?? 'development';
  if (
    raw !== 'development' &&
    raw !== 'test' &&
    raw !== 'staging' &&
    raw !== 'production'
  ) {
    throw new ConfigError(`NODE_ENV must be development, test, staging or production`);
  }
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = environment(env);
  const databaseUrl = required('DATABASE_URL', env);

  const devBypass = boolean_('AUTH_DEV_BYPASS', env, false);
  if (devBypass && nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new ConfigError(
      'AUTH_DEV_BYPASS must not be enabled outside development or test',
    );
  }

  const driver = optional('OBJECT_STORE_DRIVER', env) ?? 'filesystem';
  if (driver !== 'filesystem' && driver !== 's3') {
    throw new ConfigError(`OBJECT_STORE_DRIVER must be 'filesystem' or 's3'`);
  }

  return Object.freeze({
    env: nodeEnv,
    port: integer('PORT', env, 3000),
    logLevel: optional('LOG_LEVEL', env) ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    database: Object.freeze({
      url: databaseUrl,
      migrationUrl: optional('DATABASE_MIGRATION_URL', env) ?? databaseUrl,
      readonlyUrl: optional('DATABASE_READONLY_URL', env),
      poolMax: integer('DATABASE_POOL_MAX', env, 10),
      statementTimeoutMs: integer('DATABASE_STATEMENT_TIMEOUT_MS', env, 15_000),
    }),
    objectStore: Object.freeze({
      driver,
      root: optional('OBJECT_STORE_ROOT', env) ?? './var/objects',
      bucket: optional('OBJECT_STORE_BUCKET', env),
      endpoint: optional('OBJECT_STORE_ENDPOINT', env),
      region: optional('OBJECT_STORE_REGION', env),
    }),
    auth: Object.freeze({
      devBypass,
      jwksCacheTtlSeconds: integer('AUTH_JWKS_CACHE_TTL_SECONDS', env, 3600),
    }),
    webhook: Object.freeze({
      maxAttempts: integer('WEBHOOK_MAX_ATTEMPTS', env, 8),
      timeoutMs: integer('WEBHOOK_TIMEOUT_MS', env, 10_000),
    }),
  });
}

/**
 * Load a .env file into process.env without overwriting anything already set.
 * Development convenience only; real environments inject variables directly and
 * secrets come from the platform secret store, never from a file (spec §62).
 */
export function loadDotEnv(path = '.env'): void {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
