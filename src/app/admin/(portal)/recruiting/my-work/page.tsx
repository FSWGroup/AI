import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Badge, Card, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);

/**
 * What this person owes the process: interviews to run, scorecards to file,
 * approvals to decide. Chasing these is most of a recruiting coordinator's
 * week, so the tool should do the chasing.
 */
export default async function MyWorkPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");

  const [interviews, scorecards, requisitionApprovals, offerApprovals] =
    await Promise.all([
      prisma.interview.findMany({
        where: {
          status: "SCHEDULED",
          participants: { some: { userId: user.id } },
        },
        orderBy: { scheduledAt: "asc" },
        include: {
          application: {
            include: {
              candidate: true,
              requisition: { select: { title: true } },
            },
          },
        },
        take: 25,
      }),
      prisma.scorecard.findMany({
        where: { authorId: user.id, status: "DRAFT" },
        orderBy: { createdAt: "asc" },
        include: {
          application: {
            include: {
              candidate: true,
              requisition: { select: { title: true } },
            },
          },
          interview: { select: { title: true, scheduledAt: true, status: true } },
        },
        take: 25,
      }),
      prisma.requisitionApproval.findMany({
        where: {
          approverId: user.id,
          decision: "PENDING",
          requisition: { status: "PENDING_APPROVAL" },
        },
        include: { requisition: true },
      }),
      prisma.offerApproval.findMany({
        where: {
          approverId: user.id,
          decision: "PENDING",
          offer: { status: "PENDING_APPROVAL" },
        },
        include: {
          offer: {
            include: { application: { include: { candidate: true } } },
          },
        },
      }),
    ]);

  const nothing =
    interviews.length === 0 &&
    scorecards.length === 0 &&
    requisitionApprovals.length === 0 &&
    offerApprovals.length === 0;

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeading
        eyebrow="Recruiting"
        title="My work"
        description="Interviews to run, scorecards to file, and decisions waiting on you."
      />

      {nothing && (
        <Card className="mt-6 p-8 text-center text-sm text-navy-400">
          Nothing is waiting on you.
        </Card>
      )}

      {requisitionApprovals.length > 0 && (
        <Card className="mt-6 p-6">
          <h2 className="text-sm font-bold text-navy-900">Requisitions to approve</h2>
          <ul className="mt-3 divide-y divide-navy-50 text-sm">
            {requisitionApprovals.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2.5">
                <Link
                  href={`/admin/recruiting/requisitions/${a.requisitionId}?tab=team`}
                  className="font-medium text-fsw-700 hover:underline"
                >
                  {a.requisition.title}
                </Link>
                <span className="text-xs text-navy-400">{a.requisition.reference}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {offerApprovals.length > 0 && (
        <Card className="mt-6 p-6">
          <h2 className="text-sm font-bold text-navy-900">Offers to approve</h2>
          <ul className="mt-3 divide-y divide-navy-50 text-sm">
            {offerApprovals.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2.5">
                <Link
                  href={`/admin/recruiting/offers/${a.offerId}`}
                  className="font-medium text-fsw-700 hover:underline"
                >
                  {a.offer.application.candidate.firstName}{" "}
                  {a.offer.application.candidate.lastName} — {a.offer.jobTitle}
                </Link>
                <span className="text-xs text-navy-400">{a.offer.reference}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {scorecards.length > 0 && (
        <Card className="mt-6 p-6">
          <h2 className="text-sm font-bold text-navy-900">Scorecards to file</h2>
          <p className="mt-1 text-xs text-navy-500">
            Write these up while the interview is fresh. A scorecard filed a week
            later is a memory of a memory.
          </p>
          <ul className="mt-3 divide-y divide-navy-50 text-sm">
            {scorecards.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5">
                <Link
                  href={`/admin/recruiting/scorecards/${s.id}`}
                  className="font-medium text-fsw-700 hover:underline"
                >
                  {s.application.candidate.firstName} {s.application.candidate.lastName}
                  <span className="ml-2 text-xs font-normal text-navy-400">
                    {s.application.requisition.title}
                  </span>
                </Link>
                {s.interview && (
                  <span className="text-xs text-navy-400">
                    {fmt(s.interview.scheduledAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {interviews.length > 0 && (
        <Card className="mt-6 p-6">
          <h2 className="text-sm font-bold text-navy-900">Upcoming interviews</h2>
          <ul className="mt-3 divide-y divide-navy-50 text-sm">
            {interviews.map((i) => (
              <li key={i.id} className="py-2.5">
                <div className="flex items-center justify-between">
                  <Link
                    href={`/admin/recruiting/applications/${i.applicationId}`}
                    className="font-medium text-fsw-700 hover:underline"
                  >
                    {i.application.candidate.firstName}{" "}
                    {i.application.candidate.lastName}
                  </Link>
                  <Badge tone="blue">{fmt(i.scheduledAt)}</Badge>
                </div>
                <p className="text-xs text-navy-500">
                  {i.title} · {i.application.requisition.title}
                  {i.meetingDetail ? ` · ${i.meetingDetail}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
