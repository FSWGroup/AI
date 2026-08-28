import { z } from 'zod';

/**
 * Environment validation. The app fails fast at startup with a clear message
 * when required infrastructure config is missing; optional integrations
 * (email provider, AI, SSO, payroll, e-sign) degrade gracefully.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars (openssl rand -hex 32)'),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'FIELD_ENCRYPTION_KEY must be 32 bytes of hex (openssl rand -hex 32)'),
  DOCUMENT_URL_SIGNING_KEY: z.string().min(32, 'DOCUMENT_URL_SIGNING_KEY must be at least 32 chars'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  EMAIL_DRIVER: z.enum(['outbox', 'smtp']).default('outbox'),
  EMAIL_FROM: z.string().default('FSW People <people@example.com>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  AI_PROVIDER: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`FSW People environment configuration is invalid:\n${issues}\nSee .env.example.`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
