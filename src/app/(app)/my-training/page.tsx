import Link from "next/link";
import { PageBody, PageHeader, SectionHeading } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Glyph, Icon } from "@/components/icons";
import { TrainingCard } from "@/components/training-card";
import { requireActor } from "@/lib/auth/guard";
import { getMyTraining } from "@/lib/services/my-training";
import { plural } from "@/lib/utils";

export const metadata = { title: "My Training" };

type Filter = "active" | "completed" | "all";

/**
 * The learner's assignment list.
 *
 * Grouped by urgency rather than by type, because the question a person opens
 * this page with is "what do I need to do", not "what courses exist".
 */
export default async function MyTrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const filter: Filter =
    params.filter === "completed" ? "completed" : params.filter === "all" ? "all" : "active";

  const training = await getMyTraining(actor);
  const { counts } = training;

  const tabs: { key: Filter; label: string; count: number }[] = [
    {
      key: "active",
      label: "To do",
      count: counts.overdue + counts.dueSoon + counts.inProgress + counts.notStarted,
    },
    { key: "completed", label: "Completed", count: counts.completed },
    { key: "all", label: "All", count: counts.total },
  ];

  const hasAnything = counts.total > 0;

  return (
    <>
      <PageHeader
        title="My Training"
        description="Everything assigned to you, grouped by what needs attention first."
        meta={
          hasAnything ? (
            <>
              {counts.overdue > 0 && (
                <Badge tone="danger" dot>
                  {counts.overdue} overdue
                </Badge>
              )}
              {counts.dueSoon > 0 && (
                <Badge tone="warning" dot>
                  {counts.dueSoon} due soon
                </Badge>
              )}
              {counts.inProgress > 0 && (
                <Badge tone="blue" dot>
                  {counts.inProgress} in progress
                </Badge>
              )}
              <Badge tone="success" dot>
                {counts.completed} completed
              </Badge>
            </>
          ) : undefined
        }
        actions={
          <Link
            href="/catalog"
            className="inline-flex h-9.5 items-center justify-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-primary)] shadow-xs hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <Glyph name="search" className="h-4 w-4" />
            Browse catalog
          </Link>
        }
      />

      <PageBody>
        {!hasAnything ? (
          <EmptyState
            icon={<Icon name="training" className="h-5 w-5" />}
            title="No training assigned yet"
            description="When your manager or an administrator assigns training, it appears here with a due date and the reason it was assigned. In the meantime you can explore the catalog or read published procedures."
            actions={
              <>
                <Link
                  href="/catalog"
                  className="inline-flex h-9.5 items-center rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  Browse the catalog
                </Link>
                <Link
                  href="/sops"
                  className="inline-flex h-9.5 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  Read the SOP library
                </Link>
              </>
            }
          />
        ) : (
          <>
            {/* Filter tabs as links so state lives in the URL and is shareable. */}
            <nav aria-label="Filter training" className="mb-5">
              <ul className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]">
                {tabs.map((tab) => {
                  const active = tab.key === filter;
                  return (
                    <li key={tab.key}>
                      <Link
                        href={`/my-training?filter=${tab.key}`}
                        aria-current={active ? "page" : undefined}
                        className={
                          active
                            ? "-mb-px flex items-center gap-2 border-b-2 border-[var(--brand-primary)] px-3.5 py-2.5 text-[0.8125rem] font-semibold text-[var(--text-primary)]"
                            : "-mb-px flex items-center gap-2 border-b-2 border-transparent px-3.5 py-2.5 text-[0.8125rem] font-medium text-[var(--text-muted)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]"
                        }
                      >
                        {tab.label}
                        <span
                          className={
                            active
                              ? "rounded-full bg-navy-100 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-navy-800"
                              : "rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[0.6875rem] font-medium text-[var(--text-muted)]"
                          }
                        >
                          {tab.count}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="flex flex-col gap-8">
              {(filter === "active" || filter === "all") && (
                <>
                  {training.overdue.length > 0 && (
                    <section aria-labelledby="overdue-heading">
                      <SectionHeading
                        title="Overdue"
                        description={`${training.overdue.length} ${plural(training.overdue.length, "item")} past ${plural(training.overdue.length, "its", "their")} due date.`}
                      />
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {training.overdue.map((item) => (
                          <TrainingCard
                            key={item.assignmentId}
                            item={item}
                            timezone={actor.timezone}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {training.dueSoon.length > 0 && (
                    <section aria-labelledby="due-soon-heading">
                      <SectionHeading
                        title="Due soon"
                        description="Coming up in the next two weeks."
                      />
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {training.dueSoon.map((item) => (
                          <TrainingCard
                            key={item.assignmentId}
                            item={item}
                            timezone={actor.timezone}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {training.inProgress.length > 0 && (
                    <section aria-labelledby="in-progress-heading">
                      <SectionHeading title="In progress" description="Pick up where you left off." />
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {training.inProgress.map((item) => (
                          <TrainingCard
                            key={item.assignmentId}
                            item={item}
                            timezone={actor.timezone}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {training.notStarted.length > 0 && (
                    <section aria-labelledby="not-started-heading">
                      <SectionHeading title="Not started" description="No immediate deadline." />
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {training.notStarted.map((item) => (
                          <TrainingCard
                            key={item.assignmentId}
                            item={item}
                            timezone={actor.timezone}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {filter === "active" &&
                    training.overdue.length === 0 &&
                    training.dueSoon.length === 0 &&
                    training.inProgress.length === 0 &&
                    training.notStarted.length === 0 && (
                      <EmptyState
                        icon={<Glyph name="check" className="h-5 w-5" />}
                        title="You're all caught up"
                        description="Nothing is outstanding. Your completed training and certificates stay on record."
                        actions={
                          <>
                            <Link
                              href="/my-training?filter=completed"
                              className="inline-flex h-9.5 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                            >
                              View completed training
                            </Link>
                            <Link
                              href="/catalog"
                              className="inline-flex h-9.5 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                            >
                              Browse the catalog
                            </Link>
                          </>
                        }
                      />
                    )}
                </>
              )}

              {(filter === "completed" || filter === "all") && (
                <section aria-labelledby="completed-heading">
                  <SectionHeading
                    title="Completed"
                    description="Your completion records are permanent and survive later changes to the training."
                    actions={
                      <Link
                        href="/transcript"
                        className="text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline"
                      >
                        Full transcript
                      </Link>
                    }
                  />
                  {training.completed.length === 0 ? (
                    <EmptyState
                      icon={<Icon name="certificate" className="h-5 w-5" />}
                      title="Nothing completed yet"
                      description="Finish an assigned course and it will appear here, along with any certificate it earns."
                      actions={
                        <Link
                          href="/my-training"
                          className="inline-flex h-9.5 items-center rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                        >
                          See what's assigned
                        </Link>
                      }
                    />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {training.completed.map((item) => (
                        <TrainingCard
                          key={item.assignmentId}
                          item={item}
                          timezone={actor.timezone}
                          showReason={false}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {filter === "all" && training.waived.length > 0 && (
                <section aria-labelledby="waived-heading">
                  <SectionHeading
                    title="Waived"
                    description="An administrator recorded an exception for these."
                  />
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {training.waived.map((item) => (
                      <TrainingCard
                        key={item.assignmentId}
                        item={item}
                        timezone={actor.timezone}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
