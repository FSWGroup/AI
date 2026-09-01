import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { findPublicPosting } from "@/lib/ats/public-postings";
import { jobPostingJsonLd, postingDescriptionHtml } from "@/lib/ats/postings";
import { ApplicationForm } from "@/components/careers/ApplicationForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const posting = await findPublicPosting(reference);
  if (!posting) return { title: "Role not found" };
  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  const company = settings?.companyName ?? "FSW Group";
  return {
    title: `${posting.title} — ${company}`,
    description: posting.summary ?? `Apply for ${posting.title} at ${company}.`,
    robots: { index: true, follow: true },
  };
}

export default async function CareersPostingPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const [posting, settings] = await Promise.all([
    findPublicPosting(reference),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  if (!posting) notFound();

  const requisition = await prisma.requisition.findFirstOrThrow({
    where: { reference, status: "OPEN" },
    select: { id: true },
  });
  const questions = await prisma.screeningQuestion.findMany({
    where: { requisitionId: requisition.id },
    orderBy: { orderIndex: "asc" },
  });

  const company = settings?.companyName ?? "FSW Group";
  const jsonLd = jobPostingJsonLd(posting, {
    companyName: company,
    baseUrl: env.appBaseUrl,
    logoUrl: settings?.logoUrl,
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16">
      {/* Read by Google for Jobs and by aggregators that crawl rather than
          ingest a feed — the practical route onto boards with no API. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link href="/careers" className="text-sm font-semibold text-fsw-700 hover:underline">
        ← All roles
      </Link>

      <h1 className="mt-4 text-3xl font-bold text-navy-900">{posting.title}</h1>
      <p className="mt-2 text-navy-600">
        {[
          posting.departmentName,
          posting.locationName,
          posting.employmentType.replace(/_/g, " ").toLowerCase(),
          posting.workArrangement.toLowerCase(),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {posting.salaryPublish && posting.salaryMin != null && (
        <p className="mt-3 inline-block rounded-lg bg-fsw-50 px-3 py-1.5 text-sm font-semibold text-fsw-800">
          {posting.salaryCurrency} {posting.salaryMin.toLocaleString()}
          {posting.salaryMax != null ? `–${posting.salaryMax.toLocaleString()}` : ""} per{" "}
          {posting.salaryPeriod.toLowerCase()}
        </p>
      )}

      <div
        className="prose-fsw mt-8 space-y-4 text-navy-700 [&_h3]:mt-6 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-navy-900 [&_li]:ml-5 [&_li]:list-disc [&_p]:leading-relaxed [&_ul]:mt-2 [&_ul]:space-y-1"
        dangerouslySetInnerHTML={{ __html: postingDescriptionHtml(posting) }}
      />

      <div className="mt-12 border-t border-navy-100 pt-10">
        <h2 className="text-xl font-bold text-navy-900">Apply</h2>
        <ApplicationForm
          requisitionId={requisition.id}
          reference={posting.reference}
          questions={questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            kind: q.kind,
            required: q.required,
            choices: q.choices,
            helpText: q.helpText,
          }))}
        />
      </div>

      <p className="mt-12 text-xs leading-relaxed text-navy-400">
        {company} is an equal opportunity employer. We consider all qualified
        applicants without regard to any characteristic protected by law. If you
        need an adjustment to take part in our hiring process, say so in your
        application and we will arrange it.
      </p>
    </main>
  );
}
