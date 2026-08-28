import 'server-only';
import { db } from '@/lib/db';

/**
 * Skills and certification inventory.
 *
 * Training records that someone took a course. This records that someone can
 * do a thing, and — for certifications — whether the credential behind it is
 * still current. Two questions fall out of the same data and neither is
 * answerable from training history alone:
 *
 *   "Who can run a forklift at the Exton branch on Tuesday?"
 *   "Which critical skills are we one person deep on?"
 *
 * Coverage risk is the reason this exists. A distributor that loses its only
 * certified operator stops shipping.
 */

export const SKILL_CATEGORIES = [
  'SAFETY',
  'EQUIPMENT',
  'PRODUCT',
  'SYSTEM',
  'LANGUAGE',
  'LEADERSHIP',
  'TRADE',
  'OTHER',
] as const;

export const SKILL_LEVELS: Record<number, string> = {
  1: 'Aware',
  2: 'Working',
  3: 'Proficient',
  4: 'Expert',
  5: 'Can teach it',
};

/** Days before expiry at which a certification starts being called out. */
export const EXPIRY_WARNING_DAYS = 60;

export type CertificationState = 'CURRENT' | 'EXPIRING' | 'EXPIRED' | 'NOT_APPLICABLE';

export function certificationState(expiresAt: Date | null | undefined, now = new Date()): CertificationState {
  if (!expiresAt) return 'NOT_APPLICABLE';
  const ms = expiresAt.getTime() - now.getTime();
  if (ms < 0) return 'EXPIRED';
  if (ms <= EXPIRY_WARNING_DAYS * 86_400_000) return 'EXPIRING';
  return 'CURRENT';
}

/** A skill only counts toward coverage if it is usable *today*. */
export function countsTowardCoverage(
  holder: { level: number; expiresAt: Date | null; verifiedAt: Date | null },
  skill: { isCertification: boolean; isCritical: boolean },
  minLevel = 3,
  now = new Date(),
): boolean {
  if (holder.level < minLevel) return false;
  if (certificationState(holder.expiresAt, now) === 'EXPIRED') return false;
  // A critical skill claimed but never verified by anyone is not something to
  // stake a shift on. Ordinary skills are taken at face value.
  if (skill.isCritical && !holder.verifiedAt) return false;
  return true;
}

export interface CoverageRow {
  skillId: string;
  skillName: string;
  category: string;
  isCritical: boolean;
  isCertification: boolean;
  /** Holders who count today (level, expiry and verification all satisfied). */
  coveredBy: number;
  /** Holders recorded at all, including lapsed or unverified ones. */
  claimedBy: number;
  expiringSoon: number;
  expired: number;
  risk: 'NONE' | 'SINGLE_POINT' | 'THIN' | 'UNCOVERED';
}

/**
 * Coverage risk across the skill catalog.
 *
 * UNCOVERED   nobody can do it today
 * SINGLE_POINT exactly one person can — a resignation or a lapsed cert stops work
 * THIN        two people, so one holiday overlaps into a gap
 *
 * Risk is only reported for skills flagged critical; everything else is
 * inventory, and calling it "risk" would train people to ignore the word.
 */
export async function skillCoverage(now = new Date()): Promise<CoverageRow[]> {
  const skills = await db.skill.findMany({
    where: { active: true },
    include: {
      workerSkills: {
        // Someone who has left is not coverage.
        where: { worker: { status: { in: ['ACTIVE', 'ON_LEAVE'] }, deletedAt: null } },
        select: { level: true, expiresAt: true, verifiedAt: true },
      },
    },
    orderBy: [{ isCritical: 'desc' }, { name: 'asc' }],
  });

  return skills.map((skill) => {
    const holders = skill.workerSkills;
    const covered = holders.filter((h) => countsTowardCoverage(h, skill, 3, now));
    const expiringSoon = holders.filter((h) => certificationState(h.expiresAt, now) === 'EXPIRING').length;
    const expired = holders.filter((h) => certificationState(h.expiresAt, now) === 'EXPIRED').length;

    let risk: CoverageRow['risk'] = 'NONE';
    if (skill.isCritical) {
      if (covered.length === 0) risk = 'UNCOVERED';
      else if (covered.length === 1) risk = 'SINGLE_POINT';
      else if (covered.length === 2) risk = 'THIN';
    }

    return {
      skillId: skill.id,
      skillName: skill.name,
      category: skill.category,
      isCritical: skill.isCritical,
      isCertification: skill.isCertification,
      coveredBy: covered.length,
      claimedBy: holders.length,
      expiringSoon,
      expired,
      risk,
    };
  });
}

export interface SkillGap {
  skillId: string;
  skillName: string;
  requiredLevel: number;
  required: boolean;
  workerLevel: number | null;
  met: boolean;
}

/**
 * How one worker measures against a set of requirements. Used for internal
 * mobility ("could this person do that job?") and for readiness checks.
 *
 * This is a comparison of recorded skills against stated requirements. It is
 * not a hiring or promotion decision, and it produces no score.
 */
export async function skillGapForWorker(workerId: string, requisitionId: string): Promise<SkillGap[]> {
  const [requirements, held] = await Promise.all([
    db.jobSkillRequirement.findMany({ where: { requisitionId }, include: { skill: true } }),
    db.workerSkill.findMany({ where: { workerId } }),
  ]);
  const byId = new Map(held.map((h) => [h.skillId, h]));
  return requirements.map((req) => {
    const holder = byId.get(req.skillId);
    const usable = holder && certificationState(holder.expiresAt) !== 'EXPIRED' ? holder.level : null;
    return {
      skillId: req.skillId,
      skillName: req.skill.name,
      requiredLevel: req.minLevel,
      required: req.required,
      workerLevel: usable,
      met: usable !== null && usable >= req.minLevel,
    };
  });
}

/** Certifications lapsing inside the warning window, soonest first. */
export async function expiringCertifications(withinDays = EXPIRY_WARNING_DAYS, now = new Date()) {
  const cutoff = new Date(now.getTime() + withinDays * 86_400_000);
  return db.workerSkill.findMany({
    where: {
      expiresAt: { not: null, lte: cutoff },
      worker: { status: { in: ['ACTIVE', 'ON_LEAVE'] }, deletedAt: null },
      skill: { active: true },
    },
    include: {
      skill: { select: { id: true, name: true, isCritical: true, validityMonths: true } },
      worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
    },
    orderBy: { expiresAt: 'asc' },
  });
}

/**
 * Recompute the expiry date for a certification from the skill's validity
 * period. Certifications with no stated validity never expire.
 */
export function nextExpiry(validityMonths: number | null | undefined, from: Date): Date | null {
  if (!validityMonths || validityMonths <= 0) return null;
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + validityMonths);
  return d;
}
