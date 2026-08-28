import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: { template: `%s · ${'Careers'}`, default: 'Careers' },
};

/**
 * Public shell. Deliberately shares nothing with the authenticated app: no
 * nav, no session, no employee data — only the jobs a recruiter published.
 */
export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/careers" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-[13px] font-bold text-white">
              FSW
            </span>
            <span className="text-[15px] font-semibold text-ink-900">{env.INDEED_COMPANY_NAME} Careers</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-[12px] text-ink-500 sm:px-6">
        {env.INDEED_COMPANY_NAME} is an equal opportunity employer. We consider all qualified applicants without
        regard to any characteristic protected by applicable law.
      </footer>
    </div>
  );
}
