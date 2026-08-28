import { requirePermission } from "@/lib/auth/guard";
import { PageHeader, PageBody } from "@/components/page-header";
import { ImportWizard } from "@/app/(app)/admin/people/import/import-wizard";

export const metadata = { title: "Import People" };

export default async function ImportPeoplePage() {
  await requirePermission("people.import");

  return (
    <>
      <PageHeader
        title="Import people"
        description="Upload a CSV, map its columns, review every row before anything is created, then commit."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "People", href: "/admin/people" }, { label: "Import" }]}
      />
      <PageBody>
        <ImportWizard />
      </PageBody>
    </>
  );
}
