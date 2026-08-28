import Link from 'next/link';
import { publishedPostings } from '@/lib/recruiting/postings';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Open roles' };

export default async function CareersPage() {
  const postings = await publishedPostings();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink-900">Open roles</h1>
      <p className="mt-1 text-sm text-ink-600">
        {postings.length === 0
          ? `${env.INDEED_COMPANY_NAME} has no published openings right now.`
          : `${postings.length} open ${postings.length === 1 ? 'role' : 'roles'} at ${env.INDEED_COMPANY_NAME}.`}
      </p>

      <ul className="mt-6 space-y-3">
        {postings.map((posting) => (
          <li key={posting.postingId}>
            <Link
              href={`/careers/${posting.postingId}`}
              className="block rounded-card border border-ink-200 bg-white p-4 transition hover:border-brand-400 hover:shadow-pop"
            >
              <div className="text-[15px] font-semibold text-ink-900">{posting.title}</div>
              <div className="mt-1 text-[13px] text-ink-600">
                {posting.location}
                {posting.department ? ` · ${posting.department}` : ''}
                {posting.remoteType === 'REMOTE' ? ' · Remote' : posting.remoteType === 'HYBRID' ? ' · Hybrid' : ''}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
