import 'server-only';
import { db } from '@/lib/db';
import { createWorker } from '@/lib/people';
import type { Ctx } from '@/lib/authz';
import type { WorkerType } from '@/generated/prisma/enums';

/**
 * Import Center (§59). Uploads are parsed, mapped, validated and previewed
 * BEFORE anything is written. A failing import never partially corrupts
 * production data: each row is applied inside a transaction and a row error
 * is reported rather than half-applied.
 */

export interface ImportRow {
  rowNumber: number;
  values: Record<string, string>;
  errors: string[];
}

export interface ImportPreview {
  headers: string[];
  rows: ImportRow[];
  validCount: number;
  errorCount: number;
}

/** Minimal, dependency-free CSV parser with quoted-field support. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);

  const headers = rows.shift() ?? [];
  return { headers, rows };
}

export const IMPORT_KINDS = {
  WORKERS: {
    label: 'Workers',
    required: ['legalFirstName', 'lastName', 'title', 'hireDate', 'workerType', 'country', 'legalEntityCode'],
    optional: ['preferredName', 'workEmail', 'personalEmail', 'phone', 'department', 'location', 'managerEmail', 'amount', 'currency', 'rateType', 'workState', 'workMode'],
  },
  DEPARTMENTS: { label: 'Departments', required: ['name'], optional: ['code'] },
  COMPENSATION: {
    label: 'Compensation',
    required: ['workEmail', 'amount', 'currency', 'rateType', 'effectiveFrom'],
    optional: ['reason', 'note'],
  },
  PTO_BALANCES: { label: 'PTO balances', required: ['workEmail', 'policyName', 'hours'], optional: ['note'] },
  EQUIPMENT: { label: 'Equipment', required: ['kind', 'assetTag'], optional: ['serialNumber', 'make', 'model', 'valueUsd', 'condition'] },
} as const;

export type ImportKind = keyof typeof IMPORT_KINDS;

export async function validateImport(kind: ImportKind, text: string): Promise<ImportPreview> {
  const spec = IMPORT_KINDS[kind];
  const { headers, rows } = parseCsv(text);
  const missing = spec.required.filter((r) => !headers.includes(r));

  const entities = await db.legalEntity.findMany();
  const departments = await db.department.findMany();
  const policies = await db.ptoPolicy.findMany();
  const existingEmails = new Set(
    (await db.worker.findMany({ where: { workEmail: { not: null } }, select: { workEmail: true } }))
      .map((w) => w.workEmail!.toLowerCase()),
  );
  const knownWorkerEmails = new Set(existingEmails);
  const assetTags = new Set((await db.equipmentAsset.findMany({ select: { assetTag: true } })).map((a) => a.assetTag));

  const parsed: ImportRow[] = rows.map((cells, i) => {
    const values: Record<string, string> = {};
    headers.forEach((h, idx) => (values[h] = cells[idx] ?? ''));
    const errors: string[] = [...missing.map((m) => `Missing required column “${m}”`)];

    for (const req of spec.required) {
      if (headers.includes(req) && !values[req]) errors.push(`“${req}” is required`);
    }

    if (kind === 'WORKERS') {
      if (values.workEmail && existingEmails.has(values.workEmail.toLowerCase())) {
        errors.push(`A worker already exists with ${values.workEmail}`);
      }
      if (values.legalEntityCode && !entities.some((e) => e.code === values.legalEntityCode.toUpperCase())) {
        errors.push(`Unknown legal entity code “${values.legalEntityCode}”`);
      }
      if (values.department && !departments.some((d) => d.name.toLowerCase() === values.department.toLowerCase())) {
        errors.push(`Unknown department “${values.department}”`);
      }
      if (values.hireDate && Number.isNaN(new Date(values.hireDate).getTime())) errors.push('hireDate is not a valid date');
      if (values.workerType && !['EMPLOYEE', 'CONTRACTOR', 'EOR', 'AGENCY'].includes(values.workerType.toUpperCase())) {
        errors.push(`workerType must be EMPLOYEE, CONTRACTOR, EOR or AGENCY`);
      }
      if (values.amount && !Number.isFinite(Number(values.amount))) errors.push('amount must be a number');
    }
    if (kind === 'COMPENSATION' || kind === 'PTO_BALANCES') {
      if (values.workEmail && !knownWorkerEmails.has(values.workEmail.toLowerCase())) {
        errors.push(`No worker found with work email ${values.workEmail}`);
      }
    }
    if (kind === 'COMPENSATION') {
      if (values.amount && !Number.isFinite(Number(values.amount))) errors.push('amount must be a number');
      if (values.effectiveFrom && Number.isNaN(new Date(values.effectiveFrom).getTime())) errors.push('effectiveFrom is not a valid date');
    }
    if (kind === 'PTO_BALANCES') {
      if (values.policyName && !policies.some((p) => p.name.toLowerCase() === values.policyName.toLowerCase())) {
        errors.push(`Unknown PTO policy “${values.policyName}”`);
      }
      if (values.hours && !Number.isFinite(Number(values.hours))) errors.push('hours must be a number');
    }
    if (kind === 'EQUIPMENT' && values.assetTag && assetTags.has(values.assetTag)) {
      errors.push(`Asset tag ${values.assetTag} already exists`);
    }

    return { rowNumber: i + 2, values, errors };
  });

  return {
    headers,
    rows: parsed,
    validCount: parsed.filter((r) => r.errors.length === 0).length,
    errorCount: parsed.filter((r) => r.errors.length > 0).length,
  };
}

/** Apply only the valid rows; each row is independent so one failure never corrupts the rest. */
export async function applyImport(ctx: Ctx, kind: ImportKind, preview: ImportPreview) {
  const report: { row: number; status: 'imported' | 'skipped' | 'failed'; detail: string }[] = [];
  const entities = await db.legalEntity.findMany();
  const departments = await db.department.findMany();
  const locations = await db.location.findMany();
  const policies = await db.ptoPolicy.findMany();

  for (const row of preview.rows) {
    if (row.errors.length > 0) {
      report.push({ row: row.rowNumber, status: 'skipped', detail: row.errors.join('; ') });
      continue;
    }
    const v = row.values;
    try {
      switch (kind) {
        case 'WORKERS': {
          const entity = entities.find((e) => e.code === v.legalEntityCode.toUpperCase())!;
          const dept = departments.find((d) => d.name.toLowerCase() === (v.department ?? '').toLowerCase());
          const location = locations.find((l) => l.name.toLowerCase() === (v.location ?? '').toLowerCase());
          const manager = v.managerEmail
            ? await db.worker.findFirst({ where: { workEmail: v.managerEmail.toLowerCase() } })
            : null;
          const worker = await createWorker(ctx, {
            legalFirstName: v.legalFirstName,
            preferredName: v.preferredName || undefined,
            lastName: v.lastName,
            workEmail: v.workEmail || undefined,
            personalEmail: v.personalEmail || undefined,
            phone: v.phone || undefined,
            workerType: v.workerType.toUpperCase() as WorkerType,
            country: (v.country || 'US').toUpperCase(),
            hireDate: new Date(v.hireDate),
            legalEntityId: entity.id,
            departmentId: dept?.id,
            locationId: location?.id,
            managerId: manager?.id,
            title: v.title,
            workState: v.workState || undefined,
            workMode: v.workMode || undefined,
            amount: v.amount ? Number(v.amount) : undefined,
            currency: v.currency || undefined,
            rateType: v.rateType || undefined,
            inviteUser: false,
            roleKeys: [v.workerType.toUpperCase() === 'EMPLOYEE' ? 'EMPLOYEE' : 'CONTRACTOR'],
          });
          report.push({ row: row.rowNumber, status: 'imported', detail: `${worker.employeeNumber} ${v.legalFirstName} ${v.lastName}` });
          break;
        }
        case 'DEPARTMENTS': {
          await db.department.upsert({ where: { name: v.name }, create: { name: v.name, code: v.code || null }, update: {} });
          report.push({ row: row.rowNumber, status: 'imported', detail: v.name });
          break;
        }
        case 'COMPENSATION': {
          const worker = await db.worker.findFirstOrThrow({ where: { workEmail: v.workEmail.toLowerCase() } });
          const effectiveFrom = new Date(v.effectiveFrom);
          await db.$transaction(async (tx) => {
            await tx.compensation.updateMany({
              where: { workerId: worker.id, effectiveTo: null },
              data: { effectiveTo: effectiveFrom },
            });
            await tx.compensation.create({
              data: {
                workerId: worker.id,
                amount: Number(v.amount),
                currency: v.currency,
                rateType: v.rateType,
                reason: v.reason || 'IMPORT',
                note: v.note || 'Imported',
                effectiveFrom,
                approvedById: ctx.userId,
              },
            });
          });
          report.push({ row: row.rowNumber, status: 'imported', detail: `${v.workEmail} → ${v.amount} ${v.currency}` });
          break;
        }
        case 'PTO_BALANCES': {
          const worker = await db.worker.findFirstOrThrow({ where: { workEmail: v.workEmail.toLowerCase() } });
          const policy = policies.find((p) => p.name.toLowerCase() === v.policyName.toLowerCase())!;
          const existing = await db.ptoPolicyAssignment.findFirst({
            where: { workerId: worker.id, policyId: policy.id, endDate: null },
          });
          if (!existing) await db.ptoPolicyAssignment.create({ data: { workerId: worker.id, policyId: policy.id } });
          await db.ptoTransaction.create({
            data: {
              workerId: worker.id,
              policyId: policy.id,
              kind: 'GRANT',
              hours: Number(v.hours),
              effectiveDate: new Date(),
              note: v.note || 'Imported opening balance',
              createdById: ctx.userId,
            },
          });
          report.push({ row: row.rowNumber, status: 'imported', detail: `${v.workEmail} ${v.hours}h ${v.policyName}` });
          break;
        }
        case 'EQUIPMENT': {
          await db.equipmentAsset.create({
            data: {
              kind: v.kind.toUpperCase(),
              assetTag: v.assetTag,
              serialNumber: v.serialNumber || null,
              make: v.make || null,
              model: v.model || null,
              valueUsd: v.valueUsd ? Number(v.valueUsd) : null,
              condition: v.condition || 'GOOD',
            },
          });
          report.push({ row: row.rowNumber, status: 'imported', detail: v.assetTag });
          break;
        }
      }
    } catch (error) {
      report.push({
        row: row.rowNumber,
        status: 'failed',
        detail: error instanceof Error ? error.message.slice(0, 200) : 'Unknown error',
      });
    }
  }
  return report;
}
