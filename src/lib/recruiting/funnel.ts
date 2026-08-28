import 'server-only';
import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';

/**
 * The parts of the hiring funnel that are not a job board.
 *
 * Referrals are usually the highest-quality and fastest-closing channel a
 * distributor has, and silver-medallist candidates are people we already
 * interviewed and liked. Both are cheap to run and both are normally lost
 * because nothing records them.
 */

/** Days after the referred hire's start date at which a bonus becomes payable. */
export const REFERRAL_BONUS_WAIT_DAYS = 90;

export function bonusEligibleDate(startDate: Date): Date {
  return new Date(startDate.getTime() + REFERRAL_BONUS_WAIT_DAYS * 86_400_000);
}

/**
 * Link a referral to the candidate it named, matching on email.
 *
 * Matching is on email only. Name matching would attach a referral bonus to
 * the wrong person the first time two candidates share a name, and that is a
 * payment, so it has to be exact.
 */
export async function linkReferralsForCandidate(candidateId: string): Promise<number> {
  const candidate = await db.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, email: true },
  });
  if (!candidate?.email) return 0;

  const result = await db.referral.updateMany({
    where: {
      candidateId: null,
      status: 'SUBMITTED',
      candidateEmail: { equals: candidate.email, mode: 'insensitive' },
    },
    data: { candidateId: candidate.id, status: 'LINKED' },
  });
  return result.count;
}

/**
 * A referred candidate was hired. Records the outcome and opens the bonus for
 * approval — this system never pays anything, it produces the record payroll
 * pays from.
 */
export async function markReferralHired(candidateId: string, startDate: Date): Promise<void> {
  await db.referral.updateMany({
    where: { candidateId, status: { in: ['SUBMITTED', 'LINKED'] } },
    data: {
      status: 'HIRED',
      bonusStatus: 'PENDING',
      bonusEligibleAt: bonusEligibleDate(startDate),
    },
  });
}

// ---------------------------------------------------------------------------
// Candidate communication
// ---------------------------------------------------------------------------

export type CandidateEmailKind = 'RECEIVED' | 'ADVANCED' | 'REJECTED' | 'POOL_INVITE';

/**
 * Tell a candidate where they stand.
 *
 * A silent pipeline costs offers, and it is the single most common complaint
 * candidates have about employers. These are short, factual and never promise
 * a timeline the company has not committed to.
 *
 * Every send is recorded as an EmailMessage, so "did we ever reply to this
 * person?" is answerable.
 */
export async function sendCandidateEmail(opts: {
  candidateId: string;
  kind: CandidateEmailKind;
  jobTitle: string;
  /** Free text from a recruiter, appended verbatim. Optional. */
  note?: string | null;
}): Promise<boolean> {
  const candidate = await db.candidate.findUnique({
    where: { id: opts.candidateId },
    select: { firstName: true, email: true },
  });
  if (!candidate?.email) return false;

  const company = env.INDEED_COMPANY_NAME;
  const bodies: Record<CandidateEmailKind, { subject: string; heading: string; body: string }> = {
    RECEIVED: {
      subject: `We received your application — ${opts.jobTitle}`,
      heading: `Thanks for applying, ${candidate.firstName}`,
      body: `We have your application for <strong>${opts.jobTitle}</strong> at ${company} and the hiring team is reviewing it. If it looks like a fit we will be in touch to arrange a first conversation.`,
    },
    ADVANCED: {
      subject: `Next steps — ${opts.jobTitle}`,
      heading: `Good news, ${candidate.firstName}`,
      body: `The hiring team would like to move forward with your application for <strong>${opts.jobTitle}</strong>. Someone will contact you shortly to arrange the next conversation.`,
    },
    REJECTED: {
      subject: `Your application — ${opts.jobTitle}`,
      heading: `Thank you for your time, ${candidate.firstName}`,
      body: `We have decided not to move forward with your application for <strong>${opts.jobTitle}</strong> at this time. We appreciate the time you gave us, and we would be glad to hear from you about future openings.`,
    },
    POOL_INVITE: {
      subject: `A role at ${company} you might want to see`,
      heading: `Hello ${candidate.firstName}`,
      body: `We spoke with you previously about <strong>${opts.jobTitle}</strong> and kept your details on file with your interest in mind. A similar role has opened and we wanted you to hear about it first.`,
    },
  };

  const template = bodies[opts.kind];
  const noteHtml = opts.note ? `<p>${escapeHtml(opts.note)}</p>` : '';
  await sendEmail({
    to: candidate.email,
    subject: template.subject,
    heading: template.heading,
    bodyHtml: `<p>${template.body}</p>${noteHtml}`,
    ctaLabel: 'See our open roles',
    ctaUrl: `${env.APP_BASE_URL.replace(/\/$/, '')}/careers`,
    templateKey: `candidate.${opts.kind.toLowerCase()}`,
    relatedType: 'Candidate',
    relatedId: opts.candidateId,
  });
  return true;
}

/** Recruiter-authored text reaches an outside inbox — escape it. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Talent pool
// ---------------------------------------------------------------------------

/**
 * Candidates worth revisiting for an open role.
 *
 * Deliberately narrow: only people explicitly added to the pool, and only
 * those whose review date has not passed. Keeping someone's details forever
 * because they once applied is not something to do silently, so every entry
 * carries a review date and the list stops offering them once it lapses.
 */
export async function talentPoolMatches(opts: { jobFamily?: string | null; limit?: number } = {}) {
  const now = new Date();
  return db.talentPoolEntry.findMany({
    where: {
      status: { in: ['ACTIVE', 'CONTACTED'] },
      OR: [{ reviewBy: null }, { reviewBy: { gte: now } }],
      ...(opts.jobFamily ? { jobFamily: opts.jobFamily } : {}),
    },
    include: {
      candidate: {
        select: { id: true, firstName: true, lastName: true, email: true, resumeText: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: opts.limit ?? 50,
  });
}

/** Pool entries whose review date has passed and which need a keep-or-remove decision. */
export async function talentPoolDueForReview() {
  return db.talentPoolEntry.findMany({
    where: { status: { in: ['ACTIVE', 'CONTACTED'] }, reviewBy: { lt: new Date() } },
    include: { candidate: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { reviewBy: 'asc' },
  });
}
