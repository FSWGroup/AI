import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { getCompanyName } from "@/lib/org-settings";
import {
  LinkExpired,
  TokenPageShell,
  noIndexMetadata,
} from "@/components/careers/TokenPage";
import { CONSENT_STATEMENT } from "@/lib/ats/social-check";
import { SocialConsentForm } from "@/components/careers/SocialConsentForm";

export const dynamic = "force-dynamic";
export const metadata = noIndexMetadata("Social media check");

export default async function SocialCheckPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [check, company] = await Promise.all([
    prisma.socialMediaCheck.findUnique({
      where: { consentTokenHash: hashToken(token) },
      include: {
        application: {
          include: {
            candidate: { select: { firstName: true } },
            requisition: { select: { title: true } },
          },
        },
      },
    }),
    getCompanyName(),
  ]);

  if (!check) {
    return (
      <LinkExpired>
        It may already have been used. Contact your recruiting contact at{" "}
        {company} if you need it reissued.
      </LinkExpired>
    );
  }

  return (
    <TokenPageShell
      company={company}
      title="Social media check"
      subtitle={`For your application for ${check.application.requisition.title}`}
    >
      <div className="mt-8 whitespace-pre-line rounded-2xl border border-navy-100 bg-white p-6 text-[15px] leading-relaxed text-navy-700">
        {CONSENT_STATEMENT}
      </div>

      <div className="mt-8">
        <SocialConsentForm
          token={token}
          candidateFirstName={check.application.candidate.firstName}
          companyName={company}
        />
      </div>
    </TokenPageShell>
  );
}
