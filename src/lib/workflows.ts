import 'server-only';
import { createHmac } from 'crypto';
import { db } from '@/lib/db';
import { createTask } from '@/lib/tasks';
import { notifyUser, notifyRole } from '@/lib/notify';
import { sendEmail } from '@/lib/email';
import { startLifecycle } from '@/lib/lifecycle';
import { audienceMatches, workerFacts, type Audience } from '@/lib/audience';
import { addDays, fullName } from '@/lib/format';
import { decryptField } from '@/lib/crypto';
import { env } from '@/lib/env';

/**
 * Workflow automation engine ("if this → then that", §36).
 *
 * Domain code calls emitEvent(); every enabled WorkflowDefinition with a
 * matching trigger is evaluated against the worker's population facts, and
 * its action list runs. Each evaluation is recorded as a WorkflowRun with a
 * step-by-step log. Scheduled triggers (birthdays, expirations, start dates)
 * are emitted by the maintenance job (src/lib/jobs.ts) with a dedupeKey so
 * repeated scans never double-fire.
 */

export const WORKFLOW_TRIGGERS = [
  'WORKER_ADDED',
  'START_DATE_APPROACHING',
  'OFFER_ACCEPTED',
  'BIRTHDAY',
  'ANNIVERSARY',
  'TITLE_CHANGED',
  'DEPARTMENT_CHANGED',
  'MANAGER_CHANGED',
  'PTO_SUBMITTED',
  'PTO_APPROVED',
  'TRAINING_OVERDUE',
  'DOCUMENT_EXPIRING',
  'CONTRACT_EXPIRING',
  'REVIEW_CYCLE_STARTED',
  'TERMINATION_SCHEDULED',
  'EQUIPMENT_UNRETURNED',
  'CANDIDATE_APPLIED',
] as const;

export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export interface DomainEvent {
  type: WorkflowTrigger;
  workerId?: string;
  dedupeKey?: string;
  data?: Record<string, unknown>;
}

export interface WorkflowAction {
  type:
    | 'CREATE_TASK'
    | 'SEND_EMAIL'
    | 'NOTIFY_USER'
    | 'NOTIFY_ROLE'
    | 'ASSIGN_TRAINING'
    | 'ASSIGN_POLICY'
    | 'REQUEST_DOCUMENT'
    | 'START_ONBOARDING'
    | 'START_OFFBOARDING'
    | 'WEBHOOK';
  [key: string]: unknown;
}

export async function emitEvent(event: DomainEvent): Promise<void> {
  const definitions = await db.workflowDefinition.findMany({
    where: { trigger: event.type, enabled: true, isTemplate: false },
  });
  for (const def of definitions) {
    // Dedupe scheduled events (birthday scans etc.)
    if (event.dedupeKey) {
      const prior = await db.workflowRun.findFirst({
        where: { definitionId: def.id, event: { path: ['dedupeKey'], equals: event.dedupeKey } },
        select: { id: true },
      });
      if (prior) continue;
    }
    await runDefinition(def.id, event).catch(() => {
      /* failure already recorded on the WorkflowRun */
    });
  }
}

