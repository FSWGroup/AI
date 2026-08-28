import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, TD, TH, THead, TRow } from '@/components/ui';
import { SaveProfileButton, AddEntitlementButton, RemoveEntitlementButton, type ProfileShape } from './profile-ui';

export const metadata: Metadata = { title: 'Access profiles' };
export const dynamic = 'force-dynamic';

export default async function AccessProfilesPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'apps.admin');

  const [profiles, departments, apps] = await Promise.all([
    db.accessProfile.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { items: { include: { app: { select: { id: true, name: true } } } } },
    }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.softwareApp.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  const shapeOf = (p: (typeof profiles)[number]): ProfileShape => {
    const c = (p.criteria ?? {}) as { departmentIds?: string[]; workerTypes?: string[]; jobFamilies?: string[] };
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      active: p.active,
      departmentIds: c.departmentIds ?? [],
      workerTypes: c.workerTypes ?? [],
      jobFamilies: c.jobFamilies ?? [],
    };
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'App Access', href: '/apps' }, { label: 'Access profiles' }]}
        title="Access profiles"
        description="What each kind of role gets, as data rather than as tribal knowledge."
        actions={<SaveProfileButton departments={departments} />}
      />

      <Callout tone="info">
        Onboarding raises the grant tasks from these profiles; offboarding raises revoke tasks from what was actually
        granted. FSW People does not press the button in each vendor console — that needs their APIs — so a task with a
        named owner and an evidence record is the honest mechanism. The exception report is what catches whatever
        slipped.
      </Callout>

      <div className="mt-4 space-y-4">
        {profiles.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                title="No access profiles yet"
                description="Start with the roles you hire most: Warehouse Associate, Inside Sales, Driver."
                action={<SaveProfileButton departments={departments} />}
              />
            </CardBody>
          </Card>
        ) : (
          profiles.map((profile) => {
            const shape = shapeOf(profile);
            return (
              <Card key={profile.id} className={profile.active ? undefined : 'opacity-60'}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {profile.name}
                      {profile.active ? null : <Badge tone="gray">inactive</Badge>}
                    </span>
                  }
                  description={profile.description ?? undefined}
                  actions={
                    <div className="flex items-center gap-1">
                      <AddEntitlementButton profileId={profile.id} apps={apps} />
                      <SaveProfileButton profile={shape} departments={departments} />
                    </div>
                  }
                />
                <CardBody>
                  <div className="mb-3 flex flex-wrap gap-1.5 text-[12px]">
                    {shape.departmentIds.map((id) => (
                      <Badge key={id} tone="blue">{deptName.get(id) ?? 'department'}</Badge>
                    ))}
                    {shape.workerTypes.map((t) => (
                      <Badge key={t} tone="gray">{t.toLowerCase()}</Badge>
                    ))}
                    {shape.jobFamilies.map((f) => (
                      <Badge key={f} tone="gray">{f}</Badge>
                    ))}
                  </div>
                  {profile.items.length === 0 ? (
                    <EmptyState title="No entitlements yet" description="Add the applications this role needs." />
                  ) : (
                    <Table>
                      <THead>
                        <TH>Application</TH>
                        <TH>Access</TH>
                        <TH>Required</TH>
                        <TH />
                      </THead>
                      <tbody>
                        {profile.items.map((item) => (
                          <TRow key={item.id}>
                            <TD>{item.app.name}</TD>
                            <TD>{item.accessLevel.toLowerCase()}</TD>
                            <TD>{item.required ? <Badge tone="amber">required</Badge> : 'optional'}</TD>
                            <TD><RemoveEntitlementButton itemId={item.id} /></TD>
                          </TRow>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
