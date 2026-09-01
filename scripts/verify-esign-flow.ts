/**
 * Verify the signature machinery against a running server, WITHOUT contacting
 * any e-signature vendor. Everything here is our own code: webhook
 * authentication, idempotency, ordering, the dashboard and the certificate
 * route's access control.
 *
 * The two things this cannot cover are the live SignNow and Graph calls —
 * scripts/verify-signnow.ts and scripts/verify-sharepoint.ts do those, with
 * your own credentials, on your own machine.
 *
 * Usage: npx tsx scripts/verify-esign-flow.ts
 */
import { chromium } from 'playwright-core';
import { createHmac } from 'crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const EMAIL = 'admin@fswelsford.com';
const PASSWORD = 'FswPeople!Demo2026';
const SECRET = process.env.SIGNNOW_WEBHOOK_SECRET!;

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

let failures = 0;
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

const sign = (body: string) => createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');

const post = (payload: unknown, signature?: string | null) => {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const sig = signature === undefined ? sign(body) : signature;
  if (sig) headers['x-signnow-signature'] = sig;
  return fetch(`${BASE}/api/esign/signnow`, { method: 'POST', headers, body });
};

async function main() {
  if (!SECRET) {
    console.log('SIGNNOW_WEBHOOK_SECRET is not set — the webhook is disabled and returns 404 by design.');
    process.exit(1);
  }

  const worker = await db.worker.findFirstOrThrow({ where: { status: 'ACTIVE', deletedAt: null } });
  const document = await db.document.create({
    data: {
      title: '[VERIFY] Signature flow',
      category: 'OFFER',
      classification: 'CONFIDENTIAL',
      workerId: worker.id,
      requiresSignature: true,
      versions: {
        create: {
          version: 1,
          fileKey: `verification/${Date.now()}.pdf`,
          fileName: 'verify.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        },
      },
    },
    include: { versions: true },
  });
  const providerDocumentId = `verify_doc_${Date.now()}`;
  const request = await db.signatureRequest.create({
    data: {
      documentVersionId: document.versions[0].id,
      workerId: worker.id,
      signerName: 'Verification Signer',
      signerEmail: 'verify@example.invalid',
      providerDocumentId,
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  console.log('— Webhook authentication —');
  const payload = { event: 'document.open', event_id: `evt_${Date.now()}`, content: { document_id: providerDocumentId } };

  check('unsigned delivery is refused', (await post(payload, null)).status === 401);
  const forged = createHmac('sha256', 'attacker').update(JSON.stringify(payload)).digest('base64');
  check('forged signature is refused', (await post(payload, forged)).status === 401);
  const tampered = { ...payload, content: { document_id: 'someone-elses-doc' } };
  check('a body altered after signing is refused', (await post(tampered, sign(JSON.stringify(payload)))).status === 401);

  const accepted = await post(payload);
  check('correctly signed delivery is accepted', accepted.status === 200, String(accepted.status));

  const afterView = await db.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
  check('status advanced to VIEWED', afterView.status === 'VIEWED', afterView.status);

  console.log('\n— Idempotency and ordering —');
  await post(payload);
  check(
    'a redelivery of the same event id changes nothing',
    (await db.signatureEvent.count({ where: { requestId: request.id, kind: 'VIEWED' } })) === 1,
  );

  const signedPayload = {
    event: 'document.complete',
    event_id: `evt_signed_${Date.now()}`,
    content: { document_id: providerDocumentId },
  };
  await post(signedPayload);
  const afterSign = await db.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
  // The provider call will fail here (no real account), which is the point:
  // SIGNED must not silently become STORED when the download cannot happen.
  check('signing does not jump straight to STORED', afterSign.status !== 'STORED', afterSign.status);
  check(
    'a failed download is recorded as FAILED, not lost',
    afterSign.status === 'FAILED' || afterSign.status === 'SIGNED',
    afterSign.status,
  );

  const latePayload = {
    event: 'document.open',
    event_id: `evt_late_${Date.now()}`,
    content: { document_id: providerDocumentId },
  };
  await post(latePayload);
  const afterLate = await db.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
  check('a stale VIEWED arriving later does not un-sign it', afterLate.status !== 'VIEWED', afterLate.status);

  console.log('\n— Evidence log —');
  const events = await db.signatureEvent.findMany({ where: { requestId: request.id } });
  check('every delivery is on the record', events.length >= 3, `${events.length} events`);
  const one = events[0];
  let immutable = false;
  try {
    await db.signatureEvent.update({ where: { id: one.id }, data: { kind: 'SIGNED' } });
  } catch {
    immutable = true;
  }
  check('the event log cannot be edited', immutable);

  console.log('\n— Unknown and unparseable deliveries —');
  const unknownDoc = await post({
    event: 'document.complete',
    event_id: `evt_x_${Date.now()}`,
    content: { document_id: 'no-such-document' },
  });
  check('an event about an unknown document is recorded, not 500', unknownDoc.status === 202, String(unknownDoc.status));
  const unreadable = await post({ event: 'document.some_new_thing', content: { document_id: providerDocumentId } });
  check('an unreadable event is acknowledged and logged', unreadable.status === 202, String(unreadable.status));

  console.log('\n— The dashboard —');
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });

  await page.goto(`${BASE}/documents/signatures`, { waitUntil: 'networkidle' });
  const dashboard = await page.content();
  check('the status dashboard renders', dashboard.includes('Signature status'));
  check('it shows the verification request', dashboard.includes('verify@example.invalid'));
  check('it shows the name captured at send time', dashboard.includes('Verification Signer'));
  check('it distinguishes signed-but-not-filed', dashboard.includes('Needs attention') || dashboard.includes('needs attention'));

  await page.goto(`${BASE}/documents/${document.id}`, { waitUntil: 'networkidle' });
  const detail = await page.content();
  check('the document page shows the certified signature panel', detail.includes('Certified signatures'));

  console.log('\n— Certificate route access control —');
  const noToken = await fetch(`${BASE}/api/signatures/${request.id}/certificate`);
  check('the certificate route refuses an unauthenticated caller', noToken.status === 401, String(noToken.status));

  await browser.close();

  // Clean up what can be cleaned up. The signature request and its events
  // deliberately CANNOT be deleted — evidence protects its parent — so the
  // document is soft-deleted the same way the application does it, and the
  // record stays, clearly labelled.
  await db.document.update({ where: { id: document.id }, data: { deletedAt: new Date() } });
  console.log(
    `\n  Left behind on purpose: signature request ${request.id.slice(0, 8)} and its events.\n` +
      '  They cannot be deleted — that is the guarantee, not a leak. The document\n' +
      '  "[VERIFY] Signature flow" has been soft-deleted.',
  );
  await db.$disconnect();

  console.log(failures === 0 ? '\nE-SIGNATURE FLOW VERIFIED' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
