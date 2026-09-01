/**
 * Aggregator job feed.
 *
 * One URL that Indeed and the wider programmatic-advertising ecosystem poll
 * on their own schedule. Handing a board this URL once means every future
 * role reaches it without anyone re-typing a posting — which is the whole
 * point of a feed, and why it beats scraping or manual posting.
 *
 * Only OPEN requisitions appear. A closed role vanishing from the feed is how
 * boards learn to take the posting down.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withErrorHandling } from "@/lib/api";
import { env } from "@/lib/env";
import { buildJobFeed } from "@/lib/ats/postings";
import { listPublicPostings } from "@/lib/ats/public-postings";

export const runtime = "nodejs";

export const GET = withErrorHandling(async () => {
  const [postings, settings] = await Promise.all([
    listPublicPostings(),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);

  const xml = buildJobFeed(postings, {
    companyName: settings?.companyName ?? "FSW Group",
    baseUrl: env.appBaseUrl,
  });

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Boards poll frequently; a short cache spares the database without
      // making a newly closed role linger.
      "Cache-Control": "public, max-age=600",
    },
  });
});
