import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { listPeople } from "@/lib/services/people";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon, Glyph } from "@/components/icons";
import { PersonAvatar } from "@/components/people/avatar";
import { StatusBadge, WorkerTypeBadge } from "@/components/people/badges";
import { Pagination } from "@/components/people/pagination";

export const metadata = { title: "People Directory" };

interface PeopleSearchParams {
  q?: string;
  departmentId?: string;
  businessUnitId?: string;
  locationId?: string;
  workerType?: string;
  status?: string;
  page?: string;
}

export default async function PeoplePage({ searchParams }: { searchParams: Promise<PeopleSearchParams> }) {
  const actor = await requirePermission("people.view");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [result, departments, businessUnits, locations] = await Promise.all([
    listPeople(
      actor,
      {
        q: params.q,
        departmentId: params.departmentId || undefined,
        businessUnitId: params.businessUnitId || undefined,
        locationId: params.locationId || undefined,
        workerType: params.workerType || undefined,
        status: params.status || undefined,
      },
      page,
    ),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hasFilters = Boolean(
    params.q || params.departmentId || params.businessUnitId || params.locationId || params.workerType || params.status,
  );

  return (
    <>
      <PageHeader
        title="People"
        description="The people directory, scoped to what you're permitted to see."
        crumbs={[{ label: "Home", href: "/home" }, { label: "People" }]}
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardContent>
            <form
              method="GET"
              action="/people"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr_auto]"
            >
              <Field label="Search" htmlFor="people-q">
                <Input id="people-q" name="q" placeholder="Name, email, title…" defaultValue={params.q ?? ""} />
              </Field>
              <Field label="Business unit" htmlFor="people-bu">
                <Select id="people-bu" name="businessUnitId" defaultValue={params.businessUnitId ?? ""}>
                  <option value="">All</option>
                  {businessUnits.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Department" htmlFor="people-dept">
                <Select id="people-dept" name="departmentId" defaultValue={params.departmentId ?? ""}>
                  <option value="">All</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location" htmlFor="people-loc">
                <Select id="people-loc" name="locationId" defaultValue={params.locationId ?? ""}>
                  <option value="">All</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Worker type" htmlFor="people-wt">
                <Select id="people-wt" name="workerType" defaultValue={params.workerType ?? ""}>
                  <option value="">All</option>
                  <option value="US_EMPLOYEE">US Employee</option>
                  <option value="US_CONTRACTOR">US Contractor</option>
                  <option value="PH_EMPLOYEE">PH Employee</option>
                  <option value="PH_CONTRACTOR">PH Contractor</option>
                  <option value="INTL_EMPLOYEE">Intl Employee</option>
                  <option value="INTL_CONTRACTOR">Intl Contractor</option>
                </Select>
              </Field>
              <Field label="Status" htmlFor="people-status">
                <Select id="people-status" name="status" defaultValue={params.status ?? ""}>
                  <option value="">All</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INVITED">Invited</option>
                  <option value="INACTIVE">Inactive</option>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full lg:w-auto">
                  <Glyph name="search" className="h-4 w-4" />
                  Search
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {result.people.length === 0 ? (
          <EmptyState
            icon={<Icon name="people" className="h-5 w-5" />}
            title={hasFilters ? "No one matches those filters" : "No one is in your visible directory yet"}
            description={
              hasFilters
                ? "Try a broader search or clear a filter."
                : "People you manage — or the whole organization, depending on your access — will appear here."
            }
            actions={
              hasFilters ? (
                <Link href="/people">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.people.map((person) => (
              <Link key={person.id} href={`/people/${person.id}`} className="group block">
                <Card className="flex h-full flex-col transition-colors group-hover:border-[var(--border-strong)]">
                  <CardContent className="flex flex-1 items-start gap-3">
                    <PersonAvatar name={person.name} image={person.image} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] font-semibold text-[var(--text-primary)] group-hover:underline">
                        {person.name}
                      </p>
                      {person.title && <p className="truncate text-[0.8125rem] text-[var(--text-muted)]">{person.title}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={person.status} />
                        <WorkerTypeBadge workerType={person.workerType} />
                      </div>
                      <div className="mt-2 flex flex-col gap-0.5 text-[0.75rem] text-[var(--text-muted)]">
                        {person.departmentName && (
                          <span>
                            {person.departmentName}
                            {person.teamName ? ` · ${person.teamName}` : ""}
                          </span>
                        )}
                        {person.locationName && <span>{person.locationName}</span>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <Pagination basePath="/people" searchParams={params} page={result.page} totalPages={totalPages} total={result.total} />
      </PageBody>
    </>
  );
}
