import 'server-only';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { INDEED_BOARD, type FeedJob } from '@/lib/indeed';

/**
 * The public view of a job. Everything here is safe for the open internet:
 * no hiring manager, no headcount, no replacement flag, no approval history,
 * and no salary unless the recruiter explicitly ticked "show salary" when
 * publishing.
 */
export interface PublicPosting extends FeedJob {
  postingId: string;
  showSalary: boolean;
}

/** "Exton, PA" / "Manila, Philippines" / "Remote" -> city + state. */
export function splitLocation(location: string): { city: string; state: string | null } {
  const parts = location
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { city: location.trim() || 'Remote', state: null };
  if (parts.length === 1) return { city: parts[0], state: null };
  return { city: parts[0], state: parts[1] };
}

const COUNTRY_HINTS: Record<string, string> = {
  philippines: 'PH',
  ph: 'PH',
  'united states': 'US',
  usa: 'US',
  us: 'US',
};

/**
 * Load every job currently published to a board, shaped for the feed and for
 * the public careers pages. A posting only counts as published while its
 * requisition is actually OPEN — closing a job removes it from the feed on
 * Indeed's next crawl without anyone having to remember to unpublish it.
 */
export async function publishedPostings(board: string = INDEED_BOARD): Promise<PublicPosting[]> {
  const postings = await db.jobBoardPosting.findMany({
    where: { board, status: 'PUBLISHED', requisition: { status: 'OPEN' } },
    include: { requisition: true },
    orderBy: { publishedAt: 'desc' },
  });

  const entityIds = [...new Set(postings.map((p) => p.requisition.legalEntityId).filter(Boolean))] as string[];
  const departmentIds = [...new Set(postings.map((p) => p.requisition.departmentId).filter(Boolean))] as string[];
  const [entities, departments] = await Promise.all([
    entityIds.length
      ? db.legalEntity.findMany({ where: { id: { in: entityIds } }, select: { id: true, country: true } })
      : Promise.resolve([]),
    departmentIds.length
      ? db.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const countryById = new Map(entities.map((e) => [e.id, e.country]));
  const deptById = new Map(departments.map((d) => [d.id, d.name]));

  const base = env.APP_BASE_URL.replace(/\/$/, '');

  return postings.map((posting) => {
    const req = posting.requisition;
    const location = posting.publicLocation || req.locationText || 'Exton, PA';
    const { city, state } = splitLocation(location);
    const country =
      COUNTRY_HINTS[(state ?? '').toLowerCase()] ??
      (req.legalEntityId ? countryById.get(req.legalEntityId) : null) ??
      'US';
    return {
      postingId: posting.id,
      id: req.id,
      referenceNumber: req.id,
      title: posting.publicTitle || req.title,
      description: req.description?.trim() || `${req.title} at ${env.INDEED_COMPANY_NAME}.`,
      requirements: req.requirements,
      location,
      city,
      state: country === 'US' ? state : null,
      country,
      employmentType: req.employmentType,
      remoteType: posting.remoteType,
      department: req.departmentId ? (deptById.get(req.departmentId) ?? null) : null,
      showSalary: posting.showSalary,
      salaryMin: posting.showSalary && req.salaryMin ? Number(req.salaryMin) : null,
      salaryMax: posting.showSalary && req.salaryMax ? Number(req.salaryMax) : null,
      currency: req.currency,
      postedAt: posting.publishedAt,
      applyUrl: `${base}/careers/${posting.id}`,
    };
  });
}

/** One published posting by its public id, or null when it is not published. */
export async function publishedPosting(postingId: string): Promise<PublicPosting | null> {
  const all = await publishedPostings();
  return all.find((p) => p.postingId === postingId) ?? null;
}
