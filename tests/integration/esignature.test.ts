import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, type Fixture } from '../helpers/db';
import { applySignatureEvent, recordSignatureEvent, advanceStatus, signatureSummary, storeSignedArtifacts } from '@/lib/signatures';
import { esign, resetEsignProvider } from '@/lib/esign';
import type { ParsedWebhookEvent } from '@/lib/esign/types';
import { POST as webhookRoute } from '@/app/api/esign/signnow/route';

const SECRET = process.env.SIGNNOW_WEBHOOK_SECRET!;
const sign = (body: string) => createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');

let fixture: Fixture;
let workerId: string;
let documentId: string;
let versionId: string;

function post(payload: unknown, opts: { signature?: string | null; tamper?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const signature =
    opts.signature !== undefined ? opts.signature : sign(opts.tamper ? `${body} ` : body);
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature) headers.set('x-signnow-signature', signature);
  return webhookRoute(
    new NextRequest('http://localhost:3000/api/esign/signnow', { method: 'POST', body, headers }),
  );
}

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();
  const row = await makeWorker({ fixture, email: 'signer@es.test', roleKeys: ['EMPLOYEE'] });
  workerId = row.workerId;

  const doc = await testDb.document.create({
    data: {
      title: 'Offer letter',
      category: 'OFFER',
      classification: 'CONFIDENTIAL',
      workerId,
      requiresSignature: true,
      versions: {
        create: {
          version: 1,
          fileKey: 'documents/2026/09/offer.pdf',
          fileName: 'offer.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        },
      },
    },
    include: { versions: true },
  });
  documentId = doc.id;
  versionId = doc.versions[0].id;
});

afterAll(async () => {
  await testDb.$disconnect();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await testDb.$executeRawUnsafe('TRUNCATE TABLE "SignatureEvent", "SignatureRequest" RESTART IDENTITY CASCADE');
  resetEsignProvider();
});

async function makeRequest(providerDocumentId = 'doc_abc', status = 'SENT') {
  return testDb.signatureRequest.create({
    data: {
      documentVersionId: versionId,
      workerId,
      signerName: 'Dana Okafor',
      signerEmail: 'signer@es.test',
      providerDocumentId,
      status,
      sentAt: new Date(),
    },
  });
}

const event = (over: Partial<ParsedWebhookEvent> = {}): ParsedWebhookEvent => ({
  kind: 'VIEWED',
  providerDocumentId: 'doc_abc',
  providerEventId: `evt_${Math.random()}`,
  occurredAt: new Date(),
  ...over,
});

