import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { getCompanyName } from "@/lib/org-settings";
import {
  LinkExpired,
  TokenPageShell,
  noIndexMetadata,
} from "@/components/careers/TokenPage";
import { OfferResponse } from "@/components/careers/OfferResponse";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Your offer");

export default async function OfferPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const offer = await prisma.offer.findUnique({
    where: { acceptTokenHash: hashToken(token) },
    // The page was found BY the hash; it never needs to hold it. Leaving it
    // on the row puts it in the server component's payload.
    omit: { acceptTokenHash: true },
    include: {
      application: { include: { candidate: true } },
      template: { select: { acceptanceStatement: true } },
    },
  });

  const company = await getCompanyName();

  if (!offer) {
    // A spent or wrong token. Deliberately vague: this page is public.
    return (
      <LinkExpired>
        The link may have already been used, or the offer may have been
        withdrawn. Please contact your recruiting contact at {company} and they
        will help.
      </LinkExpired>
    );
  }
  if (!offer.letterBody) notFound();

  const expired =
    offer.expiresAt != null && offer.expiresAt.getTime() < Date.now();

  return (
    <TokenPageShell
      company={company}
      title="Your offer of employment"
      subtitle={
        <>
          {offer.jobTitle}
          {offer.expiresAt && !expired && (
            <>
              {" · "}please respond by{" "}
              {new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
                offer.expiresAt,
              )}
            </>
          )}
        </>
      }
      wide
    >
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
    </TokenPageShell>
  );
}
