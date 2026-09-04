import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { getCompanyName } from "@/lib/org-settings";
import {
  LinkExpired,
  TokenPageShell,
  noIndexMetadata,
} from "@/components/careers/TokenPage";
import { CANDIDATE_CONSENT_STATEMENT } from "@/lib/interview-intel/consent";
import { InterviewConsentForm } from "@/components/careers/InterviewConsentForm";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Recording your interview");

export default async function InterviewConsentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [consent, company] = await Promise.all([
    prisma.interviewRecordingConsent.findUnique({
      where: { tokenHash: hashToken(token) },
      // The page was found BY the hash; it never needs to hold it. Leaving it
      // on the row puts it in the server component's payload.
      omit: { tokenHash: true },
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
    getCompanyName(),
  ]);

  if (!consent) {
    return (
      <LinkExpired>
        You may have already answered. If you would like to change your answer,
        tell your interviewer — they can stop the recording and delete it at any
        point, before, during or after.
      </LinkExpired>
    );
  }

  return (
    <TokenPageShell
      company={company}
      title={`May we record your interview, ${consent.interview.application.candidate.firstName}?`}
      subtitle={
        <>
          {consent.interview.title} for{" "}
          {consent.interview.application.requisition.title}
        </>
      }
    >
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
    </TokenPageShell>
  );
}
