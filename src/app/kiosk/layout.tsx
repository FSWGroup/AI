import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Time clock',
  // A wall tablet should never be indexed or previewed.
  robots: { index: false, follow: false },
};

/**
 * Kiosk shell. Shares nothing with the authenticated app: no nav, no session,
 * no way to reach another page. Large touch targets, high contrast — this is
 * used at 6am with gloves on.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-900 px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">
          FSW
        </span>
        <div>
          <div className="text-xl leading-tight font-semibold text-white">Time clock</div>
          <div className="text-[13px] text-ink-400">FS Welsford · ValveMan</div>
        </div>
      </div>
      <div className="w-full max-w-md rounded-card bg-white p-6 shadow-pop">{children}</div>
    </div>
  );
}
