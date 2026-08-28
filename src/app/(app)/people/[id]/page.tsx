import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireCtx, workerAccess, can } from '@/lib/authz';
import { fullName, humanize, fmtDate, tenureLabel } from '@/lib/format';
import { Avatar, Badge, PageHeader, StatusBadge, cx } from '@/components/ui';
import {
  OverviewTab, JobTab, CompTab, DocumentsTab, TimelineTab, TimeOffTab, AssetsTab, ContractorTab, OnboardingTab,
} from './profile-tabs';

export default async function WorkerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { tab = 'overview' } = await searchParams;

  const worker = await db.worker.findUnique({
    where: { id, deletedAt: null },
    include: {
      employments: {
        where: { effectiveTo: null },
        take: 1,
        include: { department: true, legalEntity: true, location: true, team: true,
          manager: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
      },
      contractorProfile: true,
    },
  });
  if (!worker) notFound();

  const access = await workerAccess(ctx, worker.id);
  if (!access.directory && !access.self && !access.manager && !access.hr) notFound();

  const emp = worker.employments[0];
  const canSeeDetail = access.self || access.manager || access.hr;

  const tabs: { key: string; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'job', label: 'Job & Pay History', show: canSeeDetail },
    { key: 'comp', label: 'Compensation', show: access.comp },
    { key: 'time-off', label: 'Time Off', show: canSeeDetail },
    { key: 'documents', label: 'Documents', show: access.self || can(ctx, 'docs.read_all') },
    { key: 'assets', label: 'Equipment & Access', show: canSeeDetail },
    { key: 'onboarding', label: 'Onboarding', show: canSeeDetail },
    { key: 'contractor', label: 'Contractor', show: worker.workerType !== 'EMPLOYEE' && (access.hr || access.self || access.manager) },
    { key: 'timeline', label: 'Timeline', show: canSeeDetail },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : 'overview';

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'People', href: '/people' }, { label: fullName(worker) }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={fullName(worker)} photoUrl={worker.photoUrl} size={44} />
            <span>
              {fullName(worker)}
              {worker.pronouns ? <span className="ml-2 text-sm font-normal text-ink-400">({worker.pronouns})</span> : null}
              {worker.isDemo ? <span className="ml-2 align-middle text-[10px] tracking-wide text-ink-300 uppercase">demo record</span> : null}
              <span className="mt-0.5 block text-sm font-normal text-ink-500">
                {emp?.title ?? humanize(worker.workerType)} · {emp?.department?.name ?? '—'} · {emp?.legalEntity?.name ?? '—'}
              </span>
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={worker.status} />
            <Badge tone={worker.workerType === 'EMPLOYEE' ? 'blue' : 'amber'}>{humanize(worker.workerType)}</Badge>
            <Badge tone="gray">{worker.country === 'PH' ? '🇵🇭 Philippines' : worker.country === 'US' ? '🇺🇸 United States' : worker.country}</Badge>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-card border border-ink-200/70 bg-white px-5 py-3 text-[13px] shadow-card sm:grid-cols-4 lg:grid-cols-6">
        <div><span className="text-ink-400">ID </span>{worker.employeeNumber}</div>
        <div><span className="text-ink-400">Started </span>{fmtDate(worker.hireDate)}</div>
        <div><span className="text-ink-400">Tenure </span>{tenureLabel(worker.hireDate)}</div>
        <div>
          <span className="text-ink-400">Manager </span>
          {emp?.manager ? (
            <Link className="text-brand-600 hover:underline" href={`/people/${emp.manager.id}`}>
              {fullName(emp.manager)}
            </Link>
          ) : ('—')}
        </div>
        <div><span className="text-ink-400">Location </span>{emp?.location?.name ?? '—'}</div>
        <div><span className="text-ink-400">Timezone </span>{worker.timezone.split('/').pop()?.replace(/_/g, ' ')}</div>
      </div>

      <nav aria-label="Profile sections" className="fsw-scroll mb-4 flex gap-1 overflow-x-auto border-b border-ink-200">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={`/people/${worker.id}?tab=${t.key}`}
            aria-current={activeTab === t.key ? 'page' : undefined}
            className={cx(
              '-mb-px border-b-2 px-3.5 py-2 text-[13.5px] whitespace-nowrap transition-colors',
              activeTab === t.key
                ? 'border-brand-600 font-medium text-brand-700'
                : 'border-transparent text-ink-500 hover:border-ink-200 hover:text-ink-800',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {activeTab === 'overview' && <OverviewTab worker={worker} access={access} ctx={ctx} />}
      {activeTab === 'job' && canSeeDetail && <JobTab worker={worker} access={access} ctx={ctx} />}
      {activeTab === 'comp' && access.comp && <CompTab worker={worker} access={access} ctx={ctx} />}
      {activeTab === 'time-off' && canSeeDetail && <TimeOffTab worker={worker} />}
      {activeTab === 'documents' && (access.self || can(ctx, 'docs.read_all')) && <DocumentsTab worker={worker} ctx={ctx} />}
      {activeTab === 'assets' && canSeeDetail && <AssetsTab worker={worker} ctx={ctx} />}
      {activeTab === 'onboarding' && canSeeDetail && <OnboardingTab worker={worker} />}
      {activeTab === 'contractor' && worker.workerType !== 'EMPLOYEE' && <ContractorTab worker={worker} ctx={ctx} access={access} />}
      {activeTab === 'timeline' && canSeeDetail && <TimelineTab worker={worker} access={access} ctx={ctx} />}
    </div>
  );
}
