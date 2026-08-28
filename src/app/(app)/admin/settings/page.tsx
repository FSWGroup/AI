import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { PERMISSIONS, ROLE_DEFS } from '@/lib/authz/catalog';
import { fmtDate, fullName, humanize } from '@/lib/format';
import {
  Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD, cx,
} from '@/components/ui';
import {
  OrgForm, EntityForm, DepartmentForm, LocationForm, HolidayForm, PtoPolicyForm, AssignPtoForm,
  UserRolesForm, UserStatusForm, ResendInviteButton, InviteWorkerForm, RolePermissionsForm,
  CustomFieldForm, DisableFieldButton,
} from './settings-ui';

export const metadata: Metadata = { title: 'Settings' };

const SECTIONS = [
  { key: 'organization', label: 'Organization', permission: 'org.admin' },
  { key: 'structure', label: 'Departments & locations', permission: 'org.admin' },
  { key: 'holidays', label: 'Holidays', permission: 'org.admin' },
  { key: 'pto', label: 'PTO policies', permission: 'pto.admin' },
  { key: 'users', label: 'Users & roles', permission: 'users.admin' },
  { key: 'permissions', label: 'Permissions', permission: 'settings.admin' },
  { key: 'fields', label: 'Custom fields', permission: 'settings.admin' },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'org.admin');
  const params = await searchParams;

  const visible = SECTIONS.filter((s) => can(ctx, s.permission as never));
  const section = visible.some((s) => s.key === params.section) ? params.section! : visible[0]?.key ?? 'organization';

  const org = await db.organization.findFirst();
  const branding = (org?.branding ?? {}) as Record<string, string>;

  return (
    <div>
      <PageHeader title="Settings" description="Every value here is configurable — nothing important is buried in code." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="h-fit lg:col-span-1">
          <nav aria-label="Settings sections" className="p-2">
            <ul className="space-y-0.5">
              {visible.map((s) => (
                <li key={s.key}>
                  <Link
                    href={`/admin/settings?section=${s.key}`}
                    aria-current={section === s.key ? 'page' : undefined}
                    className={cx(
                      'block rounded px-2.5 py-1.5 text-[13px]',
                      section === s.key ? 'bg-brand-600 font-medium text-white' : 'text-ink-600 hover:bg-ink-100',
                    )}
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
              <li className="mt-2 border-t border-ink-100 pt-2">
                <Link href="/ops/templates" className="block rounded px-2.5 py-1.5 text-[13px] text-ink-600 hover:bg-ink-100">
                  Onboarding templates →
                </Link>
              </li>
              <li>
                <Link href="/admin/compliance" className="block rounded px-2.5 py-1.5 text-[13px] text-ink-600 hover:bg-ink-100">
                  Compliance & retention →
                </Link>
              </li>
              <li>
                <Link href="/admin/integrations" className="block rounded px-2.5 py-1.5 text-[13px] text-ink-600 hover:bg-ink-100">
                  Integrations →
                </Link>
              </li>
            </ul>
          </nav>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          {section === 'organization' ? <OrganizationSection orgName={org?.name ?? 'FSW Group'} branding={branding} /> : null}
          {section === 'structure' ? <StructureSection /> : null}
          {section === 'holidays' ? <HolidaySection /> : null}
          {section === 'pto' ? <PtoSection /> : null}
          {section === 'users' ? <UsersSection /> : null}
          {section === 'permissions' ? <PermissionsSection /> : null}
          {section === 'fields' ? <FieldsSection /> : null}
        </div>
      </div>
    </div>
  );
}

async function OrganizationSection({ orgName, branding }: { orgName: string; branding: Record<string, string> }) {
  const entities = await db.legalEntity.findMany({ orderBy: { name: 'asc' } });
  return (
    <>
      <Card>
        <CardHeader title="Organization & branding" />
        <CardBody>
          <OrgForm name={orgName} accentColor={branding.accentColor ?? ''} logoUrl={branding.logoUrl ?? ''} tagline={branding.tagline ?? 'Everything about our people, in one place.'} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Legal entities" description="Add subsidiaries as the group grows — no redesign needed." />
        <Table>
          <THead><TH>Name</TH><TH>Code</TH><TH>Country</TH><TH>Active</TH></THead>
          <tbody>
            {entities.map((e) => (
              <TRow key={e.id}>
                <TD className="font-medium">{e.name}</TD>
                <TD>{e.code}</TD>
                <TD>{e.country}</TD>
                <TD>{e.active ? <Badge tone="green">active</Badge> : <Badge tone="gray">inactive</Badge>}</TD>
              </TRow>
            ))}
          </tbody>
        </Table>
        <CardBody className="border-t border-ink-100">
          <EntityForm />
        </CardBody>
      </Card>
    </>
  );
}

async function StructureSection() {
  const [departments, locations] = await Promise.all([
    db.department.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { employments: { where: { effectiveTo: null } } } } } }),
    db.location.findMany({ orderBy: { name: 'asc' } }),
  ]);
  return (
    <>
      <Card>
        <CardHeader title="Departments" />
        <Table>
          <THead><TH>Department</TH><TH>Current workers</TH><TH>Active</TH></THead>
          <tbody>
            {departments.map((d) => (
              <TRow key={d.id}>
                <TD className="font-medium">{d.name}</TD>
                <TD>{d._count.employments}</TD>
                <TD>{d.active ? <Badge tone="green">active</Badge> : <Badge tone="gray">inactive</Badge>}</TD>
              </TRow>
            ))}
          </tbody>
        </Table>
        <CardBody className="border-t border-ink-100">
          <DepartmentForm />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Locations" />
        <Table>
          <THead><TH>Location</TH><TH>City</TH><TH>Country</TH><TH>Timezone</TH></THead>
          <tbody>
            {locations.map((l) => (
              <TRow key={l.id}>
                <TD className="font-medium">{l.name}</TD>
                <TD>{[l.city, l.state].filter(Boolean).join(', ') || '—'}</TD>
                <TD>{l.country}</TD>
                <TD>{l.timezone}</TD>
              </TRow>
            ))}
          </tbody>
        </Table>
        <CardBody className="border-t border-ink-100">
          <LocationForm />
        </CardBody>
      </Card>
    </>
  );
}

