import 'server-only';
import { db } from '@/lib/db';
import { emitEvent } from '@/lib/workflows';
import { retryFailedEmails } from '@/lib/email';
import { runAccrualsForAll } from '@/lib/pto';
import { startOfUTCDay, isoDate, addDays } from '@/lib/format';
import { drainWebhooks } from '@/lib/webhooks';
import { requestsAwaitingStorage, storeSignedArtifacts } from '@/lib/signatures';

/**
 * Scheduled maintenance sweep. Invoked by:
 *  - POST /api/internal/maintenance (Super Admin or CRON secret) — wire this
 *    to a daily scheduler (Vercel Cron, GitHub Actions, systemd timer).
 *  - The dev "Run maintenance" button in Admin → Workflows.
 *
 * Everything here is idempotent per day via workflow dedupeKeys and
 * status-guarded updates.
 */
export async function runMaintenance(): Promise<Record<string, number>> {
  const today = startOfUTCDay();
  const todayKey = isoDate(today);
  const counters: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counters[k] = (counters[k] ?? 0) + n);

  // 1. Birthdays & anniversaries
  const workers = await db.worker.findMany({
    where: { status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'] }, deletedAt: null },
    select: { id: true, dateOfBirth: true, hireDate: true },
  });
  for (const w of workers) {
    if (
      w.dateOfBirth &&
      w.dateOfBirth.getUTCMonth() === today.getUTCMonth() &&
      w.dateOfBirth.getUTCDate() === today.getUTCDate()
    ) {
      await emitEvent({ type: 'BIRTHDAY', workerId: w.id, dedupeKey: `bday:${w.id}:${todayKey}` });
      bump('birthdays');
    }
    if (
      w.hireDate &&
      w.hireDate.getUTCMonth() === today.getUTCMonth() &&
      w.hireDate.getUTCDate() === today.getUTCDate() &&
      w.hireDate.getUTCFullYear() < today.getUTCFullYear()
    ) {
      await emitEvent({ type: 'ANNIVERSARY', workerId: w.id, dedupeKey: `anniv:${w.id}:${todayKey}` });
      bump('anniversaries');
    }
  }

  // 2. Start dates approaching (7 days out)
  const upcoming = await db.worker.findMany({
    where: {
      status: { in: ['PRE_START', 'ONBOARDING'] },
      hireDate: { gte: today, lte: addDays(today, 7) },
      deletedAt: null,
    },
    select: { id: true },
  });
  for (const w of upcoming) {
    await emitEvent({ type: 'START_DATE_APPROACHING', workerId: w.id, dedupeKey: `start:${w.id}:${todayKey}` });
    bump('startDates');
  }

  // 3. Documents expiring within 30 days (work authorization etc.)
  const expiring = await db.document.findMany({
    where: { expiresAt: { gte: today, lte: addDays(today, 30) }, deletedAt: null },
    select: { id: true, workerId: true, title: true },
  });
  for (const d of expiring) {
    await emitEvent({
      type: 'DOCUMENT_EXPIRING',
      workerId: d.workerId ?? undefined,
      dedupeKey: `docexp:${d.id}:${todayKey.slice(0, 7)}`, // once per month per doc
      data: { detail: d.title },
    });
    bump('documentsExpiring');
  }

  // 4. Contractor agreements expiring within 60 days
  const contracts = await db.contractorProfile.findMany({
    where: { contractEnd: { gte: today, lte: addDays(today, 60) } },
    select: { workerId: true, contractEnd: true },
  });
  for (const c of contracts) {
    await emitEvent({
      type: 'CONTRACT_EXPIRING',
      workerId: c.workerId,
      dedupeKey: `contract:${c.workerId}:${todayKey.slice(0, 7)}`,
      data: { detail: `Contract ends ${isoDate(c.contractEnd)}` },
    });
    bump('contractsExpiring');
  }

  // 5. Mark overdue training + emit events
  const overdueTraining = await db.trainingAssignment.findMany({
    where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] }, dueDate: { lt: today } },
    select: { id: true, workerId: true, course: { select: { title: true } } },
  });
  for (const t of overdueTraining) {
    await db.trainingAssignment.update({ where: { id: t.id }, data: { status: 'OVERDUE' } });
    await emitEvent({
      type: 'TRAINING_OVERDUE',
      workerId: t.workerId,
      dedupeKey: `training:${t.id}`,
      data: { detail: t.course.title },
    });
    bump('trainingOverdue');
  }

  // 6. Equipment past return due date
  const unreturned = await db.equipmentAssignment.findMany({
    where: { returnedAt: null, returnRequired: true, returnDueDate: { lt: today } },
    select: { id: true, workerId: true, asset: { select: { assetTag: true, kind: true } } },
  });
  for (const e of unreturned) {
    await emitEvent({
      type: 'EQUIPMENT_UNRETURNED',
      workerId: e.workerId,
      dedupeKey: `equip:${e.id}:${todayKey.slice(0, 7)}`,
      data: { detail: `${e.asset.kind} ${e.asset.assetTag}` },
    });
    bump('equipmentUnreturned');
  }

  // 7. PTO accruals (monthly grant policies accrue on the 1st; idempotent)
  bump('ptoAccruals', await runAccrualsForAll(today));

  // 8. Retry failed emails
  bump('emailRetries', await retryFailedEmails());

  // 9. Certifications approaching expiry — a lapsed forklift ticket stops a
  //    shift, so it is worth the same warning as an expiring document.
  const expiringCerts = await db.workerSkill.findMany({
    where: {
      expiresAt: { not: null, gte: today, lte: addDays(today, 30) },
      worker: { status: { in: ['ACTIVE', 'ON_LEAVE'] }, deletedAt: null },
      skill: { active: true },
    },
    select: { id: true, workerId: true, expiresAt: true, skill: { select: { name: true } } },
  });
  for (const cert of expiringCerts) {
    await emitEvent({
      type: 'DOCUMENT_EXPIRING',
      workerId: cert.workerId ?? undefined,
      dedupeKey: `cert:${cert.id}:${todayKey.slice(0, 7)}`,
      data: { detail: `${cert.skill.name} expires ${isoDate(cert.expiresAt)}` },
    });
    bump('certificationsExpiring');
  }

  // 10. Retry signatures the provider says are done but whose bytes we do not
  //     yet hold. Until the file and certificate are in our own storage, the
  //     evidence lives only at the vendor.
  const awaitingStorage = await requestsAwaitingStorage();
  for (const request of awaitingStorage) {
    const result = await storeSignedArtifacts(request.id);
    bump(result.stored ? 'signaturesStored' : 'signatureStoreFailures');
  }

  // 11. Signature requests past their due date, so a chase is prompted rather
  //     than forgotten.
  const overdueSignatures = await db.signatureRequest.findMany({
    where: { status: { in: ['SENT', 'VIEWED'] }, dueAt: { lt: today } },
    select: { id: true, workerId: true, dueAt: true, documentVersion: { select: { document: { select: { title: true } } } } },
  });
  for (const request of overdueSignatures) {
    await emitEvent({
      type: 'DOCUMENT_EXPIRING',
      workerId: request.workerId,
      dedupeKey: `sig:${request.id}:${todayKey}`,
      data: { detail: `Signature overdue: ${request.documentVersion.document.title}` },
    });
    bump('signaturesOverdue');
  }

  // 12. Deliver queued webhooks. Last, so a slow endpoint cannot delay the
  //     rest of the sweep.
  const webhooks = await drainWebhooks();
  bump('webhooksDelivered', webhooks.delivered);
  bump('webhooksFailed', webhooks.failed);
  bump('webhooksAbandoned', webhooks.abandoned);

  return counters;
}
