import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildFeedXml, indeedFeedEnabled, verifyFeedToken, INDEED_BOARD } from '@/lib/indeed';
import { publishedPostings } from '@/lib/recruiting/postings';
import { auditAnonymous } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * The XML job feed Indeed crawls (§16).
 *
 * Indeed cannot present a session cookie, so the URL itself carries a long
 * random token — the same pattern as our signed document links. Requests
 * without the token get 404, not 403: an unauthenticated caller learns
 * nothing about whether a feed exists here.
 *
 * The feed contains only what a jobseeker would see on the posting. Internal
 * requisition fields never leave this boundary.
 */
export async function GET(request: NextRequest) {
  if (!indeedFeedEnabled()) {
    return new NextResponse('Not found', { status: 404 });
  }
  const token = request.nextUrl.searchParams.get('token');
  if (!verifyFeedToken(token)) {
    await auditAnonymous('indeed.feed_denied', {
      metadata: { reason: token ? 'bad_token' : 'missing_token' },
    });
    return new NextResponse('Not found', { status: 404 });
  }

  const postings = await publishedPostings();
  const xml = buildFeedXml(postings);

  // Record that the feed was served so the UI can show when Indeed last
  // crawled us — the honest answer to "is my job on Indeed yet?".
  if (postings.length > 0) {
    await db.jobBoardPosting.updateMany({
      where: { id: { in: postings.map((p) => p.postingId) } },
      data: { lastFeedAt: new Date() },
    });
  }
  await db.jobBoardDelivery.create({
    data: {
      board: INDEED_BOARD,
      status: 'ACCEPTED',
      detail: `Feed served with ${postings.length} job(s).`,
      payloadDigest: { direction: 'outbound', jobs: postings.length },
    },
  });

  return new NextResponse(xml, {
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
