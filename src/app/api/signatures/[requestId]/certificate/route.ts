import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCtx } from '@/lib/authz';
import { verifyDownload } from '@/lib/crypto';
import { storage } from '@/lib/storage';
import { audit } from '@/lib/audit';
import { canAccessDocument } from '@/app/(app)/documents/actions';

export const dynamic = 'force-dynamic';

/**
 * Download a signature's audit certificate.
 *
 * The signed PDF itself is a normal DocumentVersion and goes through the
 * existing document route. The certificate is a separate artifact, so it gets
 * its own endpoint — with exactly the same four checks: a valid session, a
 * valid HMAC token bound to this user, a fresh authorization check against the
 * parent document, and an audit entry on every download.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { requestId } = await params;
  const token = request.nextUrl.searchParams.get('t') ?? '';
  // The token is minted against the request id, so a token for one
  // certificate cannot fetch another.
  if (!verifyDownload({ versionId: requestId, userId: ctx.userId, token })) {
    return NextResponse.json({ error: 'This download link is invalid or has expired.' }, { status: 403 });
  }

  const signature = await db.signatureRequest.findUnique({
    where: { id: requestId },
    include: { documentVersion: { include: { document: true } } },
  });
  if (!signature?.certificateFileKey || signature.documentVersion.document.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!(await canAccessDocument(ctx, signature.documentVersion.document))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const data = await storage().get(signature.certificateFileKey);
  await audit(ctx, 'esign.certificate_downloaded', {
    targetType: 'SignatureRequest',
    targetId: requestId,
    metadata: { document: signature.documentVersion.document.title },
  });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="signature-certificate-${requestId.slice(0, 8)}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}
