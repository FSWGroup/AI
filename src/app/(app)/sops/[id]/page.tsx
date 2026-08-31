import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getSopForReader } from "@/lib/services/sop";
import { getNearMissesForSop, SEVERITY_LABELS } from "@/lib/services/near-miss";
import { BlockRenderer } from "@/lib/content/render";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, Glyph } from "@/components/icons";
import { FavoriteButton } from "@/app/(app)/sops/favorite-button";
import { ReportOutdatedDialog } from "@/app/(app)/sops/[id]/report-outdated-dialog";
import { FeedbackButtons } from "@/app/(app)/sops/[id]/feedback-buttons";
import { PrintButton } from "@/app/(app)/sops/[id]/print-button";

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "blue",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

export default async function SopReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("sop.view");
  const { id } = await params;

  const sop = await getSopForReader(actor, id);

  if (!sop) {
    return (
      <>
        <PageHeader title="SOP not found" crumbs={[{ label: "Home", href: "/home" }, { label: "SOP Library", href: "/sops" }, { label: "Not found" }]} />
        <PageBody>
          <EmptyState
            icon={<Icon name="sop" className="h-5 w-5" />}
            title="This SOP isn't available"
            description="It may have been archived, or it's still a draft you don't have permission to preview."
            actions={
              <Link href="/sops">
                <Button variant="secondary">Back to the library</Button>
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  const [favorite, relatedSops, relatedCourses, nearMisses] = await Promise.all([
    prisma.favorite.findUnique({ where: { userId_entityType_entityId: { userId: actor.id, entityType: "SOP", entityId: id } } }),
    sop.meta.relatedSopIds.length > 0
      ? prisma.sop.findMany({ where: { id: { in: sop.meta.relatedSopIds }, isDeleted: false }, select: { id: true, title: true, sopCode: true } })
      : Promise.resolve([]),
    sop.meta.relatedCourseIds.length > 0
      ? prisma.course.findMany({ where: { id: { in: sop.meta.relatedCourseIds }, isDeleted: false }, select: { id: true, title: true } })
      : Promise.resolve([]),
    // Returns [] rather than throwing for a reader without nearmiss.view, so
    // the SOP still renders for a contractor.
    getNearMissesForSop(actor, id),
  ]);

  const canEdit = actor.permissions.has("sop.create");
  const actions = [
    { label: "Train on This", href: `/admin/training/new?fromSop=${id}`, permission: "training.create" as const },
    { label: "Create Course", href: `/admin/training/new?fromSop=${id}`, permission: "training.create" as const },
    { label: "Create Quiz", href: `/admin/training/new?fromSop=${id}&focus=quiz`, permission: "training.create" as const },
    { label: "Create AI Video", href: `/admin/video-studio/new?sopId=${id}`, permission: "ai.video" as const },
    { label: "Generate Quick Reference", href: `/admin/ai-studio?type=quick_reference&sopId=${id}`, permission: "ai.generate" as const },
    { label: "Translate", href: `/admin/ai-studio?type=translate&sopId=${id}`, permission: "ai.generate" as const },
    { label: "Assign", href: `/admin/training/assign?sopId=${id}`, permission: "training.assign" as const },
    { label: "Ask FSW AI", href: `/ask?q=${encodeURIComponent(`Tell me about ${sop.title}`)}&sopId=${id}`, permission: "ai.ask" as const },
  ].filter((action) => actor.permissions.has(action.permission));

  return (
    <>
      <PageHeader
        title={sop.title}
        crumbs={[{ label: "Home", href: "/home" }, { label: "SOP Library", href: "/sops" }, { label: sop.sopCode }]}
        meta={
          <>
            <Badge tone={STATUS_TONE[sop.status] ?? "neutral"}>{sop.isDraft ? "Draft preview" : sop.status.replace(/_/g, " ")}</Badge>
            <Badge tone="navy">{sop.sopCode}</Badge>
            <Badge tone="neutral">v{sop.versionNumber}</Badge>
          </>
        }
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <FavoriteButton sopId={id} initialFavorited={Boolean(favorite)} variant="labeled" />
            <PrintButton />
            {canEdit && (
              <Link href={`/admin/sops/${id}/edit`}>
                <Button variant="secondary" size="sm">
                  <Glyph name="edit" className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </Link>
            )}
          </div>
        }
      />
      <PageBody className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-5">
          {sop.isDraft && (
            <div role="note" className="rounded-md border border-info-100 bg-info-50 px-4 py-2.5 text-[0.8125rem] text-info-700 print:hidden">
              You&rsquo;re viewing the unpublished draft. Learners see the last published version instead.
            </div>
          )}

          <Card as="article">
            <CardContent>
              {sop.summary && <p className="mb-4 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">{sop.summary}</p>}
              <BlockRenderer blocks={sop.blocks} />
            </CardContent>
          </Card>

          {(sop.meta.purpose ||
            sop.meta.scope ||
            sop.meta.definitions.length > 0 ||
            sop.meta.prerequisites.length > 0 ||
            sop.meta.requiredTools.length > 0 ||
            sop.meta.safetyConsiderations ||
            sop.meta.troubleshooting.length > 0 ||
            sop.meta.exceptions) && (
            <Card>
              <CardContent className="flex flex-col gap-5">
                {sop.meta.purpose && (
                  <section>
                    <SectionHeading title="Purpose" level={3} />
                    <p className="text-[0.875rem] leading-relaxed text-[var(--text-primary)]">{sop.meta.purpose}</p>
                  </section>
                )}
                {sop.meta.scope && (
                  <section>
                    <SectionHeading title="Scope" level={3} />
                    <p className="text-[0.875rem] leading-relaxed text-[var(--text-primary)]">{sop.meta.scope}</p>
                  </section>
                )}
                {sop.meta.definitions.length > 0 && (
                  <section>
                    <SectionHeading title="Definitions" level={3} />
                    <dl className="flex flex-col gap-2">
                      {sop.meta.definitions.map((def, i) => (
                        <div key={i}>
                          <dt className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{def.term}</dt>
                          <dd className="text-[0.8125rem] text-[var(--text-secondary)]">{def.definition}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
                {sop.meta.prerequisites.length > 0 && (
                  <section>
                    <SectionHeading title="Prerequisites" level={3} />
                    <ul className="list-disc pl-5 text-[0.875rem] text-[var(--text-primary)]">
                      {sop.meta.prerequisites.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {sop.meta.requiredTools.length > 0 && (
                  <section>
                    <SectionHeading title="Required tools" level={3} />
                    <ul className="list-disc pl-5 text-[0.875rem] text-[var(--text-primary)]">
                      {sop.meta.requiredTools.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {sop.meta.safetyConsiderations && (
                  <section>
                    <SectionHeading title="Safety considerations" level={3} />
                    <p className="text-[0.875rem] leading-relaxed text-[var(--text-primary)]">{sop.meta.safetyConsiderations}</p>
                  </section>
                )}
                {sop.meta.troubleshooting.length > 0 && (
                  <section>
                    <SectionHeading title="Troubleshooting" level={3} />
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[0.8125rem]">
                        <thead>
                          <tr>
                            <th scope="col" className="border-b border-[var(--border-subtle)] py-1.5 pr-3 text-left">
                              Problem
                            </th>
                            <th scope="col" className="border-b border-[var(--border-subtle)] py-1.5 text-left">
                              Resolution
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sop.meta.troubleshooting.map((row, i) => (
                            <tr key={i}>
                              <td className="border-b border-[var(--border-subtle)] py-1.5 pr-3 align-top">{row.problem}</td>
                              <td className="border-b border-[var(--border-subtle)] py-1.5 align-top">{row.resolution}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {sop.meta.exceptions && (
                  <section>
                    <SectionHeading title="Exceptions" level={3} />
                    <p className="text-[0.875rem] leading-relaxed text-[var(--text-primary)]">{sop.meta.exceptions}</p>
                  </section>
                )}
              </CardContent>
            </Card>
          )}

          {/*
            Why this procedure exists. A step that reads like bureaucracy is far
            easier to follow when the day it would have saved is next to it.
          */}
          {nearMisses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Why this procedure exists</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-[0.8125rem] text-[var(--text-muted)]">
                  Near misses this procedure is meant to prevent. Nobody is named in any of them.
                </p>
                <ul aria-label="Near misses this procedure prevents" className="flex flex-col gap-2.5">
                  {nearMisses.map((item) => (
                    <li key={item.id} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="navy">{item.reference}</Badge>
                        <Badge tone="neutral">{SEVERITY_LABELS[item.severity]}</Badge>
                      </div>
                      <Link
                        href={`/near-misses/${item.reference}`}
                        className="rounded-sm text-[0.875rem] font-medium text-[var(--text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        {item.title}
                      </Link>
                      {item.whatChanged && (
                        <p className="line-clamp-2 text-[0.8125rem] text-[var(--text-muted)]">
                          {item.whatChanged}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {(relatedSops.length > 0 || relatedCourses.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Related</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {relatedSops.map((r) => (
                  <Link key={r.id} href={`/sops/${r.id}`} className="text-[0.875rem] text-[var(--brand-secondary)] hover:underline">
                    {r.sopCode} — {r.title}
                  </Link>
                ))}
                {relatedCourses.map((c) => (
                  <Link key={c.id} href={`/courses/${c.id}`} className="text-[0.875rem] text-[var(--brand-secondary)] hover:underline">
                    {c.title}
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="print:hidden">
            <CardContent className="flex flex-col gap-4">
              <FeedbackButtons sopId={id} />
              <ReportOutdatedDialog sopId={id} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4 print:hidden">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-3 text-[0.8125rem]">
                <div>
                  <dt className="text-[var(--text-muted)]">Owner</dt>
                  <dd className="font-medium text-[var(--text-primary)]">{sop.owner?.name ?? "Unassigned"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Subject matter expert</dt>
                  <dd className="font-medium text-[var(--text-primary)]">{sop.sme?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Reviewer</dt>
                  <dd className="font-medium text-[var(--text-primary)]">{sop.reviewer?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Approver</dt>
                  <dd className="font-medium text-[var(--text-primary)]">{sop.approver?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Department</dt>
                  <dd className="font-medium text-[var(--text-primary)]">{sop.departmentName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Version</dt>
                  <dd className="font-medium text-[var(--text-primary)]">{sop.versionNumber}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Last reviewed</dt>
                  <dd className="font-medium text-[var(--text-primary)]">
                    {sop.lastReviewedAt ? new Date(sop.lastReviewedAt).toLocaleDateString() : "Never"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Next review</dt>
                  <dd className="font-medium text-[var(--text-primary)]">
                    {sop.nextReviewAt ? new Date(sop.nextReviewAt).toLocaleDateString() : "—"}
                  </dd>
                </div>
              </dl>
              <Link href={`/sops/${id}/versions`} className="mt-3 inline-flex items-center gap-1 text-[0.8125rem] text-[var(--brand-secondary)] hover:underline">
                <Glyph name="clock" className="h-3.5 w-3.5" />
                Version history
              </Link>
            </CardContent>
          </Card>

          {actions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {actions.map((action) => (
                  <Link key={action.label} href={action.href}>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      {action.label}
                    </Button>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </PageBody>
    </>
  );
}
