import Link from 'next/link';
import { notFound } from 'next/navigation';
import { publishedPosting } from '@/lib/recruiting/postings';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const posting = await publishedPosting(id);
  return { title: posting ? posting.title : 'Role not found' };
}

function salaryLine(posting: {
  showSalary: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency: string;
}) {
  if (!posting.showSalary) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: posting.currency, maximumFractionDigits: 0 }).format(n);
  if (posting.salaryMin && posting.salaryMax) return `${fmt(posting.salaryMin)} – ${fmt(posting.salaryMax)}`;
  if (posting.salaryMin) return `From ${fmt(posting.salaryMin)}`;
  if (posting.salaryMax) return `Up to ${fmt(posting.salaryMax)}`;
  return null;
}

export default async function CareersPostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const posting = await publishedPosting(id);
  // An unpublished or closed role is simply not here — the same response an
  // id that never existed gets.
  if (!posting) notFound();

  const salary = salaryLine(posting);

  return (
    <article>
      <Link href="/careers" className="text-[13px] text-brand-700 hover:underline">
        ← All open roles
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-ink-900">{posting.title}</h1>
      <div className="mt-1 text-[13px] text-ink-600">
        {posting.location}
        {posting.department ? ` · ${posting.department}` : ''}
        {posting.employmentType ? ` · ${posting.employmentType.replace('_', ' ').toLowerCase()}` : ''}
        {posting.remoteType === 'REMOTE' ? ' · Remote' : posting.remoteType === 'HYBRID' ? ' · Hybrid' : ''}
      </div>
      {salary ? <div className="mt-1 text-[13px] font-medium text-ink-800">{salary}</div> : null}

      <div className="mt-6 rounded-card border border-ink-200 bg-white p-5">
        <div className="text-sm leading-relaxed whitespace-pre-wrap text-ink-800">{posting.description}</div>
        {posting.requirements ? (
          <>
            <h2 className="mt-6 text-[15px] font-semibold text-ink-900">What we&rsquo;re looking for</h2>
            <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-800">{posting.requirements}</div>
          </>
        ) : null}
      </div>

      <div className="mt-6 rounded-card border border-ink-200 bg-white p-5">
        <h2 className="text-[15px] font-semibold text-ink-900">How to apply</h2>
        <p className="mt-2 text-sm text-ink-700">
          Apply through the Indeed listing for this role, or email your résumé to{' '}
          <a className="text-brand-700 hover:underline" href={`mailto:${careersEmail()}`}>
            {careersEmail()}
          </a>{' '}
          with &ldquo;{posting.title}&rdquo; in the subject line.
        </p>
      </div>
    </article>
  );
}

/** Reuse the configured sender domain rather than inventing an address. */
function careersEmail(): string {
  const match = env.EMAIL_FROM.match(/<([^>]+)>/);
  const address = match ? match[1] : env.EMAIL_FROM;
  const domain = address.split('@')[1] ?? 'example.com';
  return `careers@${domain}`;
}
