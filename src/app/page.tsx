import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-navy-100 bg-white p-10 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-widest text-fsw-600">
          FSW Group
        </p>
        <h1 className="mt-2 text-3xl font-bold text-navy-900">
          FSW Talent Scout Assessment
        </h1>
        <p className="mt-4 text-navy-600">
          Candidates: please use the secure assessment link from your
          invitation email. Links cannot be created from this page.
        </p>
        <div className="mt-8">
          <Link
            href="/admin"
            className="inline-block rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-800"
          >
            Employer sign in
          </Link>
        </div>
        <p className="mt-8 text-xs text-navy-400">
          FSW Talent Scout is decision-support software and is not the sole basis
          for any employment decision.
        </p>
      </div>
    </main>
  );
}