async function runDefinition(definitionId: string, event: DomainEvent) {
  const def = await db.workflowDefinition.findUniqueOrThrow({ where: { id: definitionId } });
  const log: string[] = [];
  const run = await db.workflowRun.create({
    data: { definitionId, event: JSON.parse(JSON.stringify(event)) },
  });
  try {
    // Condition check against worker population facts
    if (event.workerId) {
      const facts = await workerFacts(event.workerId);
      if (!facts || !audienceMatches(def.conditions as Audience, facts)) {
        await db.workflowRun.update({
          where: { id: run.id },
          data: { status: 'SKIPPED', log: ['Conditions did not match'], finishedAt: new Date() },
        });
        return;
      }
    }

    const actions = (def.actions as unknown as WorkflowAction[]) ?? [];
    for (const action of actions) {
      await runAction(action, event, log);
    }
    await db.workflowRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', log, finishedAt: new Date() },
    });
  } catch (err) {
    await db.workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        log,
        error: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

async function workerBits(workerId: string | undefined) {
  if (!workerId) return null;
  return db.worker.findUnique({
    where: { id: workerId },
    include: {
      user: { select: { id: true, email: true } },
      employments: {
        where: { effectiveTo: null },
        take: 1,
        include: { manager: { include: { user: { select: { id: true, email: true } } } } },
      },
    },
  });
}

async function runAction(action: WorkflowAction, event: DomainEvent, log: string[]) {
  const worker = await workerBits(event.workerId);
  const name = worker ? fullName(worker) : 'worker';

  const interpolate = (s: string) =>
    s
      .replace(/\{\{worker\}\}/g, name)
      .replace(/\{\{trigger\}\}/g, event.type)
      .replace(/\{\{detail\}\}/g, String(event.data?.detail ?? ''));

  switch (action.type) {
    case 'CREATE_TASK': {
      const ownerRoleKey = (action.ownerRoleKey as string) || null;
      let ownerUserId: string | null = null;
      if (action.owner === 'MANAGER') ownerUserId = worker?.employments[0]?.manager?.user?.id ?? null;
      if (action.owner === 'EMPLOYEE') ownerUserId = worker?.user?.id ?? null;
      await createTask({
        title: interpolate(String(action.title ?? 'Workflow task')),
        description: action.description ? interpolate(String(action.description)) : undefined,
        category: (action.category as never) ?? 'GENERAL',
        workerId: event.workerId ?? null,
        ownerUserId,
        ownerRoleKey: ownerUserId ? null : (ownerRoleKey ?? 'HR_ADMIN'),
        dueDate: addDays(new Date(), Number(action.dueOffsetDays ?? 3)),
        priority: (action.priority as never) ?? 'NORMAL',
        sourceType: 'WORKFLOW',
      });
      log.push(`Created task "${interpolate(String(action.title ?? ''))}"`);
      break;
    }
    case 'SEND_EMAIL': {
      let to: string | null = null;
      if (action.recipient === 'WORKER') to = worker?.workEmail ?? worker?.personalEmail ?? null;
      if (action.recipient === 'MANAGER') to = worker?.employments[0]?.manager?.user?.email ?? null;
      if (typeof action.recipient === 'string' && action.recipient.includes('@')) to = action.recipient;
      if (to) {
        await sendEmail({
          to,
          subject: interpolate(String(action.subject ?? 'FSW People notification')),
          heading: interpolate(String(action.subject ?? 'FSW People notification')),
          bodyHtml: `<p>${interpolate(String(action.body ?? ''))}</p>`,
          templateKey: 'workflow',
        });
        log.push(`Sent email to ${to}`);
      } else {
        log.push('SEND_EMAIL skipped: no recipient resolved');
      }
      break;
    }
    case 'NOTIFY_USER': {
      const target =
        action.userTarget === 'MANAGER'
          ? worker?.employments[0]?.manager?.user?.id
          : action.userTarget === 'EMPLOYEE'
            ? worker?.user?.id
            : (action.userId as string | undefined);
      if (target) {
        await notifyUser(target, { title: interpolate(String(action.title ?? event.type)), body: action.body ? interpolate(String(action.body)) : undefined, href: action.href as string | undefined });
        log.push('Notified user');
      } else log.push('NOTIFY_USER skipped: no target');
      break;
    }
    case 'NOTIFY_ROLE': {
      await notifyRole(String(action.roleKey ?? 'HR_ADMIN'), {
        title: interpolate(String(action.title ?? event.type)),
        body: action.body ? interpolate(String(action.body)) : undefined,
        href: action.href as string | undefined,
      });
      log.push(`Notified role ${action.roleKey}`);
      break;
    }
    case 'ASSIGN_TRAINING': {
      if (!event.workerId || !action.courseId) {
        log.push('ASSIGN_TRAINING skipped');
        break;
      }
      const course = await db.trainingCourse.findUnique({ where: { id: String(action.courseId) } });
      if (course) {
        await db.trainingAssignment.create({
          data: {
            courseId: course.id,
            workerId: event.workerId,
            dueDate: addDays(new Date(), course.dueDays),
          },
        });
        log.push(`Assigned training "${course.title}"`);
      }
      break;
    }
    case 'ASSIGN_POLICY': {
      if (!event.workerId || !action.policyId) {
        log.push('ASSIGN_POLICY skipped');
        break;
      }
      const version = await db.policyVersion.findFirst({
        where: { policyId: String(action.policyId), publishedAt: { not: null } },
        orderBy: { version: 'desc' },
      });
      if (version) {
        await db.policyAcknowledgment.upsert({
          where: { policyVersionId_workerId: { policyVersionId: version.id, workerId: event.workerId } },
          create: { policyVersionId: version.id, workerId: event.workerId },
          update: {},
        });
        log.push('Assigned policy for acknowledgment');
      }
      break;
    }
    case 'REQUEST_DOCUMENT': {
      const worker2 = await workerBits(event.workerId);
      await createTask({
        title: interpolate(String(action.title ?? `Provide document: ${action.documentKind ?? ''}`)),
        category: 'DOCUMENT',
        workerId: event.workerId ?? null,
        ownerUserId: worker2?.user?.id ?? null,
        ownerRoleKey: worker2?.user?.id ? null : 'HR_ADMIN',
        dueDate: addDays(new Date(), Number(action.dueOffsetDays ?? 7)),
        sourceType: 'WORKFLOW',
      });
      log.push('Requested document');
      break;
    }
    case 'START_ONBOARDING': {
      if (event.workerId) {
        await startLifecycle({ workerId: event.workerId, kind: 'ONBOARDING', startDate: new Date() });
        log.push('Started onboarding');
      }
      break;
    }
    case 'START_OFFBOARDING': {
      if (event.workerId) {
        await startLifecycle({ workerId: event.workerId, kind: 'OFFBOARDING', startDate: new Date() });
        log.push('Started offboarding');
      }
      break;
    }
    case 'WEBHOOK': {
      const endpoints = await db.webhookEndpoint.findMany({ where: { active: true } });
      const body = JSON.stringify({ type: event.type, workerId: event.workerId, data: event.data ?? {}, ts: Date.now() });
      for (const ep of endpoints) {
        const events = (ep.events as string[]) ?? [];
        if (events.length && !events.includes(event.type)) continue;
        const secret = decryptField(ep.secretEnc);
        const signature = createHmac('sha256', secret).update(body).digest('hex');
        await fetch(ep.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-fsw-signature': signature },
          body,
          signal: AbortSignal.timeout(5000),
        }).catch((e) => log.push(`Webhook ${ep.url} failed: ${e.message}`));
      }
      log.push(`Dispatched webhook(s) to ${endpoints.length} endpoint(s)`);
      break;
    }
    default:
      log.push(`Unknown action type ${(action as { type?: string }).type ?? '?'} skipped`);
  }
}

// Base URL export used by workflow emails
export const appBaseUrl = env.APP_BASE_URL;
