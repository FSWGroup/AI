import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { CONSENT_STATEMENT } from "@/lib/ats/social-check";
import { SocialConsentForm } from "@/components/careers/SocialConsentForm";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Social media check",
  robots: { index: false, follow: false },
};

export default async function SocialCheckPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [check, settings] = await Promise.all([
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
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  const company = settings?.companyName ?? "FSW Group";

  if (!check) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">
            This link is no longer active
          </h1>
          <p className="mt-3 leading-relaxed text-navy-600">
            It may already have been used. Contact your recruiting contact at{" "}
            {company} if you need it reissued.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-14">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-fsw-600">
        {company}
      </p>
      <h1 className="mt-2 text-3xl font-bold text-navy-900">
        Social media check
      </h1>
      <p className="mt-2 text-navy-600">
        For your application for {check.application.requisition.title}
      </p>

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
    </main>
  );
}
