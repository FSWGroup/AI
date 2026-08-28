import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getSopDetailForEdit, listOutdatedReports, getSingleSopHealthScore, listPeopleForPicker } from "@/lib/services/sop";
import { PageHeader, PageBody } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { SopEditForm } from "@/app/(app)/admin/sops/[id]/edit/sop-edit-form";

export const metadata = { title: "Edit SOP" };

export default async function EditSopPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("sop.create");
  const { id } = await params;

  const sop = await getSopDetailForEdit(actor, id);
  if (!sop) {
    return (
      <>
        <PageHeader title="SOP not found" crumbs={[{ label: "Home", href: "/home" }, { label: "Admin" }, { label: "SOPs", href: "/admin/sops" }, { label: "Not found" }]} />
        <PageBody>
          <EmptyState
            icon={<Icon name="sop" className="h-5 w-5" />}
            title="This SOP doesn't exist"
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

  const [people, departments, businessUnits, outdatedReports, health] = await Promise.all([
    listPeopleForPicker(),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listOutdatedReports(id),
    getSingleSopHealthScore(id),
  ]);

  return (
    <>
      <PageHeader
        title={sop.title || "Untitled SOP"}
        description={`${sop.sopCode} · ${sop.kind === "POLICY" ? "Policy" : "SOP"}`}
        crumbs={[
          { label: "Home", href: "/home" },
          { label: "Admin" },
          { label: "SOPs", href: "/admin/sops" },
          { label: sop.sopCode },
        ]}
        actions={
          <Link href={`/sops/${id}`}>
            <Button variant="secondary" size="sm">
              View as reader
            </Button>
          </Link>
        }
      />
      <PageBody>
        <SopEditForm
          sopId={id}
          sopCode={sop.sopCode}
          status={sop.status}
          currentVersionNumber={sop.currentVersion?.versionNumber ?? null}
          initialIdentity={{
            title: sop.title,
            summary: sop.summary ?? "",
            category: sop.category ?? "",
            departmentId: sop.departmentId ?? "",
            businessUnitId: sop.businessUnitId ?? "",
            ownerId: sop.ownerId ?? "",
            smeId: sop.smeId ?? "",
            reviewerId: sop.reviewerId ?? "",
            approverId: sop.approverId ?? "",
            language: sop.language,
            reviewCycleDays: sop.reviewCycleDays ? String(sop.reviewCycleDays) : "",
          }}
          initialBlocks={sop.blocks}
          initialMeta={sop.meta}
          people={people}
          departments={departments}
          businessUnits={businessUnits}
          canApprove={actor.permissions.has("sop.approve")}
          canRequestChanges={actor.permissions.has("content.review") || actor.permissions.has("sop.approve")}
          canPublish={actor.permissions.has("sop.publish")}
          outdatedReports={outdatedReports}
          health={health}
        />
      </PageBody>
    </>
  );
}
