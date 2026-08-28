import Link from "next/link";
import { requireAnyPermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { analyzeChangeImpact } from "@/lib/services/sop";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { RetrainingDecisionForm } from "@/app/(app)/admin/sops/[id]/impact/retraining-decision-form";

export const metadata = { title: "Change Impact" };

export default async function SopImpactPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAnyPermission(["sop.publish", "sop.create"]);
  const { id } = await params;

  const sop = await prisma.sop.findUnique({ where: { id }, select: { title: true, sopCode: true, isDeleted: true } });
  if (!sop || sop.isDeleted) {
    return (
      <>
        <PageHeader title="SOP not found" crumbs={[{ label: "Home", href: "/home" }, { label: "Admin" }, { label: "SOPs", href: "/admin/sops" }, { label: "Not found" }]} />
        <PageBody>
          <EmptyState
            icon={<Icon name="sop" className="h-5 w-5" />}
            title="This SOP doesn&rsquo;t exist"
            actions={
              <Link href="/admin/sops">
                <Button variant="secondary">Back to SOPs</Button>
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  const impact = await analyzeChangeImpact(actor, id);
  const canDecide = actor.permissions.has("training.assign");

  return (
    <>
      <PageHeader
        title={`Change impact — ${sop.title}`}
        description="Who and what is affected by changes to this SOP, and what retraining (if any) should follow."
        crumbs={[
          { label: "Home", href: "/home" },
          { label: "Admin" },
          { label: "SOPs", href: "/admin/sops" },
          { label: sop.sopCode, href: `/admin/sops/${id}/edit` },
          { label: "Impact" },
        ]}
        actions={
          <Link href={`/admin/sops/${id}/edit`}>
            <Button variant="secondary" size="sm">
              Back to editor
            </Button>
          </Link>
        }
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardContent>
            <SectionHeading title="This change impacts" level={3} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Courses", value: impact.courses.length },
                { label: "Learning paths", value: impact.paths.length },
                { label: "Employees", value: impact.userCount },
                { label: "Certifications", value: impact.certificationCount },
              ].map((stat) => (
                <div key={stat.label} className="rounded-md border border-[var(--border-subtle)] p-4 text-center">
                  <p className="text-[1.75rem] font-semibold text-[var(--text-primary)]">{stat.value}</p>
                  <p className="text-[0.75rem] text-[var(--text-muted)]">{stat.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {(impact.courses.length > 0 || impact.paths.length > 0) && (
          <Card>
            <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {impact.courses.length > 0 && (
                <div>
                  <SectionHeading title="Courses referencing this SOP" level={3} />
                  <ul className="flex flex-col gap-1.5">
                    {impact.courses.map((c) => (
                      <li key={c.id}>
                        <Link href={`/admin/training/${c.id}/edit`} className="text-[0.875rem] text-[var(--brand-secondary)] hover:underline">
                          {c.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {impact.paths.length > 0 && (
                <div>
                  <SectionHeading title="Learning paths containing this SOP" level={3} />
                  <ul className="flex flex-col gap-1.5">
                    {impact.paths.map((p) => (
                      <li key={p.id}>
                        <Link href={`/admin/paths/${p.id}/edit`} className="text-[0.875rem] text-[var(--brand-secondary)] hover:underline">
                          {p.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent>
            <SectionHeading
              title="Retraining decision"
              description="Choose what should happen for people who already acknowledged an older version."
              level={3}
            />
            {canDecide ? (
              <RetrainingDecisionForm sopId={id} affectedUserCount={impact.userCount} courses={impact.courses.map((c) => ({ id: c.id, title: c.title }))} />
            ) : (
              <p className="text-[0.8125rem] text-[var(--text-muted)]">You don&rsquo;t have permission to assign training. Ask a training administrator.</p>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
