import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { getManagerBrief, type BriefReason } from "@/lib/services/insights";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { PersonAvatar } from "@/components/people/avatar";

export const metadata: Metadata = { title: "This Week With Your Team" };

const REASON_LABEL: Record<BriefReason, string> = {
  AWAITING_SIGNOFF: "Waiting on you",
  OVERDUE: "Past due",
  STALLED: "Started, then stopped",
  READY_FOR_MORE: "Ready for more",
};

const REASON_TONE: Record<BriefReason, "danger" | "warning" | "blue" | "success"> = {
  AWAITING_SIGNOFF: "danger",
  OVERDUE: "warning",
  STALLED: "blue",
  READY_FOR_MORE: "success",
};

export default async function ManagerBriefPage() {
  const actor = await requirePermission("team.view");
  const brief = await getManagerBrief(actor);

  return (
    <>
      <PageHeader
        title="This week with your team"
        description="Named people, the evidence, and one conversation each. Read it in a couple of minutes; act on what you agree with."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Team", href: "/team" }, { label: "This Week" }]}
        meta={
          brief.items.length > 0 ? (
            <>
              {brief.totals.awaitingSignoff > 0 && (
                <Badge tone="danger" dot>
                  {brief.totals.awaitingSignoff} waiting on you
                </Badge>
              )}
              {brief.totals.overdue > 0 && (
                <Badge tone="warning" dot>
                  {brief.totals.overdue} past due
                </Badge>
              )}
              {brief.totals.stalled > 0 && (
                <Badge tone="blue" dot>
                  {brief.totals.stalled} stalled
                </Badge>
              )}
              {brief.totals.readyForMore > 0 && (
                <Badge tone="success" dot>
                  {brief.totals.readyForMore} ready for more
                </Badge>
              )}
            </>
          ) : undefined
        }
      />

      <PageBody className="flex flex-col gap-4">
        {brief.teamSize === 0 ? (
          <EmptyState
            icon={<Icon name="team" className="h-5 w-5" />}
            title="Nobody reports to you yet"
            description="When people are assigned to you as their manager, this page tells you who needs a conversation and why."
          />
        ) : brief.items.length === 0 ? (
          <EmptyState
            icon={<Icon name="approval" className="h-5 w-5" />}
            title="Nothing needs you this week"
            description={`All ${brief.teamSize} ${brief.teamSize === 1 ? "person" : "people"} in your reporting line are on track: nothing overdue, nothing stalled, nothing waiting on your sign-off.`}
            actions={
              <Link
                href="/team/status"
                className="inline-flex h-9.5 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                See the full training status
              </Link>
            }
          />
        ) : (
          <>
            <p className="text-[0.8125rem] text-[var(--text-muted)]">
              {brief.items.length} of {brief.teamSize}{" "}
              {brief.teamSize === 1 ? "person" : "people"} in your reporting line could use a
              conversation. This is a prompt, not an instruction — you know things the platform
              does not.
            </p>

            {/* Named so a screen reader announces what the list is, not just its length. */}
            <ul aria-label="People who could use a conversation" className="flex flex-col gap-3">
              {brief.items.map((item) => (
                <li key={`${item.userId}-${item.reason}`}>
                  <Card>
                    <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-4">
                      <PersonAvatar name={item.name} className="hidden shrink-0 sm:flex" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/people/${item.userId}`}
                            className="rounded-sm text-[0.9375rem] font-semibold text-[var(--text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                          >
                            {item.name}
                          </Link>
                          <Badge tone={REASON_TONE[item.reason]}>{REASON_LABEL[item.reason]}</Badge>
                        </div>

                        <p className="mt-2 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
                          {item.suggestedConversation}
                        </p>

                        {/*
                          The evidence is always shown. A manager who cannot see
                          why the platform said something has no way to disagree
                          with it, and sometimes they should.
                        */}
                        <dl className="mt-2.5">
                          <dt className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
                            Why this is here
                          </dt>
                          <dd className="mt-1">
                            <ul className="flex flex-col gap-0.5">
                              {item.evidence.map((line) => (
                                <li key={line} className="text-[0.8125rem] text-[var(--text-muted)]">
                                  {line}
                                </li>
                              ))}
                            </ul>
                          </dd>
                        </dl>
                      </div>

                      {item.reason === "AWAITING_SIGNOFF" && (
                        <Link
                          href="/team/approvals"
                          className="inline-flex h-9 shrink-0 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3.5 text-[0.8125rem] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                        >
                          Go to approvals
                        </Link>
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </PageBody>
    </>
  );
}
