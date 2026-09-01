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

  STORAGE_DRIVER: z.enum(['local', 's3', 'graph']).default('local'),
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
  // Model used for AI-assisted recruiting help. Advisory output only.
  AI_MODEL: z.string().default('claude-opus-5'),

  // Indeed. The job feed is a token-protected URL Indeed crawls; the token is
  // the only thing standing between the public internet and our open roles,
  // so it must be long. INDEED_APPLY_SECRET verifies the HMAC signature on
  // inbound Indeed Apply deliveries. Both optional: with neither set the
  // integration is simply off.
  INDEED_FEED_TOKEN: z.string().min(24, 'INDEED_FEED_TOKEN must be at least 24 chars').optional(),
  INDEED_APPLY_SECRET: z.string().min(24, 'INDEED_APPLY_SECRET must be at least 24 chars').optional(),
  // Publisher API token Indeed issues when Indeed Apply is enabled on the
  // account. Without it the feed still posts jobs; applicants just apply on
  // our own careers page instead of inside Indeed.
  INDEED_APPLY_API_TOKEN: z.string().optional(),
  INDEED_COMPANY_NAME: z.string().default('FSW Group'),

  // ---------------------------------------------------------------------------
  // Certified e-signature (SignNow). Optional: without it, documents still
  // support the internal acknowledgment flow and the UI says the certified
  // option is not configured.
  // ---------------------------------------------------------------------------
  ESIGN_PROVIDER: z.string().default('signnow'),
  SIGNNOW_CLIENT_ID: z.string().optional(),
  SIGNNOW_CLIENT_SECRET: z.string().optional(),
  SIGNNOW_USERNAME: z.string().optional(),
  SIGNNOW_PASSWORD: z.string().optional(),
  // Point at https://api-eval.signnow.com while testing. A sandbox key against
  // the production host would send real invites to real people.
  SIGNNOW_API_BASE: z.string().url().optional(),
  // Verifies the HMAC on inbound SignNow webhooks. Without it the webhook
  // endpoint returns 404 rather than trusting unsigned callers.
  SIGNNOW_WEBHOOK_SECRET: z.string().min(24, 'SIGNNOW_WEBHOOK_SECRET must be at least 24 chars').optional(),

  // ---------------------------------------------------------------------------
  // SharePoint document storage via Microsoft Graph (STORAGE_DRIVER=graph).
  // The site must be granted to this app registration with Sites.Selected and
  // have NO human members — FSW People stays the only door to HR documents.
  // ---------------------------------------------------------------------------
  MS_GRAPH_TENANT_ID: z.string().optional(),
  MS_GRAPH_CLIENT_ID: z.string().optional(),
  MS_GRAPH_CLIENT_SECRET: z.string().optional(),
  /** The SharePoint site id Graph returns for the document site. */
  MS_GRAPH_SITE_ID: z.string().optional(),
  /** Folder inside the site's default drive. Everything is written below it. */
  MS_GRAPH_ROOT_FOLDER: z.string().default('FSW People'),

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
