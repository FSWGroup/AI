import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auditAnonymous } from '@/lib/audit';
import { esign, esignConfigured } from '@/lib/esign';
import { signNowPayloadDigest } from '@/lib/esign/signnow';
import { applySignatureEvent, recordSignatureEvent } from '@/lib/signatures';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * SignNow webhook receiver.
 *
 * Same shape as the Indeed Apply receiver, for the same reasons: the signature
 * is verified against the RAW bytes before the body is parsed or trusted,
 * redelivery is a no-op enforced by a unique index, and every delivery is
 * recorded — including the ones we refuse, because "did the provider ever tell
 * us this was signed?" is a question that gets asked in disputes.
 *
 * Returns 404 rather than 500 when unconfigured, so an endpoint that is not in
 * use reveals nothing about whether it exists.
 */
export async function POST(request: NextRequest) {
  if (!esignConfigured() || !process.env.SIGNNOW_WEBHOOK_SECRET) {
    return new NextResponse('Not found', { status: 404 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    await auditAnonymous('esign.webhook_rejected', { metadata: { reason: 'too_large' } });
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  if (!esign().verifyWebhook(raw, request.headers)) {
    // An unverified body is not parsed beyond nothing at all — as far as we
    // know it is not from SignNow.
    await auditAnonymous('esign.webhook_rejected', {
      metadata: { reason: 'bad_signature', bytes: raw.length },
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    await auditAnonymous('esign.webhook_rejected', { metadata: { reason: 'invalid_json' } });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const digest = signNowPayloadDigest(body);
  const event = esign().parseWebhook(body);
  if (!event) {
    // Recorded, not silently dropped: an event we could not read is worth
    // knowing about, and it is how an unhandled provider event gets noticed.
    await auditAnonymous('esign.webhook_unrecognised', { metadata: digest });
    return NextResponse.json({ status: 'ignored', detail: 'Unrecognised event.' }, { status: 202 });
  }

  try {
    const result = await applySignatureEvent(event, digest);
    if (!result.handled) {
      // Signed by SignNow but about a document we do not know — worth
      // recording against nothing, so it lands in the audit log instead.
      await auditAnonymous('esign.webhook_unmatched', {
        metadata: { ...digest, providerDocumentId: event.providerDocumentId },
      });
      return NextResponse.json({ status: 'unmatched', detail: result.reason }, { status: 202 });
    }
    await auditAnonymous('esign.webhook_applied', {
      metadata: { event: event.kind, requestId: result.requestId, detail: result.reason },
    });
    return NextResponse.json({ status: 'ok', detail: result.reason });
  } catch (error) {
    console.error('SignNow webhook failed', error);
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown error';
    const existing = await db.signatureRequest.findUnique({
      where: { providerDocumentId: event.providerDocumentId },
      select: { id: true },
    });
    if (existing) {
      await recordSignatureEvent({ requestId: existing.id, kind: 'ERROR', detail: message });
    }
    // 500 asks SignNow to retry; the idempotency key makes that safe.
    return NextResponse.json({ error: 'Could not process the event' }, { status: 500 });
  }
}
