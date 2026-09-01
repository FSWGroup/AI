import 'dotenv/config';

// Integration tests run against a dedicated database so a test run can never
// touch development data. See tests/helpers/db.ts.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/fsw_people(\?|$)/, '/fsw_people_test$1');

(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test'.padEnd(40, '0');
process.env.FIELD_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.DOCUMENT_URL_SIGNING_KEY ??= 'b'.repeat(40);
process.env.EMAIL_DRIVER = 'outbox';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = './.storage-test';

// Indeed + AI: fixed test credentials so the feed, webhook signature and
// integration status behave deterministically. No real key is ever used.
process.env.INDEED_FEED_TOKEN ??= 'test-feed-token-'.padEnd(40, '0');
process.env.INDEED_APPLY_SECRET ??= 'test-apply-secret-'.padEnd(40, '0');
process.env.INDEED_COMPANY_NAME ??= 'FSW Group';
process.env.APP_BASE_URL ??= 'http://localhost:3000';

// Certified e-signature: fixed test credentials so webhook signature
// verification is deterministic. No real account is ever contacted.
process.env.SIGNNOW_WEBHOOK_SECRET ??= 'test-signnow-webhook-'.padEnd(40, '0');
process.env.SIGNNOW_CLIENT_ID ??= 'test-client-id';
process.env.SIGNNOW_CLIENT_SECRET ??= 'test-client-secret';
process.env.SIGNNOW_USERNAME ??= 'test@example.invalid';
process.env.SIGNNOW_PASSWORD ??= 'test-password';
process.env.SIGNNOW_API_BASE ??= 'https://api-eval.signnow.invalid';
