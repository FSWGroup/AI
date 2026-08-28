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