async function HolidaySection() {
  const calendars = await db.holidayCalendar.findMany({
    orderBy: { name: 'asc' },
    include: { holidays: { orderBy: { date: 'asc' } } },
  });
  return (
    <>
      {calendars.map((cal) => (
        <Card key={cal.id}>
          <CardHeader title={`${cal.name} holidays`} description={`${cal.holidays.length} days · country ${cal.country}`} />
          <Table>
            <THead><TH>Date</TH><TH>Holiday</TH><TH>Kind</TH></THead>
            <tbody>
              {cal.holidays.map((h) => (
                <TRow key={h.id}>
                  <TD>{fmtDate(h.observedDate ?? h.date)}</TD>
                  <TD className="font-medium">{h.name}</TD>
                  <TD>{humanize(h.kind)}</TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        </Card>
      ))}
      <Card>
        <CardHeader title="Add a holiday" />
        <CardBody>
          <HolidayForm calendars={calendars.map((c) => ({ value: c.id, label: c.name }))} />
        </CardBody>
      </Card>
    </>
  );
}

async function PtoSection() {
  const [policies, workers] = await Promise.all([
    db.ptoPolicy.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { assignments: true } } } }),
    db.worker.findMany({
      where: { status: { notIn: ['TERMINATED'] }, deletedAt: null },
      select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
      orderBy: { lastName: 'asc' },
    }),
  ]);
  return (
    <>
      <Card>
        <CardHeader title="PTO policies" description="Accrual method, caps and waiting periods drive the balance engine." />
        <Table>
          <THead><TH>Policy</TH><TH>Type</TH><TH>Country</TH><TH>Accrual</TH><TH>Hours/yr</TH><TH>Carryover cap</TH><TH>Assigned</TH><TH>Assign</TH></THead>
          <tbody>
            {policies.map((p) => (
              <TRow key={p.id}>
                <TD className="font-medium">{p.name}</TD>
                <TD>{humanize(p.leaveType)}</TD>
                <TD>{p.country ?? 'any'}</TD>
                <TD>{humanize(p.accrualMethod)}</TD>
                <TD className="tabular-nums">{Number(p.hoursPerYear)}</TD>
                <TD className="tabular-nums">{p.carryoverCapHours ? Number(p.carryoverCapHours) : '—'}</TD>
                <TD>{p._count.assignments}</TD>
                <TD>
                  <AssignPtoForm policyId={p.id} workers={workers.map((w) => ({ value: w.id, label: fullName(w) }))} />
                </TD>
              </TRow>
            ))}
          </tbody>
        </Table>
        <CardBody className="border-t border-ink-100">
          <PtoPolicyForm />
        </CardBody>
      </Card>
    </>
  );
}

