export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-900 px-4 py-10">
      <div className="mb-8 flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-[15px] font-bold text-white">
          FSW
        </span>
        <div>
          <div className="text-lg leading-tight font-semibold text-white">
            FSW <span className="text-brand-300">People</span>
          </div>
          <div className="text-[12px] text-ink-400">Everything about our people, in one place.</div>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-card bg-white p-6 shadow-pop">{children}</div>
      <p className="mt-8 text-[12px] text-ink-500">FSW Group · FS Welsford · ValveMan</p>
    </div>
  );
}
