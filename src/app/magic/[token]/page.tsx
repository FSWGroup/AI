import { redirect } from 'next/navigation';
import Link from 'next/link';
import { consumeMagicLink } from '@/app/(auth)/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signing you in' };

export default async function MagicLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const outcome = await consumeMagicLink(token);

  if (outcome === 'SIGNED_IN') redirect('/');
  if (outcome === 'MFA_REQUIRED') redirect('/mfa');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-900 px-4 py-10">
      <div className="w-full max-w-sm rounded-card bg-white p-6 text-center shadow-pop">
        <h1 className="text-lg font-semibold text-ink-900">That link no longer works</h1>
        <p className="mt-2 text-[13px] text-ink-600">
          Sign-in links work once and expire after 15 minutes. Ask for a fresh one — it takes a moment.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-flex h-10 items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
