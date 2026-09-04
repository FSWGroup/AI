import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { CANDIDATE_CONSENT_STATEMENT } from "@/lib/interview-intel/consent";
import { InterviewConsentForm } from "@/components/careers/InterviewConsentForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Recording your interview",
  robots: { index: false, follow: false },
};

export default async function InterviewConsentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [consent, settings] = await Promise.all([
    prisma.interviewRecordingConsent.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        interview: {
          include: {
            application: {
              include: {
                candidate: { select: { firstName: true } },
                requisition: { select: { title: true } },
              },
            },
          },
        },
      },
    }),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  const company = settings?.companyName ?? "FSW Group";

  if (!consent) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">
            This link is no longer active
          </h1>
          <p className="mt-3 leading-relaxed text-navy-600">
            You may have already answered. If you would like to change your
            answer, tell your interviewer — they can stop the recording and
            delete it at any point, before, during or after.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-fsw-600">
        {company}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-navy-900">
        May we record your interview, {consent.interview.application.candidate.firstName}?
      </h1>
      <p className="mt-1 text-sm text-navy-500">
        {consent.interview.title} for{" "}
        {consent.interview.application.requisition.title}
      </p>

      <div className="mt-6 space-y-4 leading-relaxed text-navy-700">
        {CANDIDATE_CONSENT_STATEMENT.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      <InterviewConsentForm
        token={token}
        company={company}
        current={consent.status as "PENDING" | "GRANTED" | "DECLINED" | "WITHDRAWN"}
      />
    </main>
  );
}
