import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { CONSENT_STATEMENT } from "@/lib/talent/consent";
import { TalentConsent } from "@/components/careers/TalentConsent";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Keeping in touch",
  robots: { index: false, follow: false },
};

export default async function TalentConsentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [profile, settings] = await Promise.all([
    prisma.talentProfile.findUnique({
      where: { consentTokenHash: hashToken(token) },
      include: { candidate: { select: { firstName: true } } },
    }),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  const company = settings?.companyName ?? "FSW Group";

  if (!profile) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">
            This link is no longer active
          </h1>
          <p className="mt-3 leading-relaxed text-navy-600">
            You may have already answered. If you would like {company} to stop
            contacting you about future roles, reply to any message from us and
            we will take care of it.
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
        Shall we keep you in mind, {profile.candidate.firstName}?
      </h1>
      <div className="mt-6 space-y-4 leading-relaxed text-navy-700">
        {CONSENT_STATEMENT.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
      <TalentConsent token={token} company={company} />
    </main>
  );
}
