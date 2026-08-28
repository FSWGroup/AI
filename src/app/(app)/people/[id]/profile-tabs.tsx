import Link from 'next/link';
import { db } from '@/lib/db';
import { can, type Ctx, type WorkerAccess } from '@/lib/authz';
import { ptoBalance } from '@/lib/pto';
import { fmtDate, fmtDateTime, fmtMoney, fullName, humanize, fmtHours } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, DescriptionList, EmptyState, StatusBadge,
  Table, THead, TH, TRow, TD, ButtonLink,
} from '@/components/ui';
import {
  ProfileEditDrawer, EmergencyContactForm, IdentifierForm, RevealButton, BankForm,
  JobChangeDrawer, CompChangeForm, ContractorForm, PaymentForm, OffboardingForm,
} from './edit-forms';
import type { Prisma } from '@/generated/prisma/client';

type WorkerPayload = Prisma.WorkerGetPayload<{
  include: {
    employments: {
      include: {
        department: true; legalEntity: true; location: true; team: true;
        manager: { select: { id: true; legalFirstName: true; preferredName: true; lastName: true } };
      };
    };
    contractorProfile: true;
  };
}>;

const RESTRICTED = <span className="text-ink-300 italic">Restricted</span>;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function OverviewTab({ worker, access, ctx }: { worker: WorkerPayload; access: WorkerAccess; ctx: Ctx }) {
  const canEditSelf = access.self;
  const canHrEdit = can(ctx, 'people.write');
  const showPii = access.pii;

  const [contacts, identifiers, bankAccounts, customValues] = await Promise.all([
    access.self || access.hr ? db.emergencyContact.findMany({ where: { workerId: worker.id } }) : Promise.resolve([]),
    showPii ? db.workerIdentifier.findMany({ where: { workerId: worker.id }, orderBy: { kind: 'asc' } }) : Promise.resolve([]),
    showPii ? db.bankAccount.findMany({ where: { workerId: worker.id, active: true } }) : Promise.resolve([]),
    db.customFieldValue.findMany({
      where: { workerId: worker.id, def: { active: true } },
      include: { def: true },
    }),
  ]);

  const visibleCustom = customValues.filter((v) => {
    if (v.def.visibility === 'HR') return access.hr;
    if (v.def.visibility === 'MANAGER') return access.hr || access.manager || access.self;
    return access.self || access.manager || access.hr;
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Contact & personal"
          actions={
            canEditSelf || canHrEdit ? (
              <ProfileEditDrawer
                workerId={worker.id}
                hrMode={canHrEdit}
                piiMode={showPii}
                initial={{
                  legalFirstName: worker.legalFirstName,
                  lastName: worker.lastName,
                  preferredName: worker.preferredName ?? '',
                  pronouns: worker.pronouns ?? '',
                  phone: worker.phone ?? '',
                  personalEmail: worker.personalEmail ?? '',
                  workEmail: worker.workEmail ?? '',
                  dateOfBirth: worker.dateOfBirth ? worker.dateOfBirth.toISOString().slice(0, 10) : '',
                  homeStreet: worker.homeStreet ?? '',
                  homeCity: worker.homeCity ?? '',
                  homeState: worker.homeState ?? '',
                  homePostal: worker.homePostal ?? '',
                  timezone: worker.timezone,
                  showBirthday: String(worker.showBirthday),
                }}
              />
            ) : undefined
          }
        />
        <CardBody>
          <DescriptionList
            items={[
              { label: 'Work email', value: worker.workEmail ?? '—' },
              { label: 'Phone', value: worker.phone ?? '—' },
              { label: 'Personal email', value: showPii ? (worker.personalEmail ?? '—') : RESTRICTED },
              { label: 'Date of birth', value: showPii ? fmtDate(worker.dateOfBirth) : RESTRICTED },
              {
                label: 'Home address',
                value: showPii
                  ? [worker.homeStreet, worker.homeCity, worker.homeState, worker.homePostal].filter(Boolean).join(', ') || '—'
                  : RESTRICTED,
              },
              { label: 'Citizenship', value: showPii ? (worker.citizenship ?? '—') : RESTRICTED },
              { label: 'Local currency', value: worker.localCurrency },
              { label: 'Engagement model', value: worker.engagementModel ?? (worker.workerType === 'EMPLOYEE' ? 'Direct employee' : '—') },
            ]}
          />
          {visibleCustom.length > 0 ? (
            <div className="mt-4 border-t border-ink-100 pt-4">
              <DescriptionList
                items={visibleCustom.map((v) => ({
                  label: v.def.label,
                  value: typeof v.value === 'object' ? JSON.stringify(v.value) : String(v.value),
                }))}
              />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="space-y-4">
        {(access.self || access.hr) && (
          <Card>
            <CardHeader title="Emergency contacts" />
            <CardBody className="space-y-4">
              {contacts.map((c) => (
                <EmergencyContactForm key={c.id} workerId={worker.id} contact={c} />
              ))}
              <EmergencyContactForm workerId={worker.id} />
            </CardBody>
          </Card>
        )}

        {showPii && (
          <Card>
            <CardHeader
              title="Government & tax identifiers"
              description="Stored AES-256 encrypted. Every reveal is logged to the audit trail."
            />
            <CardBody className="space-y-4">
              {identifiers.length === 0 ? (
                <p className="text-[13px] text-ink-400">No identifiers on file.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {identifiers.map((idr) => (
                    <li key={idr.id} className="flex items-center justify-between py-2 text-sm">
                      <span>
                        {humanize(idr.kind)}
                        {idr.expiresAt ? (
                          <span className="ml-2 text-[12px] text-ink-400">expires {fmtDate(idr.expiresAt)}</span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-3">
                        <code className="font-mono text-[13px] text-ink-500">••• {idr.last4}</code>
                        {(access.self || can(ctx, 'pii.reveal')) && <RevealButton identifierId={idr.id} />}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {(access.self || can(ctx, 'pii.write')) && <IdentifierForm workerId={worker.id} />}
            </CardBody>
          </Card>
        )}

        {showPii && (
          <Card>
            <CardHeader title="Direct deposit" description="Account numbers are stored encrypted and masked." />
            <CardBody className="space-y-4">
              {bankAccounts.map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <span>
                    {b.bankName ?? 'Bank account'} · {humanize(b.accountType ?? '')}
                  </span>
                  <code className="font-mono text-[13px] text-ink-500">••• {b.accountLast4}</code>
                </div>
              ))}
              {(access.self || can(ctx, 'pii.write')) && <BankForm workerId={worker.id} country={worker.country} />}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job & employment history + termination controls
// ---------------------------------------------------------------------------

export async function JobTab({ worker, access, ctx }: { worker: WorkerPayload; access: WorkerAccess; ctx: Ctx }) {
  const history = await db.employmentRecord.findMany({
    where: { workerId: worker.id },
    orderBy: { effectiveFrom: 'desc' },
    include: {
      department: true, legalEntity: true, location: true,
      manager: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
    },
  });

  const [entities, departments, locations, managers] = can(ctx, 'people.write')
    ? await Promise.all([
        db.legalEntity.findMany({ where: { active: true } }),
        db.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
        db.location.findMany({ where: { active: true } }),
        db.worker.findMany({
          where: { status: { in: ['ACTIVE', 'ONBOARDING'] }, id: { not: worker.id }, deletedAt: null },
          select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
          orderBy: { lastName: 'asc' },
        }),
      ])
    : [[], [], [], []];

  const current = history.find((h) => h.effectiveTo === null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Employment history"
          description="Effective-dated records — history is never overwritten."
          actions={
            can(ctx, 'people.write') && current ? (
              <JobChangeDrawer
                workerId={worker.id}
                current={{
                  title: current.title,
                  legalEntityId: current.legalEntityId,
                  departmentId: current.departmentId ?? '',
                  locationId: current.locationId ?? '',
                  managerId: current.managerId ?? '',
                  jobFamily: current.jobFamily ?? '',
                  jobLevel: current.jobLevel ?? '',
                  workState: current.workState ?? '',
                  workMode: current.workMode ?? '',
                  flsaStatus: current.flsaStatus ?? '',
                  payBasis: current.payBasis ?? '',
                }}
                entities={entities.map((e) => ({ value: e.id, label: e.name }))}
                departments={departments.map((d) => ({ value: d.id, label: d.name }))}
                locations={locations.map((l) => ({ value: l.id, label: l.name }))}
                managers={managers.map((m) => ({ value: m.id, label: fullName(m) }))}
              />
            ) : undefined
          }
        />
        <Table>
          <THead>
            <TH>Effective</TH><TH>Title</TH><TH>Department</TH><TH>Company</TH><TH>Manager</TH><TH>Mode</TH><TH>Reason</TH>
          </THead>
          <tbody>
            {history.map((h) => (
              <TRow key={h.id} className={h.effectiveTo === null ? 'bg-brand-50/40' : ''}>
                <TD>
                  {fmtDate(h.effectiveFrom)} — {h.effectiveTo ? fmtDate(h.effectiveTo) : <Badge tone="green">current</Badge>}
                </TD>
                <TD>{h.title}</TD>
                <TD>{h.department?.name ?? '—'}</TD>
                <TD>{h.legalEntity.name}</TD>
                <TD>{h.manager ? fullName(h.manager) : '—'}</TD>
                <TD>{humanize(h.workMode)}</TD>
                <TD>{humanize(h.changeReason)}</TD>
              </TRow>
            ))}
          </tbody>
        </Table>
      </Card>

      {can(ctx, 'people.terminate') && worker.status !== 'TERMINATED' ? (
        <Card>
          <CardHeader
            title={worker.status === 'OFFBOARDING' ? 'Finalize termination' : 'Start offboarding'}
            description={
              worker.status === 'OFFBOARDING'
                ? `Offboarding in progress — last day ${fmtDate(worker.terminationDate)}.`
                : 'Generates the offboarding checklist (manager, IT access removal, equipment return, payroll, HR).'
            }
          />
          <CardBody>
            <OffboardingForm workerId={worker.id} status={worker.status} />
          </CardBody>
        </Card>
      ) : null}

      {worker.status === 'TERMINATED' ? (
        <Callout tone="info">
          Employment ended {fmtDate(worker.terminationDate)} ({humanize(worker.terminationReason)},{' '}
          {worker.voluntaryTermination ? 'voluntary' : 'involuntary'}). Rehire eligible:{' '}
          {worker.rehireEligible === null ? 'not recorded' : worker.rehireEligible ? 'yes' : 'no'}.
          {access.hr ? ' Records are retained per the retention policy.' : ''}
        </Callout>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------------

export async function CompTab({ worker, access, ctx }: { worker: WorkerPayload; access: WorkerAccess; ctx: Ctx }) {
  const comps = await db.compensation.findMany({
    where: { workerId: worker.id },
    orderBy: { effectiveFrom: 'desc' },
  });
  const current = comps.find((c) => c.effectiveTo === null);
  const emp = worker.employments[0];
  const band =
    current && emp?.jobFamily && emp?.jobLevel
      ? await db.salaryBand.findUnique({
          where: {
            jobFamily_jobLevel_geography: {
              jobFamily: emp.jobFamily,
              jobLevel: emp.jobLevel,
              geography: worker.country,
            },
          },
        })
      : null;
  const compaRatio =
    band && current && current.rateType === 'ANNUAL'
      ? (Number(current.amount) / Number(band.midAmount)) * 100
      : null;

  return (
    <div className="space-y-4">
      {current ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card><CardBody>
            <div className="text-[12px] font-medium text-ink-500 uppercase">Current pay</div>
            <div className="mt-1 text-xl font-semibold">{fmtMoney(Number(current.amount), current.currency)}
              <span className="ml-1 text-sm font-normal text-ink-400">/ {current.rateType.toLowerCase()}</span></div>
          </CardBody></Card>
          <Card><CardBody>
            <div className="text-[12px] font-medium text-ink-500 uppercase">Bonus target</div>
            <div className="mt-1 text-xl font-semibold">{current.bonusTargetPct ? `${current.bonusTargetPct}%` : '—'}</div>
          </CardBody></Card>
          <Card><CardBody>
            <div className="text-[12px] font-medium text-ink-500 uppercase">Salary band</div>
            <div className="mt-1 text-sm">
              {band ? `${fmtMoney(Number(band.minAmount))} – ${fmtMoney(Number(band.maxAmount))}` : 'No band defined'}
            </div>
          </CardBody></Card>
          <Card><CardBody>
            <div className="text-[12px] font-medium text-ink-500 uppercase">Compa-ratio</div>
            <div className="mt-1 text-xl font-semibold">{compaRatio ? `${compaRatio.toFixed(0)}%` : '—'}</div>
          </CardBody></Card>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Compensation history" description="Effective-dated; prior records are never overwritten." />
        {comps.length === 0 ? (
          <EmptyState title="No compensation recorded" />
        ) : (
          <Table>
            <THead><TH>Effective</TH><TH>Amount</TH><TH>Frequency</TH><TH>Reason</TH><TH>Note</TH></THead>
            <tbody>
              {comps.map((c) => (
                <TRow key={c.id} className={c.effectiveTo === null ? 'bg-brand-50/40' : ''}>
                  <TD>{fmtDate(c.effectiveFrom)} — {c.effectiveTo ? fmtDate(c.effectiveTo) : <Badge tone="green">current</Badge>}</TD>
                  <TD className="font-medium tabular-nums">{fmtMoney(Number(c.amount), c.currency)} / {c.rateType.toLowerCase()}</TD>
                  <TD>{humanize(c.payFrequency)}</TD>
                  <TD>{humanize(c.reason)}</TD>
                  <TD className="max-w-56 truncate">{c.note ?? '—'}</TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {can(ctx, 'comp.write') && access.hr ? (
        <Card>
          <CardHeader title="Record compensation change" />
          <CardBody>
            <CompChangeForm workerId={worker.id} currency={worker.localCurrency} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time off
// ---------------------------------------------------------------------------

export async function TimeOffTab({ worker }: { worker: WorkerPayload }) {
  const assignments = await db.ptoPolicyAssignment.findMany({
    where: { workerId: worker.id, endDate: null },
    include: { policy: true },
  });
  const balances = await Promise.all(
    assignments.map(async (a) => ({ policy: a.policy, balance: await ptoBalance(worker.id, a.policyId) })),
  );
  const requests = await db.ptoRequest.findMany({
    where: { workerId: worker.id },
    orderBy: { startDate: 'desc' },
    take: 10,
    include: { policy: true },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {balances.map(({ policy, balance }) => (
          <Card key={policy.id}>
            <CardBody>
              <div className="text-[12px] font-medium text-ink-500 uppercase">{policy.name}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{fmtHours(balance)}</div>
              <div className="text-[12px] text-ink-400">≈ {(balance / 8).toFixed(1)} days</div>
            </CardBody>
          </Card>
        ))}
        {balances.length === 0 ? (
          <Card className="col-span-full"><CardBody><p className="text-[13px] text-ink-500">No leave policies assigned.</p></CardBody></Card>
        ) : null}
      </div>
      <Card>
        <CardHeader title="Recent requests" actions={<ButtonLink variant="secondary" size="sm" href="/time/pto">Time off center</ButtonLink>} />
        {requests.length === 0 ? (
          <EmptyState title="No requests yet" />
        ) : (
          <Table>
            <THead><TH>Policy</TH><TH>Dates</TH><TH>Hours</TH><TH>Status</TH></THead>
            <tbody>
              {requests.map((r) => (
                <TRow key={r.id}>
                  <TD>{r.policy.name}</TD>
                  <TD>{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</TD>
                  <TD className="tabular-nums">{fmtHours(Number(r.hours))}</TD>
                  <TD><StatusBadge status={r.status} /></TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents (per-worker view; full vault lives at /documents)
// ---------------------------------------------------------------------------

export async function DocumentsTab({ worker, ctx }: { worker: WorkerPayload; ctx: Ctx }) {
  const documents = await db.document.findMany({
    where: { workerId: worker.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { signatures: true } } },
  });
  return (
    <Card>
      <CardHeader
        title="Documents"
        description="Downloads use short-lived signed links and are logged."
        actions={
          can(ctx, 'docs.write') ? (
            <ButtonLink size="sm" href={`/documents/new?workerId=${worker.id}`}>Upload document</ButtonLink>
          ) : undefined
        }
      />
      {documents.length === 0 ? (
        <EmptyState title="No documents" description="Offer letters, agreements, forms and certificates will appear here." />
      ) : (
        <Table>
          <THead><TH>Title</TH><TH>Category</TH><TH>Version</TH><TH>Signed / Ack</TH><TH>Expires</TH><TH></TH></THead>
          <tbody>
            {documents.map((doc) => {
              const v = doc.versions[0];
              return (
                <TRow key={doc.id}>
                  <TD className="font-medium">{doc.title}</TD>
                  <TD>{humanize(doc.category)}</TD>
                  <TD>v{v?.version ?? '—'}</TD>
                  <TD>
                    {v?.signatures.length ? (
                      <Badge tone="green">Signed {fmtDate(v.signatures[0].signedAt)}</Badge>
                    ) : doc.requiresSignature ? (
                      <Badge tone="amber">Awaiting signature</Badge>
                    ) : ('—')}
                  </TD>
                  <TD>{doc.expiresAt ? fmtDate(doc.expiresAt) : '—'}</TD>
                  <TD>
                    <Link href={`/documents/${doc.id}`} className="text-[13px] font-medium text-brand-600 hover:underline">
                      Open
                    </Link>
                  </TD>
                </TRow>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Equipment & app access
// ---------------------------------------------------------------------------

export async function AssetsTab({ worker, ctx }: { worker: WorkerPayload; ctx: Ctx }) {
  const [assignments, grants, trainings] = await Promise.all([
    db.equipmentAssignment.findMany({
      where: { workerId: worker.id },
      include: { asset: true },
      orderBy: { assignedAt: 'desc' },
    }),
    db.appAccessGrant.findMany({
      where: { workerId: worker.id },
      include: { app: true },
      orderBy: { grantedAt: 'desc' },
    }),
    db.trainingAssignment.findMany({
      where: { workerId: worker.id },
      include: { course: true },
      orderBy: { assignedAt: 'desc' },
    }),
  ]);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Equipment"
          actions={can(ctx, 'equipment.admin') ? <ButtonLink size="sm" variant="secondary" href={`/equipment?assign=${worker.id}`}>Assign equipment</ButtonLink> : undefined}
        />
        {assignments.length === 0 ? (
          <EmptyState title="No equipment assigned" />
        ) : (
          <Table>
            <THead><TH>Asset</TH><TH>Tag</TH><TH>Assigned</TH><TH>Returned</TH><TH>Status</TH></THead>
            <tbody>
              {assignments.map((a) => (
                <TRow key={a.id}>
                  <TD className="font-medium">{humanize(a.asset.kind)} — {a.asset.make} {a.asset.model}</TD>
                  <TD>{a.asset.assetTag}</TD>
                  <TD>{fmtDate(a.assignedAt)}</TD>
                  <TD>{a.returnedAt ? `${fmtDate(a.returnedAt)} (${humanize(a.returnedCondition)})` : a.returnRequired ? 'Outstanding' : 'n/a'}</TD>
                  <TD><StatusBadge status={a.returnedAt ? 'COMPLETED' : 'ASSIGNED'} /></TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Application access"
          actions={can(ctx, 'apps.admin') ? <ButtonLink size="sm" variant="secondary" href={`/apps?grant=${worker.id}`}>Grant access</ButtonLink> : undefined}
        />
        {grants.length === 0 ? (
          <EmptyState title="No application access recorded" />
        ) : (
          <Table>
            <THead><TH>Application</TH><TH>Level</TH><TH>Granted</TH><TH>Revoked</TH></THead>
            <tbody>
              {grants.map((g) => (
                <TRow key={g.id}>
                  <TD className="font-medium">{g.app.name}</TD>
                  <TD>{humanize(g.accessLevel)}</TD>
                  <TD>{fmtDate(g.grantedAt)}</TD>
                  <TD>{g.revokedAt ? fmtDate(g.revokedAt) : <Badge tone="green">Active</Badge>}</TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Training" />
        {trainings.length === 0 ? (
          <EmptyState title="No training assigned" />
        ) : (
          <Table>
            <THead><TH>Course</TH><TH>Category</TH><TH>Due</TH><TH>Status</TH><TH>Completed</TH></THead>
            <tbody>
              {trainings.map((t) => (
                <TRow key={t.id}>
                  <TD className="font-medium">{t.course.title}</TD>
                  <TD>{humanize(t.course.category)}</TD>
                  <TD>{fmtDate(t.dueDate)}</TD>
                  <TD><StatusBadge status={t.status} /></TD>
                  <TD>{t.completedAt ? `${fmtDate(t.completedAt)}${t.score !== null ? ` · ${t.score}%` : ''}` : '—'}</TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding / offboarding checklists
// ---------------------------------------------------------------------------

export async function OnboardingTab({ worker }: { worker: WorkerPayload }) {
  const instances = await db.lifecycleInstance.findMany({
    where: { workerId: worker.id },
    orderBy: { createdAt: 'desc' },
    include: { template: true, tasks: { orderBy: [{ dueDate: 'asc' }] } },
  });
  if (instances.length === 0) {
    return <Card><EmptyState title="No onboarding or offboarding checklists" /></Card>;
  }
  return (
    <div className="space-y-4">
      {instances.map((inst) => {
        const done = inst.tasks.filter((t) => t.status === 'COMPLETED').length;
        const pct = inst.tasks.length ? Math.round((done / inst.tasks.length) * 100) : 0;
        return (
          <Card key={inst.id}>
            <CardHeader
              title={`${humanize(inst.kind)} — ${inst.template?.name ?? 'Custom'}`}
              description={`${done}/${inst.tasks.length} tasks complete · started ${fmtDate(inst.startDate)}`}
              actions={<StatusBadge status={inst.status} />}
            />
            <CardBody>
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <ul className="divide-y divide-ink-100">
                {inst.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/tasks?task=${t.id}`} className="min-w-0 truncate text-ink-800 hover:text-brand-600">
                      {t.title}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2 text-[12px] text-ink-400">
                      {t.dueDate ? fmtDate(t.dueDate) : ''}
                      <StatusBadge status={t.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contractor
// ---------------------------------------------------------------------------

export async function ContractorTab({ worker, ctx, access }: { worker: WorkerPayload; ctx: Ctx; access: WorkerAccess }) {
  const profile = worker.contractorProfile;
  const payments = access.hr || access.self
    ? await db.contractorPayment.findMany({ where: { workerId: worker.id }, orderBy: { createdAt: 'desc' }, take: 12 })
    : [];

  return (
    <div className="space-y-4">
      <Callout tone="info">
        Worker classification is an explicit HR decision — FSW People never reclassifies a contractor automatically.
        Confirm required tax documentation (W-9 / W-8BEN) with the payroll or tax provider.
      </Callout>
      <Card>
        <CardHeader title="Engagement details" />
        <CardBody>
          {can(ctx, 'people.write') ? (
            <ContractorForm
              workerId={worker.id}
              initial={{
                isBusiness: profile?.isBusiness ?? false,
                businessName: profile?.businessName ?? '',
                dba: profile?.dba ?? '',
                contractStart: profile?.contractStart?.toISOString().slice(0, 10) ?? '',
                contractEnd: profile?.contractEnd?.toISOString().slice(0, 10) ?? '',
                paymentTerms: profile?.paymentTerms ?? '',
                paymentMethod: profile?.paymentMethod ?? '',
                w9Status: profile?.w9Status ?? '',
                w8Status: profile?.w8Status ?? '',
                is1099Eligible: profile?.is1099Eligible ?? false,
                notes: profile?.notes ?? '',
              }}
            />
          ) : (
            <DescriptionList
              items={[
                { label: 'Engagement', value: profile?.isBusiness ? `${profile.businessName ?? 'Business'} (business)` : 'Individual' },
                { label: 'Contract', value: `${fmtDate(profile?.contractStart)} – ${fmtDate(profile?.contractEnd)}` },
                { label: 'Payment terms', value: humanize(profile?.paymentTerms) },
                { label: 'Payment method', value: humanize(profile?.paymentMethod) },
              ]}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Payments" description="Recorded or imported payments — FSW People does not move money." />
        {payments.length === 0 ? (
          <EmptyState title="No payments recorded" />
        ) : (
          <Table>
            <THead><TH>Invoice</TH><TH>Amount</TH><TH>Paid</TH><TH>Status</TH><TH>Note</TH></THead>
            <tbody>
              {payments.map((p) => (
                <TRow key={p.id}>
                  <TD>{p.invoiceRef ?? '—'}</TD>
                  <TD className="font-medium tabular-nums">{fmtMoney(Number(p.amount), p.currency)}</TD>
                  <TD>{p.paidAt ? fmtDate(p.paidAt) : '—'}</TD>
                  <TD><StatusBadge status={p.status} /></TD>
                  <TD className="max-w-48 truncate">{p.note ?? '—'}</TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
        {can(ctx, 'payroll.admin') ? (
          <CardBody className="border-t border-ink-100">
            <PaymentForm workerId={worker.id} currency={worker.localCurrency} />
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export async function TimelineTab({ worker, access, ctx }: { worker: WorkerPayload; access: WorkerAccess; ctx: Ctx }) {
  const allowed: string[] = [];
  if (access.self) allowed.push('SELF', 'MANAGER');
  if (access.manager) allowed.push('MANAGER');
  if (access.hr) allowed.push('SELF', 'MANAGER', 'HR');
  if (access.comp || can(ctx, 'comp.read')) allowed.push('COMP');
  if (can(ctx, 'cases.read')) allowed.push('HR_CONFIDENTIAL');

  const events = await db.timelineEvent.findMany({
    where: { workerId: worker.id, visibility: { in: [...new Set(allowed)] } },
    orderBy: { occurredAt: 'desc' },
    take: 100,
  });

  const dot: Record<string, string> = {
    HIRE: 'bg-ok-500', TERMINATION: 'bg-danger-500', COMP_CHANGE: 'bg-warn-500',
    ONBOARDING: 'bg-brand-500', OFFBOARDING: 'bg-warn-500',
  };

  return (
    <Card>
      <CardHeader title="Timeline" description="You only see events your role is allowed to see." />
      {events.length === 0 ? (
        <EmptyState title="No timeline events visible to you" />
      ) : (
        <CardBody>
          <ol className="relative space-y-5 border-l border-ink-200 pl-5">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span
                  aria-hidden
                  className={`absolute top-1.5 -left-[26.5px] h-3 w-3 rounded-full border-2 border-white ${dot[e.kind] ?? 'bg-ink-300'}`}
                />
                <div className="text-sm font-medium text-ink-900">{e.title}</div>
                {e.detail ? <div className="text-[13px] text-ink-500">{e.detail}</div> : null}
                <div className="mt-0.5 text-[12px] text-ink-400">{fmtDateTime(e.occurredAt)}</div>
              </li>
            ))}
          </ol>
        </CardBody>
      )}
    </Card>
  );
}
