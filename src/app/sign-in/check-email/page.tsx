import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { FswMark } from "@/components/icons";

export const metadata = { title: "Check your email" };

export default async function CheckEmailPage() {
  const settings = await getSettings();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 inline-flex rounded-md bg-navy-900 px-3 py-2">
          <FswMark appName={settings.brand.appName} />
        </div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Check your email</h1>
        <p className="mt-2.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
          If the address you entered belongs to an active {settings.brand.appName} account, a
          single-use sign-in link is on its way. It expires in 24 hours.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 inline-block text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