async function UsersSection() {
  const [users, roles, workersWithoutAccounts] = await Promise.all([
    db.user.findMany({
      orderBy: { email: 'asc' },
      include: { roles: { include: { role: true } }, worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
    }),
    db.role.findMany({ orderBy: { name: 'asc' } }),
    db.worker.findMany({
      where: { userId: null, status: { notIn: ['TERMINATED'] }, deletedAt: null },
      select: { id: true, legalFirstName: true, preferredName: true, lastName: true, workEmail: true },
    }),
  ]);
  return (
    <>
      <Card>
        <CardHeader title={`User accounts (${users.length})`} />
        <Table>
          <THead><TH>Email</TH><TH>Worker</TH><TH>Roles</TH><TH>MFA</TH><TH>Status</TH><TH>Last login</TH><TH></TH></THead>
          <tbody>
            {users.map((u) => (
              <TRow key={u.id}>
                <TD className="font-medium">{u.email}</TD>
                <TD>
                  {u.worker ? (
                    <Link href={`/people/${u.worker.id}`} className="text-brand-600 hover:underline">
                      {fullName(u.worker)}
                    </Link>
                  ) : (<span className="text-ink-400">—</span>)}
                </TD>
                <TD>
                  <UserRolesForm
                    userId={u.id}
                    allRoles={roles.map((r) => ({ value: r.id, label: r.name }))}
                    current={u.roles.map((r) => r.roleId)}
                  />
                </TD>
                <TD>{u.mfaEnabled ? <Badge tone="green">on</Badge> : <Badge tone="gray">off</Badge>}</TD>
                <TD><StatusBadge status={u.status} /></TD>
                <TD className="text-[12px] text-ink-400">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'never'}</TD>
                <TD>
                  <div className="flex gap-1.5">
                    {u.status === 'INVITED' ? <ResendInviteButton userId={u.id} /> : null}
                    <UserStatusForm userId={u.id} status={u.status} />
                  </div>
                </TD>
              </TRow>
            ))}
          </tbody>
        </Table>
      </Card>
      {workersWithoutAccounts.length > 0 ? (
        <Card>
          <CardHeader title="Workers without accounts" description="Invite them once a work email is on file." />
          <Table>
            <THead><TH>Worker</TH><TH>Work email</TH><TH></TH></THead>
            <tbody>
              {workersWithoutAccounts.map((w) => (
                <TRow key={w.id}>
                  <TD className="font-medium">{fullName(w)}</TD>
                  <TD>{w.workEmail ?? <span className="text-ink-400">not set</span>}</TD>
                  <TD>{w.workEmail ? <InviteWorkerForm workerId={w.id} /> : null}</TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}

async function PermissionsSection() {
  const roles = await db.role.findMany({ orderBy: { name: 'asc' }, include: { permissions: true, _count: { select: { users: true } } } });
  return (
    <>
      {roles.map((role) => {
        const def = ROLE_DEFS.find((d) => d.key === role.key);
        return (
          <Card key={role.id}>
            <CardHeader
              title={role.name}
              description={`${def?.description ?? ''} · ${role._count.users} user${role._count.users === 1 ? '' : 's'}`}
              actions={role.key === 'SUPER_ADMIN' ? <Badge tone="navy">locked</Badge> : undefined}
            />
            <CardBody>
              {role.key === 'SUPER_ADMIN' ? (
                <p className="text-[13px] text-ink-500">Super Admin always holds every permission and cannot be narrowed.</p>
              ) : (
                <RolePermissionsForm
                  roleId={role.id}
                  current={role.permissions.map((p) => p.permission)}
                  catalog={Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label }))}
                />
              )}
            </CardBody>
          </Card>
        );
      })}
    </>
  );
}

async function FieldsSection() {
  const fields = await db.customFieldDef.findMany({ where: { active: true }, orderBy: { label: 'asc' }, include: { _count: { select: { values: true } } } });
  return (
    <>
      <Card>
        <CardHeader title="Custom fields" description="Add worker fields without a database migration — they appear on profiles immediately." />
        {fields.length === 0 ? (
          <EmptyState title="No custom fields yet" />
        ) : (
          <Table>
            <THead><TH>Label</TH><TH>Key</TH><TH>Type</TH><TH>Section</TH><TH>Visibility</TH><TH>In use</TH><TH></TH></THead>
            <tbody>
              {fields.map((f) => (
                <TRow key={f.id}>
                  <TD className="font-medium">{f.label}</TD>
                  <TD><code className="text-[12px]">{f.key}</code></TD>
                  <TD>{humanize(f.fieldType)}</TD>
                  <TD>{f.section}</TD>
                  <TD>{humanize(f.visibility)}</TD>
                  <TD>{f._count.values}</TD>
                  <TD><DisableFieldButton fieldId={f.id} /></TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
        <CardBody className="border-t border-ink-100">
          <CustomFieldForm />
        </CardBody>
      </Card>
    </>
  );
}
