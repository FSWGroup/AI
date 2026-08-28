import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCtx } from '@/lib/authz';
import { verifyDownload } from '@/lib/crypto';
import { storage } from '@/lib/storage';
import { audit } from '@/lib/audit';
import { canAccessDocument } from '@/app/(app)/documents/actions';

/**
 * Authenticated, signed, expiring document downloads (§4 Storage, §49).
 * Defense in depth: valid session AND valid HMAC token bound to this user
 * AND a fresh authorization check. Every download is audited.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { versionId } = await params;
  const token = request.nextUrl.searchParams.get('t') ?? '';
  if (!verifyDownload({ versionId, userId: ctx.userId, token })) {
    return NextResponse.json({ error: 'This download link is invalid or has expired.' }, { status: 403 });
  }

  const version = await db.documentVersion.findUnique({
    where: { id: versionId },
    include: { document: true },
  });
  if (!version || version.document.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!(await canAccessDocument(ctx, version.document))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const data = await storage().get(version.fileKey);
  await audit(ctx, 'document.downloaded', {
    targetType: 'DocumentVersion',
    targetId: versionId,
    metadata: { document: version.document.title, fileName: version.fileName },
  });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'content-type': version.mimeType,
      'content-disposition': `attachment; filename="${version.fileName.replace(/[^\w.\- ]/g, '_')}"`,
      'cache-control': 'private, no-store',
    },
  });
}
