import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { listSopVersions, compareVersions, SopValidationError } from "@/lib/services/sop";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { CompareForm } from "@/app/(app)/sops/[id]/versions/compare-form";

export default async function SopVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ compare?: string }>;
}) {
  await requirePermission("sop.view");
  const { id } = await params;
  const { compare } = await searchParams;

  const [sop, versions] = await Promise.all([
    prisma.sop.findUnique({ where: { id }, select: { title: true, sopCode: true, isDeleted: true } }),
    listSopVersions(id),
  ]);

  if (!sop || sop.isDeleted) {
    return (
      <>
        <PageHeader title="Version history" crumbs={[{ label: "Home", href: "/home" }, { label: "SOP Library", href: "/sops" }, { label: "Not found" }]} />
        <PageBody>
          <EmptyState icon={<Icon name="sop" className="h-5 w-5" />} title="This SOP isn't available" />
        </PageBody>
      </>
    );
  }

  const [versionAId, versionBId] = (compare ?? "").split(",").map((v) => v.trim());
  let diff: Awaited<ReturnType<typeof compareVersions>> | null = null;
  let diffError: string | null = null;
  if (versionAId && versionBId) {
    try {
      diff = await compareVersions(id, versionAId, versionBId);
    } catch (error) {
      diffError = error instanceof SopValidationError ? error.message : "Could not compare those versions.";
    }
  }

  return (
    <>
      <PageHeader
        title={`Version history — ${sop.title}`}
        crumbs={[
          { label: "Home", href: "/home" },
          { label: "SOP Library", href: "/sops" },
          { label: sop.sopCode, href: `/sops/${id}` },
          { label: "Versions" },
        ]}
        actions={
          <Link href={`/sops/${id}`}>
            <Button variant="secondary" size="sm">
              Back to SOP
            </Button>
          </Link>
        }
      />
      <PageBody className="flex flex-col gap-5">
        {versions.length === 0 ? (
          <EmptyState icon={<Icon name="audit" className="h-5 w-5" />} title="No published versions yet" description="Version history appears once this SOP has been published at least once." />
        ) : (
          <>
            <Card>
              <CardContent className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.8125rem]">
                  <thead>
                    <tr>
                      <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">Version</th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">Published</th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">Author</th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">Approver</th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] py-2 text-left">Change summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id}>
                        <td className="border-b border-[var(--border-subtle)] py-2 pr-3 align-top">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-[var(--text-primary)]">v{v.versionNumber}</span>
                            <Badge tone={v.isMaterial ? "warning" : "neutral"}>{v.isMaterial ? "Major" : "Minor"}</Badge>
                          </div>
                        </td>
                        <td className="border-b border-[var(--border-subtle)] py-2 pr-3 align-top">{new Date(v.publishedAt).toLocaleString()}</td>
                        <td className="border-b border-[var(--border-subtle)] py-2 pr-3 align-top">{v.author?.name ?? "—"}</td>
                        <td className="border-b border-[var(--border-subtle)] py-2 pr-3 align-top">{v.approver?.name ?? "—"}</td>
                        <td className="border-b border-[var(--border-subtle)] py-2 align-top">{v.changeSummary || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <SectionHeading title="Compare two versions" level={3} />
                <CompareForm versions={versions} defaultA={versionAId} defaultB={versionBId} />
              </CardContent>
            </Card>

            {diffError && (
              <div role="alert" className="rounded-md border border-danger-100 bg-danger-50 px-4 py-3 text-[0.8125rem] text-danger-700">
                {diffError}
              </div>
            )}

            {diff && (
              <Card>
                <CardContent className="flex flex-col gap-5">
                  <SectionHeading
                    title={`Changes from v${diff.versionA.versionNumber} to v${diff.versionB.versionNumber}`}
                    description={`${diff.added.length} added · ${diff.removed.length} removed · ${diff.changed.length} changed · ${diff.unchangedCount} unchanged`}
                    level={3}
                  />

                  {diff.changed.length === 0 && diff.added.length === 0 && diff.removed.length === 0 ? (
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">No content differences between these versions.</p>
                  ) : (
                    <>
                      {diff.changed.map((change) => (
                        <div key={change.blockId} className="rounded-md border border-warning-100 bg-warning-50 p-3">
                          <p className="mb-1.5 text-[0.75rem] font-semibold uppercase tracking-wide text-warning-700">Changed</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <p className="whitespace-pre-wrap text-[0.8125rem] text-[var(--text-secondary)] line-through decoration-danger-400">
                              {change.beforeText || "(empty)"}
                            </p>
                            <p className="whitespace-pre-wrap text-[0.8125rem] text-[var(--text-primary)]">{change.afterText || "(empty)"}</p>
                          </div>
                        </div>
                      ))}
                      {diff.added.map((add) => (
                        <div key={add.blockId} className="rounded-md border border-success-100 bg-success-50 p-3">
                          <p className="mb-1.5 text-[0.75rem] font-semibold uppercase tracking-wide text-success-700">Added</p>
                          <p className="whitespace-pre-wrap text-[0.8125rem] text-[var(--text-primary)]">{add.afterText || "(empty)"}</p>
                        </div>
                      ))}
                      {diff.removed.map((rem) => (
                        <div key={rem.blockId} className="rounded-md border border-danger-100 bg-danger-50 p-3">
                          <p className="mb-1.5 text-[0.75rem] font-semibold uppercase tracking-wide text-danger-700">Removed</p>
                          <p className="whitespace-pre-wrap text-[0.8125rem] text-[var(--text-secondary)] line-through">{rem.beforeText || "(empty)"}</p>
                        </div>
                      ))}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
