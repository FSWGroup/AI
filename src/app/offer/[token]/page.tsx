import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { OfferResponse } from "@/components/careers/OfferResponse";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your offer",
  robots: { index: false, follow: false },
};

export default async function OfferPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const offer = await prisma.offer.findUnique({
    where: { acceptTokenHash: hashToken(token) },
    include: {
      application: { include: { candidate: true } },
      template: { select: { acceptanceStatement: true } },
    },
  });

  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  const company = settings?.companyName ?? "FSW Group";

  if (!offer) {
    // A spent or wrong token. Deliberately vague: this page is public.
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">
            This link is no longer active
          </h1>
          <p className="mt-3 leading-relaxed text-navy-600">
            The link may have already been used, or the offer may have been
            withdrawn. Please contact your recruiting contact at {company} and
            they will help.
          </p>
        </div>
      </main>
    );
  }
  if (!offer.letterBody) notFound();

  const expired =
    offer.expiresAt != null && offer.expiresAt.getTime() < Date.now();

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-14">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-fsw-600">
        {company}
      </p>
      <h1 className="mt-2 text-3xl font-bold text-navy-900">
        Your offer of employment
      </h1>
      <p className="mt-2 text-navy-600">
        {offer.jobTitle}
        {offer.expiresAt && !expired && (
          <>
            {" · "}please respond by{" "}
            {new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
              offer.expiresAt,
            )}
          </>
        )}
      </p>

      <article className="mt-8 whitespace-pre-line rounded-2xl border border-navy-100 bg-white p-8 text-[15px] leading-relaxed text-navy-800">
        {offer.letterBody}
      </article>

      <div className="mt-8">
        <OfferResponse
          token={token}
          status={offer.status}
          expired={expired}
          candidateName={`${offer.application.candidate.firstName} ${offer.application.candidate.lastName}`}
          acceptanceStatement={
            offer.template?.acceptanceStatement ??
            "By accepting below I confirm I have read this offer and accept the terms described in it."
          }
        />
      </div>

      <p className="mt-10 text-xs leading-relaxed text-navy-400">
        Keep a copy of this letter for your records. If anything here does not
        match what you discussed, contact your recruiting contact before
        responding.
      </p>
    </main>
  );
}