describe('webhook authentication', () => {
  const payload = { event: 'document.open', event_id: 'e1', content: { document_id: 'doc_abc' } };

  it('refuses an unsigned delivery', async () => {
    await makeRequest();
    const response = await post(payload, { signature: null });
    expect(response.status).toBe(401);
    expect(await testDb.signatureEvent.count()).toBe(0);
  });

  it('refuses a body modified after signing', async () => {
    await makeRequest();
    expect((await post(payload, { tamper: true })).status).toBe(401);
  });

  it('refuses a signature made with the wrong secret', async () => {
    await makeRequest();
    const forged = createHmac('sha256', 'attacker-secret').update(JSON.stringify(payload)).digest('base64');
    expect((await post(payload, { signature: forged })).status).toBe(401);
  });

  it('accepts a correctly signed delivery', async () => {
    await makeRequest();
    const response = await post(payload);
    expect(response.status).toBe(200);
  });

  it('records the rejection in the audit log without storing the payload', async () => {
    await post(payload, { signature: null });
    const events = await testDb.auditEvent.findMany({ where: { action: 'esign.webhook_rejected' } });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events[0].metadata)).not.toContain('doc_abc');
  });

  it('rejects a body that is not JSON', async () => {
    const body = 'not json';
    const response = await webhookRoute(
      new NextRequest('http://localhost:3000/api/esign/signnow', {
        method: 'POST',
        body,
        headers: new Headers({ 'x-signnow-signature': sign(body) }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('accepts but does not act on an event it cannot read', async () => {
    await makeRequest();
    const unknown = { event: 'document.brand_new_thing', content: { document_id: 'doc_abc' } };
    const response = await post(unknown);
    expect(response.status).toBe(202);
    expect(await testDb.signatureEvent.count()).toBe(0);
    // Still recorded, so an unhandled provider event gets noticed.
    expect(await testDb.auditEvent.count({ where: { action: 'esign.webhook_unrecognised' } })).toBe(1);
  });

  it('records a delivery about a document it does not know', async () => {
    const response = await post({ event: 'document.open', event_id: 'x', content: { document_id: 'doc_unknown' } });
    expect(response.status).toBe(202);
    expect(await testDb.auditEvent.count({ where: { action: 'esign.webhook_unmatched' } })).toBe(1);
  });
});

describe('event application', () => {
  it('advances the status and stamps the timestamp', async () => {
    const request = await makeRequest();
    const result = await applySignatureEvent(event({ kind: 'VIEWED' }));
    expect(result.handled).toBe(true);
    const after = await testDb.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('VIEWED');
    expect(after.viewedAt).not.toBeNull();
  });

  it('is idempotent — the same provider event id twice changes nothing', async () => {
    await makeRequest();
    const e = event({ kind: 'VIEWED', providerEventId: 'evt_same' });
    await applySignatureEvent(e);
    const second = await applySignatureEvent(e);
    expect(second.reason).toContain('Duplicate');
    expect(await testDb.signatureEvent.count()).toBe(1);
  });

  it('does not un-sign a document when a stale VIEWED arrives after SIGNED', async () => {
    const request = await makeRequest('doc_abc', 'SIGNED');
    await testDb.signatureRequest.update({ where: { id: request.id }, data: { signedAt: new Date() } });

    const result = await applySignatureEvent(event({ kind: 'VIEWED', providerEventId: 'evt_late' }));
    expect(result.handled).toBe(true);
    const after = await testDb.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('SIGNED');
    // The late event is still on the record — it happened, it just changed nothing.
    expect(await testDb.signatureEvent.count({ where: { kind: 'VIEWED' } })).toBe(1);
  });

  it('records a decline with its reason', async () => {
    const request = await makeRequest();
    await applySignatureEvent(event({ kind: 'DECLINED', detail: 'Wrong start date' }));
    const after = await testDb.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('DECLINED');
    expect(after.declineReason).toBe('Wrong start date');
  });

  it('cannot revive a cancelled request', async () => {
    const request = await makeRequest('doc_abc', 'CANCELED');
    await applySignatureEvent(event({ kind: 'SIGNED' }));
    const after = await testDb.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('CANCELED');
  });
});

describe('storing the signed artifacts', () => {
  // Storing files a new DocumentVersion, so reset the document to its single
  // original version between cases — otherwise versions accumulate across tests.
  beforeEach(async () => {
    await testDb.documentVersion.deleteMany({ where: { documentId, id: { not: versionId } } });
  });

  it('downloads both the PDF and the certificate, and files the signed version', async () => {
    const request = await makeRequest('doc_abc', 'SIGNED');
    const pdf = Buffer.from('%PDF-1.7 signed');
    const certificate = Buffer.from('%PDF-1.7 certificate');
    vi.spyOn(esign(), 'downloadSigned').mockResolvedValue({ pdf, certificate });

    const result = await storeSignedArtifacts(request.id);
    expect(result.stored).toBe(true);

    const after = await testDb.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('STORED');
    expect(after.signedFileKey).not.toBeNull();
    expect(after.certificateFileKey).not.toBeNull();
    expect(after.signedSha256).not.toBeNull();

    // The signed PDF joins the document's own history, so it downloads through
    // the same audited route as everything else.
    const versions = await testDb.documentVersion.findMany({ where: { documentId }, orderBy: { version: 'asc' } });
    expect(versions).toHaveLength(2);
    expect(versions[1].id).toBe(after.signedVersionId);
    expect(versions[1].fileName).toContain('signed');
  });

  it('is idempotent — a second call does not create a second version', async () => {
    const request = await makeRequest('doc_abc', 'SIGNED');
    vi.spyOn(esign(), 'downloadSigned').mockResolvedValue({
      pdf: Buffer.from('%PDF signed'),
      certificate: null,
    });
    await storeSignedArtifacts(request.id);
    const again = await storeSignedArtifacts(request.id);
    expect(again.stored).toBe(true);
    expect(await testDb.documentVersion.count({ where: { documentId } })).toBe(2);
  });

  it('keeps the signed document even when no certificate comes back', async () => {
    const request = await makeRequest('doc_abc', 'SIGNED');
    vi.spyOn(esign(), 'downloadSigned').mockResolvedValue({ pdf: Buffer.from('%PDF signed'), certificate: null });

    expect((await storeSignedArtifacts(request.id)).stored).toBe(true);
    const after = await testDb.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.signedFileKey).not.toBeNull();
    expect(after.certificateFileKey).toBeNull();
    // ...and says so on the record, rather than pretending.
    const stored = await testDb.signatureEvent.findFirstOrThrow({ where: { kind: 'STORED' } });
    expect(stored.detail).toContain('no audit certificate');
  });

  it('marks the request FAILED rather than STORED when the download fails', async () => {
    const request = await makeRequest('doc_abc', 'SIGNED');
    vi.spyOn(esign(), 'downloadSigned').mockRejectedValue(new Error('provider timed out'));

    const result = await storeSignedArtifacts(request.id);
    expect(result.stored).toBe(false);
    const after = await testDb.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('FAILED');
    expect(after.lastError).toContain('timed out');
    // Crucially: no signed version was filed, so nothing looks complete.
    expect(await testDb.documentVersion.count({ where: { documentId } })).toBe(1);
  });
});

describe('the event log', () => {
  it('is append-only', async () => {
    const request = await makeRequest();
    await recordSignatureEvent({ requestId: request.id, kind: 'CREATED' });
    const record = await testDb.signatureEvent.findFirstOrThrow();
    await expect(
      testDb.signatureEvent.update({ where: { id: record.id }, data: { kind: 'SIGNED' } }),
    ).rejects.toThrow();
    await expect(testDb.signatureEvent.delete({ where: { id: record.id } })).rejects.toThrow();
  });

  it('protects its parent from deletion rather than being swept away with it', async () => {
    const request = await makeRequest();
    await recordSignatureEvent({ requestId: request.id, kind: 'SIGNED' });
    // Deleting the request would orphan the evidence, so the database refuses.
    await expect(testDb.signatureRequest.delete({ where: { id: request.id } })).rejects.toThrow();
    // ...and so does deleting the document version it belongs to.
    await expect(testDb.documentVersion.delete({ where: { id: versionId } })).rejects.toThrow();
  });

  it('refuses a duplicate provider event id at the database level', async () => {
    const request = await makeRequest();
    expect(await recordSignatureEvent({ requestId: request.id, kind: 'VIEWED', providerEventId: 'evt_1' })).toBe(true);
    expect(await recordSignatureEvent({ requestId: request.id, kind: 'VIEWED', providerEventId: 'evt_1' })).toBe(false);
  });
});

describe('status transitions guard the update path', () => {
  it('refuses an illegal transition without touching the row', async () => {
    const request = await makeRequest('doc_abc', 'STORED');
    expect(await advanceStatus(request.id, 'SENT')).toBe(false);
    const after = await testDb.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('STORED');
  });
});

describe('the dashboard summary', () => {
  it('counts outstanding, overdue and completed from our own records', async () => {
    await testDb.signatureRequest.createMany({
      data: [
        { documentVersionId: versionId, workerId, signerName: 'A', signerEmail: 'a@x.test', status: 'SENT', dueAt: new Date(Date.now() - 86_400_000) },
        { documentVersionId: versionId, workerId, signerName: 'B', signerEmail: 'b@x.test', status: 'VIEWED', dueAt: new Date(Date.now() + 86_400_000) },
        { documentVersionId: versionId, workerId, signerName: 'C', signerEmail: 'c@x.test', status: 'STORED' },
        { documentVersionId: versionId, workerId, signerName: 'D', signerEmail: 'd@x.test', status: 'DECLINED' },
        { documentVersionId: versionId, workerId, signerName: 'E', signerEmail: 'e@x.test', status: 'FAILED' },
      ],
    });
    const summary = await signatureSummary();
    expect(summary.total).toBe(5);
    expect(summary.outstanding).toBe(2);
    expect(summary.overdue).toBe(1);
    expect(summary.signed).toBe(1);
    expect(summary.declined).toBe(1);
    expect(summary.failed).toBe(1);
  });
});
