import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { listPeople } from "@/lib/services/people";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/input";
import { Icon, Glyph } from "@/components/icons";
import { Pagination } from "@/components/people/pagination";
import { AdminPeopleTable, type AdminPersonRow } from "@/app/(app)/admin/people/admin-people-table";

export const metadata = { title: "Admin — People" };

type AdminPeopleSearchParams = {
  q?: string;
  departmentId?: string;
  workerType?: string;
  status?: string;
  page?: string;
};

export default async function AdminPeoplePage({ searchParams }: { searchParams: Promise<AdminPeopleSearchParams> }) {
  const actor = await requirePermission("people.edit");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [result, departments, managers, courses, sops, paths] = await Promise.all([
    listPeople(
      actor,
      {
        q: params.q,
        departmentId: params.departmentId || undefined,
        workerType: params.workerType || undefined,
        status: params.status || undefined,
      },
      page,
    ),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.course.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.sop.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.learningPath.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const rows: AdminPersonRow[] = result.people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    image: p.image,
    title: p.title,
    status: p.status,
    workerType: p.workerType,
    departmentName: p.departmentName,
    businessUnitName: p.businessUnitName,
    locationName: p.locationName,
    managerName: p.managerName,
  }));
  const hasFilters = Boolean(params.q || params.departmentId || params.workerType || params.status);

  return (
    <>
      <PageHeader
        title="People administration"
        description="Create, edit, and bulk-manage people records."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "People" }]}
        actions={
          <>
            <Link href="/admin/people/import">
              <Button variant="outline">
                <Glyph name="upload" className="h-4 w-4" /> Import CSV
              </Button>
            </Link>
            <Link href="/admin/people/new">
              <Button>
                <Glyph name="plus" className="h-4 w-4" /> New person
              </Button>
            </Link>
          </>
        }
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardContent>
            <form method="GET" action="/admin/people" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
              <Field label="Search" htmlFor="admin-people-q">
                <Input id="admin-people-q" name="q" placeholder="Name, email, employee ID…" defaultValue={params.q ?? ""} />
              </Field>
              <Field label="Department" htmlFor="admin-people-dept">
                <Select id="admin-people-dept" name="departmentId" defaultValue={params.departmentId ?? ""}>
                  <option value="">All</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Worker type" htmlFor="admin-people-wt">
                <Select id="admin-people-wt" name="workerType" defaultValue={params.workerType ?? ""}>
                  <option value="">All</option>
                  <option value="US_EMPLOYEE">US Employee</option>
                  <option value="US_CONTRACTOR">US Contractor</option>
                  <option value="PH_EMPLOYEE">PH Employee</option>
                  <option value="PH_CONTRACTOR">PH Contractor</option>
                  <option value="INTL_EMPLOYEE">Intl Employee</option>
                  <option value="INTL_CONTRACTOR">Intl Contractor</option>
                </Select>
              </Field>
              <Field label="Status" htmlFor="admin-people-status">
                <Select id="admin-people-status" name="status" defaultValue={params.status ?? ""}>
                  <option value="">All</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INVITED">Invited</option>
                  <option value="INACTIVE">Inactive</option>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full lg:w-auto">
                  <Glyph name="search" className="h-4 w-4" /> Search
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Icon name="people" className="h-5 w-5" />}
            title={hasFilters ? "No one matches those filters" : "No people yet"}
            description={hasFilters ? "Try a broader search or clear a filter." : "Create your first person or import a CSV."}
            actions={
              hasFilters ? (
                <Link href="/admin/people">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              ) : (
                <Link href="/admin/people/new">
                  <Button>New person</Button>
                </Link>
              )
            }
          />
        ) : (
          <AdminPeopleTable items={rows} departments={departments} managers={managers} courses={courses} sops={sops} paths={paths} />
        )}

        <Pagination basePath="/admin/people" searchParams={params} page={result.page} totalPages={totalPages} total={result.total} />
      </PageBody>
    </>
  );
}
