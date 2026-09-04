import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { getCompanyName } from "@/lib/org-settings";
import {
  LinkExpired,
  TokenPageShell,
  noIndexMetadata,
} from "@/components/careers/TokenPage";
import { SchedulePicker } from "@/components/careers/SchedulePicker";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Choose a time");

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [request, company] = await Promise.all([
    prisma.schedulingRequest.findUnique({
      where: { tokenHash: hashToken(token) },
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

  if (!request) {
    return (
      <LinkExpired>
        Please contact your recruiting contact at {company} and they will send
        you a new one.
      </LinkExpired>
    );
  }

  return (
    <TokenPageShell
      company={company}
      title={request.title}
      subtitle={
        <>
          For {request.application.requisition.title} ·{" "}
          {request.durationMinutes} minutes
        </>
      }
    >
      <SchedulePicker
        token={token}
        firstName={request.application.candidate.firstName}
        company={company}
      />
    </TokenPageShell>
  );
}
