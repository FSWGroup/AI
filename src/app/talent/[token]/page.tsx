import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { getCompanyName } from "@/lib/org-settings";
import {
  LinkExpired,
  TokenPageShell,
  noIndexMetadata,
} from "@/components/careers/TokenPage";
import { CONSENT_STATEMENT } from "@/lib/talent/consent";
import { TalentConsent } from "@/components/careers/TalentConsent";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Keeping in touch");

export default async function TalentConsentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [profile, company] = await Promise.all([
    prisma.talentProfile.findUnique({
      where: { consentTokenHash: hashToken(token) },
      include: { candidate: { select: { firstName: true } } },
    }),
    getCompanyName(),
  ]);

  if (!profile) {
    return (
      <LinkExpired>
        You may have already answered. If you would like {company} to stop
        contacting you about future roles, reply to any message from us and we
        will take care of it.
      </LinkExpired>
    );
  }

  return (
    <TokenPageShell
      company={company}
      title={`Shall we keep you in mind, ${profile.candidate.firstName}?`}
    >
      <div className="mt-6 space-y-4 leading-relaxed text-navy-700">
        {CONSENT_STATEMENT.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
      <TalentConsent token={token} company={company} />
    </TokenPageShell>
  );
}
