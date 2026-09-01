import Link from "next/link";
import { prisma } from "@/lib/db";
import { listPublicPostings } from "@/lib/ats/public-postings";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  const company = settings?.companyName ?? "FSW Group";
  return {
    title: `Careers at ${company}`,
    description: `Open roles at ${company}.`,
    robots: { index: true, follow: true },
  };
}

export default async function CareersIndexPage() {
  const [postings, settings] = await Promise.all([
    listPublicPostings(),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  const company = settings?.companyName ?? "FSW Group";

  const byDepartment = new Map<string, typeof postings>();
  for (const p of postings) {
    const key = p.departmentName ?? "Other";
    byDepartment.set(key, [...(byDepartment.get(key) ?? []), p]);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-fsw-600">
        {company}
      </p>
      <h1 className="mt-2 text-3xl font-bold text-navy-900">Open roles</h1>
      <p className="mt-3 text-navy-600">
        {postings.length === 0
          ? "There are no open roles right now. Please check back."
          : `${postings.length} role${postings.length === 1 ? "" : "s"} open.`}
      </p>

      <div className="mt-10 space-y-10">
        {[...byDepartment.entries()].map(([department, roles]) => (
          <section key={department}>
            <h2 className="text-xs font-bold uppercase tracking-widest text-navy-400">
              {department}
            </h2>
            <ul className="mt-3 divide-y divide-navy-100 border-y border-navy-100">
              {roles.map((r) => (
                <li key={r.reference}>
                  <Link
                    href={`/careers/${r.reference}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-4 hover:bg-navy-50"
                  >
                    <span>
                      <span className="block font-semibold text-navy-900">
                        {r.title}
                      </span>
                      {r.summary && (
                        <span className="mt-0.5 block text-sm text-navy-500">
                          {r.summary}
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-navy-500">
                      {r.locationName ?? "—"} ·{" "}
                      {r.workArrangement.toLowerCase()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-16 text-xs leading-relaxed text-navy-400">
        {company} is an equal opportunity employer. We consider all qualified
        applicants without regard to any characteristic protected by law. If you
        need an adjustment to take part in our hiring process, tell us in your
        application and we will arrange it.
      </p>
    </main>
  );
}
