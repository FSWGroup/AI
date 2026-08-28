import 'server-only';
import { db } from '@/lib/db';
import { can, type Ctx, type Permission } from '@/lib/authz';
import { fullName, isoDate, daysBetween, startOfUTCDay, addDays } from '@/lib/format';

/**
 * Report registry (§41): every report declares the permission it needs and
 * produces {headers, rows}. The same definition powers the on-screen report,
 * the CSV export (audited, permission-checked) and the payroll hub.
 */

export interface ReportResult {
  headers: string[];
  rows: (string | number | null)[][];
}

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  category: string;
  permission: Permission;
  /** Extra permission needed to include sensitive columns */
  run: (ctx: Ctx, params: Record<string, string | undefined>) => Promise<ReportResult>;
}

async function currentEmployments(extra?: object) {
  return db.worker.findMany({
    where: { status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'] }, deletedAt: null, ...(extra ?? {}) },
    include: {
      employments: {
        where: { effectiveTo: null },
        take: 1,
        include: { department: true, legalEntity: true, location: true, manager: { select: { legalFirstName: true, preferredName: true, lastName: true } } },
      },
    },
    orderBy: { lastName: 'asc' },
  });
}

export const REPORTS: ReportDef[] = [
  {
    key: 'headcount',
    title: 'Active headcount',
    description: 'Every active worker with company, department, location, manager and type.',
    category: 'Workforce',
    permission: 'reports.run',
    run: async () => {
      const workers = await currentEmployments();
      return {
        headers: ['Employee #', 'Name', 'Title', 'Type', 'Status', 'Company', 'Department', 'Location', 'Country', 'Manager', 'Hire date', 'Tenure (days)'],
        rows: workers.map((w) => {
          const e = w.employments[0];
          return [
            w.employeeNumber, fullName(w), e?.title ?? '', w.workerType, w.status,
            e?.legalEntity?.name ?? '', e?.department?.name ?? '', e?.location?.name ?? '', w.country,
            e?.manager ? fullName(e.manager) : '', isoDate(w.hireDate), w.hireDate ? daysBetween(w.hireDate, new Date()) : null,
          ];
        }),
      };
    },
  },
  {
    key: 'headcount-by-department',
    title: 'Headcount by department',
    description: 'Active workers grouped by department and worker type.',
    category: 'Workforce',
    permission: 'reports.run',
    run: async () => {
      const workers = await currentEmployments();
      const groups = new Map<string, { employees: number; contractors: number }>();
      for (const w of workers) {
        const dept = w.employments[0]?.department?.name ?? 'Unassigned';
        const g = groups.get(dept) ?? { employees: 0, contractors: 0 };
        if (w.workerType === 'EMPLOYEE') g.employees++;
        else g.contractors++;
        groups.set(dept, g);
      }
      return {
        headers: ['Department', 'Employees', 'Contractors', 'Total'],
        rows: [...groups.entries()]
          .sort((a, b) => b[1].employees + b[1].contractors - (a[1].employees + a[1].contractors))
          .map(([dept, g]) => [dept, g.employees, g.contractors, g.employees + g.contractors]),
      };
    },
  },
  {
    key: 'turnover',
    title: 'Terminations & turnover',
    description: 'Terminations in the selected window with reason, voluntary flag and tenure.',
    category: 'Turnover',
    permission: 'reports.run',
    run: async (_ctx, params) => {
      const since = params.since ? new Date(params.since) : addDays(startOfUTCDay(), -365);
      const terms = await db.worker.findMany({
        where: { status: 'TERMINATED', terminationDate: { gte: since } },
        include: { employments: { orderBy: { effectiveFrom: 'desc' }, take: 1, include: { department: true } } },
        orderBy: { terminationDate: 'desc' },
      });
      return {
        headers: ['Name', 'Department', 'Hire date', 'Termination date', 'Tenure (days)', 'Voluntary', 'Reason', 'Rehire eligible'],
        rows: terms.map((w) => [
          fullName(w), w.employments[0]?.department?.name ?? '', isoDate(w.hireDate), isoDate(w.terminationDate),
          w.hireDate && w.terminationDate ? daysBetween(w.hireDate, w.terminationDate) : null,
          w.voluntaryTermination === null ? '' : w.voluntaryTermination ? 'Yes' : 'No',
          w.terminationReason ?? '', w.rehireEligible === null ? '' : w.rehireEligible ? 'Yes' : 'No',
        ]),
      };
    },
  },
  {
    key: 'recruiting-pipeline',
    title: 'Recruiting pipeline',
    description: 'Applications by job and stage, with source and days in process.',
    category: 'Recruiting',
    permission: 'recruiting.read',
    run: async () => {
      const apps = await db.application.findMany({
        include: { candidate: true, requisition: true, stage: true },
        orderBy: { createdAt: 'desc' },
      });
      return {
        headers: ['Candidate', 'Job', 'Stage', 'Status', 'Source', 'Applied', 'Days in process'],
        rows: apps.map((a) => [
          `${a.candidate.firstName} ${a.candidate.lastName}`, a.requisition.title, a.stage.name, a.status,
          a.candidate.source ?? '', isoDate(a.createdAt), daysBetween(a.createdAt, new Date()),
        ]),
      };
    },
  },
  {
    key: 'onboarding-status',
    title: 'Onboarding completion',
    description: 'Task completion per onboarding checklist.',
    category: 'Onboarding',
    permission: 'reports.run',
    run: async () => {
      const instances = await db.lifecycleInstance.findMany({
        where: { kind: 'ONBOARDING' },
        include: { worker: true, tasks: { select: { status: true } }, template: { select: { name: true } } },
        orderBy: { startDate: 'desc' },
      });
      return {
        headers: ['Worker', 'Template', 'Start date', 'Status', 'Tasks done', 'Tasks total', '% complete'],
        rows: instances.map((i) => {
          const done = i.tasks.filter((t) => t.status === 'COMPLETED').length;
          return [
            fullName(i.worker), i.template?.name ?? 'Custom', isoDate(i.startDate), i.status, done, i.tasks.length,
            i.tasks.length ? Math.round((done / i.tasks.length) * 100) : 0,
          ];
        }),
      };
    },
  },
  {
    key: 'pto-balances',
    title: 'PTO balances & liability',
    description: 'Current balances per worker and policy from the transaction ledger.',
    category: 'PTO',
    permission: 'pto.admin',
    run: async () => {
      const sums = await db.ptoTransaction.groupBy({
        by: ['workerId', 'policyId'],
        _sum: { hours: true },
      });
      const workers = await db.worker.findMany({
        where: { id: { in: [...new Set(sums.map((s) => s.workerId))] } },
        select: { id: true, legalFirstName: true, preferredName: true, lastName: true, status: true },
      });
      const policies = await db.ptoPolicy.findMany();
      return {
        headers: ['Worker', 'Status', 'Policy', 'Balance (hours)', 'Balance (days)'],
        rows: sums
          .map((s) => {
            const w = workers.find((x) => x.id === s.workerId);
            const p = policies.find((x) => x.id === s.policyId);
            const hours = Number(s._sum.hours ?? 0);
            return [w ? fullName(w) : s.workerId, w?.status ?? '', p?.name ?? s.policyId, hours, Number((hours / 8).toFixed(2))] as (string | number)[];
          })
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      };
    },
  },
  {
    key: 'compensation',
    title: 'Compensation snapshot',
    description: 'Current pay for every active worker (restricted).',
    category: 'Compensation',
    permission: 'comp.read',
    run: async () => {
      const workers = await db.worker.findMany({
        where: { status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'] }, deletedAt: null },
        include: {
          compensations: { where: { effectiveTo: null }, take: 1 },
          employments: { where: { effectiveTo: null }, take: 1, include: { department: true, legalEntity: true } },
        },
        orderBy: { lastName: 'asc' },
      });
      return {
        headers: ['Name', 'Company', 'Department', 'Title', 'Type', 'Amount', 'Currency', 'Rate', 'Bonus target %'],
        rows: workers.map((w) => {
          const c = w.compensations[0];
          const e = w.employments[0];
          return [
            fullName(w), e?.legalEntity?.name ?? '', e?.department?.name ?? '', e?.title ?? '', w.workerType,
            c ? Number(c.amount) : null, c?.currency ?? '', c?.rateType ?? '', c?.bonusTargetPct ? Number(c.bonusTargetPct) : null,
          ];
        }),
      };
    },
  },
  {
    key: 'compliance-open',
    title: 'Open compliance items',
    description: 'Outstanding compliance items with due dates and severity.',
    category: 'Compliance',
    permission: 'reports.run',
    run: async () => {
      const items = await db.complianceItem.findMany({
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] } },
        include: { rule: true, worker: true },
        orderBy: { dueDate: 'asc' },
      });
      return {
        headers: ['Item', 'Rule', 'Jurisdiction', 'Severity', 'Worker', 'Due', 'Status'],
        rows: items.map((i) => [
          i.title, i.rule.name, i.rule.jurisdiction, i.rule.severity,
          i.worker ? fullName(i.worker) : '', isoDate(i.dueDate), i.status,
        ]),
      };
    },
  },
  {
    key: 'training-status',
    title: 'Training completion',
    description: 'Assignment status per course and worker.',
    category: 'Compliance',
    permission: 'reports.run',
    run: async () => {
      const assignments = await db.trainingAssignment.findMany({
        include: { course: true, worker: true },
        orderBy: { dueDate: 'asc' },
      });
      return {
        headers: ['Worker', 'Course', 'Category', 'Assigned', 'Due', 'Status', 'Completed', 'Score'],
        rows: assignments.map((a) => [
          fullName(a.worker), a.course.title, a.course.category, isoDate(a.assignedAt), isoDate(a.dueDate),
          a.status, isoDate(a.completedAt), a.score,
        ]),
      };
    },
  },
  {
    key: 'international',
    title: 'International workforce',
    description: 'Workers outside the US with engagement model, currency and contract dates.',
    category: 'International',
    permission: 'people.read_all',
    run: async () => {
      const workers = await db.worker.findMany({
        where: { country: { not: 'US' }, deletedAt: null, status: { notIn: ['TERMINATED'] } },
        include: {
          contractorProfile: true,
          employments: { where: { effectiveTo: null }, take: 1, include: { department: true } },
          compensations: { where: { effectiveTo: null }, take: 1 },
        },
      });
      return {
        headers: ['Name', 'Country', 'Type', 'Engagement', 'Department', 'Currency', 'Contract start', 'Contract end'],
        rows: workers.map((w) => [
          fullName(w), w.country, w.workerType, w.engagementModel ?? '', w.employments[0]?.department?.name ?? '',
          w.localCurrency, isoDate(w.contractorProfile?.contractStart ?? null), isoDate(w.contractorProfile?.contractEnd ?? null),
        ]),
      };
    },
  },
  {
    key: 'payroll-changes',
    title: 'Payroll change report',
    description: 'Everything payroll needs for a period: comp changes, hires, terminations, approved PTO and contractor payments.',
    category: 'Payroll',
    permission: 'payroll.read',
    run: async (_ctx, params) => {
      const start = params.start ? new Date(params.start) : addDays(startOfUTCDay(), -31);
      const end = params.end ? new Date(params.end) : startOfUTCDay();
      const rows: (string | number | null)[][] = [];

      const comps = await db.compensation.findMany({
        where: { effectiveFrom: { gte: start, lte: end } },
        include: { worker: true },
      });
      for (const c of comps) {
        rows.push(['COMP_CHANGE', fullName(c.worker), isoDate(c.effectiveFrom), `${c.amount} ${c.currency}/${c.rateType}`, c.reason]);
      }
      const hires = await db.worker.findMany({ where: { hireDate: { gte: start, lte: end }, deletedAt: null } });
      for (const w of hires) rows.push(['NEW_HIRE', fullName(w), isoDate(w.hireDate), w.workerType, '']);
      const terms = await db.worker.findMany({ where: { terminationDate: { gte: start, lte: end } } });
      for (const w of terms) rows.push(['TERMINATION', fullName(w), isoDate(w.terminationDate), w.terminationReason ?? '', w.voluntaryTermination ? 'voluntary' : 'involuntary']);
      const pto = await db.ptoRequest.findMany({
        where: { status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } },
        include: { worker: true, policy: true },
      });
      for (const r of pto) rows.push(['PTO', fullName(r.worker), `${isoDate(r.startDate)}→${isoDate(r.endDate)}`, `${r.hours}h`, r.policy.leaveType]);
      const payments = await db.contractorPayment.findMany({
        where: { OR: [{ paidAt: { gte: start, lte: end } }, { paidAt: null, createdAt: { gte: start, lte: end } }] },
        include: { worker: true },
      });
      for (const p of payments) rows.push(['CONTRACTOR_PAYMENT', fullName(p.worker), isoDate(p.paidAt ?? p.createdAt), `${p.amount} ${p.currency}`, p.invoiceRef ?? '']);
      const sheets = await db.timesheet.findMany({
        where: { status: 'APPROVED', weekStart: { gte: addDays(start, -6), lte: end } },
        include: { worker: true, entries: true },
      });
      for (const s of sheets) {
        const hours = s.entries.reduce((sum, e) => {
          if (e.manualHours) return sum + Number(e.manualHours);
          if (e.clockIn && e.clockOut) return sum + (e.clockOut.getTime() - e.clockIn.getTime()) / 3600_000 - e.breakMinutes / 60;
          return sum;
        }, 0);
        rows.push(['APPROVED_HOURS', fullName(s.worker), isoDate(s.weekStart), `${hours.toFixed(2)}h`, '']);
      }
      return { headers: ['Change type', 'Worker', 'Date(s)', 'Detail', 'Note'], rows };
    },
  },
];

export function findReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

export function reportsFor(ctx: Ctx): ReportDef[] {
  return REPORTS.filter((r) => can(ctx, r.permission));
}
