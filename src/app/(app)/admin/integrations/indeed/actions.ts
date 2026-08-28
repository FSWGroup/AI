'use server';

import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { indeedFeedUrl } from '@/lib/indeed';

/**
 * The feed URL embeds the crawl token, so it is a credential. It is never
 * rendered into the page by default — an admin has to ask for it, and the
 * request is audited like any other secret reveal.
 */
export async function revealFeedUrlAction(): Promise<{ error?: string; url?: string }> {
  try {
    const ctx = await requirePermission('settings.admin');
    const url = indeedFeedUrl();
    if (!url) return { error: 'INDEED_FEED_TOKEN is not set, so there is no feed URL yet.' };
    await audit(ctx, 'integration.secret_revealed', {
      targetType: 'Integration',
      targetId: 'INDEED',
      metadata: { secret: 'feed_url' },
    });
    return { url };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not build the feed URL.' };
  }
}
