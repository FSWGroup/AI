import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '@/lib/env';

/**
 * Indeed integration (§16 Recruiting).
 *
 * Two halves, both of which Indeed supports without a partner contract:
 *
 *  1. OUTBOUND — job posting. Indeed sources jobs from an XML feed it crawls
 *     on a schedule. We host that feed at /api/indeed/feed, protected by a
 *     long random token that only Indeed is given. "Published to Indeed"
 *     therefore means "present in the feed"; Indeed decides when it indexes,
 *     so the UI never claims a job is live on Indeed the instant you click.
 *
 *  2. INBOUND — candidates. Indeed Apply POSTs each application to
 *     /api/indeed/apply. Every delivery is HMAC-signed with a shared secret
 *     and recorded in JobBoardDelivery, accepted or not.
 *
 * Not implemented, deliberately: pushing dispositions (hired/rejected) back
 * to Indeed. That needs Indeed's partner Disposition API and credentials we
 * do not have. See ADMIN_GUIDE.md — we would rather show nothing than a
 * control that silently does nothing.
 */

export const INDEED_BOARD = 'INDEED';

export function indeedFeedEnabled(): boolean {
  return Boolean(env.INDEED_FEED_TOKEN);
}

export function indeedApplyEnabled(): boolean {
  return Boolean(env.INDEED_APPLY_SECRET);
}

/**
 * Apply-inside-Indeed additionally needs the publisher API token Indeed
 * issues. Without it the feed still works; applicants land on our careers
 * page instead. We never emit a half-configured <indeedapply> block, because
 * Indeed would show an Apply button that fails.
 */
export function indeedApplyInFeedEnabled(): boolean {
  return Boolean(env.INDEED_APPLY_SECRET && env.INDEED_APPLY_API_TOKEN);
}

export function indeedApplyPostUrl(): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/api/indeed/apply`;
}

/** The URL to hand to Indeed. Contains the token, so treat it as a secret. */
export function indeedFeedUrl(): string | null {
  if (!env.INDEED_FEED_TOKEN) return null;
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/api/indeed/feed?token=${encodeURIComponent(env.INDEED_FEED_TOKEN)}`;
}

export function verifyFeedToken(token: string | null): boolean {
  if (!env.INDEED_FEED_TOKEN || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(env.INDEED_FEED_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Feed generation
// ---------------------------------------------------------------------------

/** XML text escaping. Everything user-authored goes through this or CDATA. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * CDATA is how Indeed expects rich descriptions. A description containing the
 * literal `]]>` would otherwise close the section early and let the rest of
 * the text be parsed as markup, so split it across two CDATA sections.
 */
function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

export interface FeedJob {
  id: string;
  title: string;
  description: string;
  requirements?: string | null;
  location: string;
  city?: string | null;
  state?: string | null;
  country: string;
  employmentType?: string | null;
  remoteType?: string | null;
  department?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency: string;
  postedAt: Date;
  applyUrl: string;
  referenceNumber: string;
}

function salaryText(job: FeedJob): string | null {
  const fmt = (n: number) => `${job.currency} ${n.toLocaleString('en-US')}`;
  if (job.salaryMin && job.salaryMax) return `${fmt(Number(job.salaryMin))} - ${fmt(Number(job.salaryMax))}`;
  if (job.salaryMin) return `From ${fmt(Number(job.salaryMin))}`;
  if (job.salaryMax) return `Up to ${fmt(Number(job.salaryMax))}`;
  return null;
}

/**
 * Indeed's XML job feed format. Dates are RFC 2822 as Indeed's spec requires.
 * Only fields an applicant would see on the posting are included — nothing
 * internal (hiring manager, replacement flag, headcount, approval state).
 */
export function buildFeedXml(jobs: FeedJob[], generatedAt = new Date()): string {
  const rows = jobs.map((job) => {
    const body = [
      job.description.trim(),
      job.requirements?.trim() ? `\n\nWhat we're looking for:\n${job.requirements.trim()}` : '',
    ].join('');
    const salary = salaryText(job);
    const lines = [
      `    <title>${cdata(job.title)}</title>`,
      `    <date>${xmlEscape(job.postedAt.toUTCString())}</date>`,
      `    <referencenumber>${cdata(job.referenceNumber)}</referencenumber>`,
      `    <url>${cdata(job.applyUrl)}</url>`,
      `    <company>${cdata(env.INDEED_COMPANY_NAME)}</company>`,
      `    <city>${cdata(job.city ?? job.location)}</city>`,
      job.state ? `    <state>${cdata(job.state)}</state>` : '',
      `    <country>${cdata(job.country)}</country>`,
      `    <description>${cdata(body)}</description>`,
      job.department ? `    <category>${cdata(job.department)}</category>` : '',
      job.employmentType ? `    <jobtype>${cdata(indeedJobType(job.employmentType))}</jobtype>` : '',
      salary ? `    <salary>${cdata(salary)}</salary>` : '',
      job.remoteType === 'REMOTE' ? `    <remotetype>${cdata('Fully remote')}</remotetype>` : '',
      job.remoteType === 'HYBRID' ? `    <remotetype>${cdata('Hybrid remote')}</remotetype>` : '',
      indeedApplyInFeedEnabled() ? applyBlock(job) : '',
    ].filter(Boolean);
    return `  <job>\n${lines.join('\n')}\n  </job>`;
  });

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<source>',
    `  <publisher>${cdata(env.INDEED_COMPANY_NAME)}</publisher>`,
    `  <publisherurl>${cdata(env.APP_BASE_URL)}</publisherurl>`,
    `  <lastBuildDate>${xmlEscape(generatedAt.toUTCString())}</lastBuildDate>`,
    ...rows,
    '</source>',
    '',
  ].join('\n');
}

/**
 * Indeed Apply block. Lets a jobseeker apply without leaving Indeed; Indeed
 * then POSTs the application to indeed-apply-postUrl, which is our signed
 * webhook. indeed-apply-jobId is our requisition id and comes straight back
 * to us as the routing key.
 */
function applyBlock(job: FeedJob): string {
  const fields: Array<[string, string]> = [
    ['indeed-apply-apiToken', env.INDEED_APPLY_API_TOKEN ?? ''],
    ['indeed-apply-postUrl', indeedApplyPostUrl()],
    ['indeed-apply-jobId', job.referenceNumber],
    ['indeed-apply-jobTitle', job.title],
    ['indeed-apply-jobCompanyName', env.INDEED_COMPANY_NAME],
    ['indeed-apply-jobLocation', job.location],
    ['indeed-apply-jobUrl', job.applyUrl],
    ['indeed-apply-resume', 'required'],
    ['indeed-apply-phone', 'optional'],
  ];
  const params = fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `    <indeedapply>${cdata(params)}</indeedapply>`;
}

/** Indeed's vocabulary for employment type. */
export function indeedJobType(employmentType: string): string {
  switch (employmentType.toUpperCase()) {
    case 'FULL_TIME':
      return 'fulltime';
    case 'PART_TIME':
      return 'parttime';
    case 'CONTRACT':
      return 'contract';
    case 'TEMPORARY':
      return 'temporary';
    case 'INTERNSHIP':
      return 'internship';
    default:
      return 'fulltime';
  }
}

// ---------------------------------------------------------------------------
// Indeed Apply — inbound
// ---------------------------------------------------------------------------

/**
 * Indeed signs each Apply delivery with an HMAC-SHA256 of the raw request
 * body, base64-encoded, in the Indeed-Signature header. Verify against the
 * exact bytes received — never against a re-serialized object, which would
 * let an attacker vary whitespace or key order.
 */
export function verifyApplySignature(rawBody: string, header: string | null): boolean {
  if (!env.INDEED_APPLY_SECRET || !header) return false;
  const expected = createHmac('sha256', env.INDEED_APPLY_SECRET).update(rawBody, 'utf8').digest();
  // Accept base64 or hex; Indeed sends base64, but tolerate either rather
  // than silently dropping every application over an encoding mismatch.
  for (const encoding of ['base64', 'hex'] as const) {
    let provided: Buffer;
    try {
      provided = Buffer.from(header.trim(), encoding);
    } catch {
      continue;
    }
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
  }
  return false;
}

export interface ApplyPayload {
  /** Indeed's own id for the application — our idempotency key. */
  externalId: string;
  /** Our requisition id, echoed back from the feed's referencenumber. */
  referenceNumber: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  coverLetter: string | null;
  resumeText: string | null;
  resumeFileName: string | null;
  resumeFileBase64: string | null;
  appliedAt: Date;
}

type Json = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pick(source: Json | null, ...keys: string[]): unknown {
  if (!source) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function obj(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

/** Cap what we accept so one delivery cannot fill the database. */
const MAX_TEXT = 60_000;
const MAX_RESUME_BYTES = 8 * 1024 * 1024;

function clamp(value: string | null, max = MAX_TEXT): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Normalize an Indeed Apply body into our shape. Indeed has shipped several
 * payload revisions and partner variants; rather than pin to one, read the
 * documented field with its known aliases and fail loudly when the identity
 * fields are absent.
 */
export function parseApplyPayload(body: unknown): { ok: true; value: ApplyPayload } | { ok: false; error: string } {
  const root = obj(body);
  if (!root) return { ok: false, error: 'Body is not a JSON object.' };

  const applicant = obj(pick(root, 'applicant', 'candidate')) ?? {};
  const job = obj(pick(root, 'job')) ?? {};
  const resume = obj(pick(applicant, 'resume')) ?? obj(pick(root, 'resume')) ?? {};
  const analytics = obj(pick(root, 'analytics')) ?? {};

  const externalId = str(pick(root, 'id', 'applyId', 'indeedApplyID', 'applicationId'));
  if (!externalId) return { ok: false, error: 'Missing application id.' };

  const fullName = str(pick(applicant, 'fullName', 'name'));
  let firstName = str(pick(applicant, 'firstName', 'givenName'));
  let lastName = str(pick(applicant, 'lastName', 'familyName', 'surname'));
  if ((!firstName || !lastName) && fullName) {
    const parts = fullName.split(/\s+/);
    firstName = firstName ?? parts[0] ?? null;
    lastName = lastName ?? (parts.length > 1 ? parts.slice(1).join(' ') : null);
  }
  if (!firstName && !lastName) return { ok: false, error: 'Missing applicant name.' };

  const file = obj(pick(resume, 'file')) ?? {};
  const resumeBase64 = str(pick(file, 'data', 'base64', 'content'));
  if (resumeBase64 && Buffer.byteLength(resumeBase64, 'base64') > MAX_RESUME_BYTES) {
    return { ok: false, error: 'Resume file exceeds the 8 MB limit.' };
  }

  const appliedRaw = pick(root, 'appliedOnMillis', 'appliedAt', 'submittedAt', 'createdAt');
  let appliedAt = new Date();
  if (typeof appliedRaw === 'number') appliedAt = new Date(appliedRaw);
  else if (typeof appliedRaw === 'string') {
    const parsed = new Date(appliedRaw);
    if (!Number.isNaN(parsed.getTime())) appliedAt = parsed;
  }

  return {
    ok: true,
    value: {
      externalId,
      referenceNumber: str(pick(job, 'jobId', 'referenceNumber', 'jobReference')) ?? str(pick(analytics, 'jobId')),
      firstName: firstName ?? '(not provided)',
      lastName: lastName ?? '(not provided)',
      email: str(pick(applicant, 'email', 'emailAddress')),
      phone: str(pick(applicant, 'phoneNumber', 'phone')),
      coverLetter: clamp(str(pick(applicant, 'coverletter', 'coverLetter'))),
      resumeText: clamp(str(pick(resume, 'text', 'plainText')) ?? str(pick(file, 'text'))),
      resumeFileName: str(pick(file, 'fileName', 'name')),
      resumeFileBase64: resumeBase64,
      appliedAt,
    },
  };
}

/**
 * What we are willing to keep about a delivery in the JobBoardDelivery log,
 * which is readable by anyone with recruiting.read and is append-only. The
 * log exists to answer "did Indeed send this, and what did we do with it" —
 * not to be a second copy of the applicant's contact details, so email,
 * phone, resume and cover letter are recorded only as presence flags.
 */
export function payloadDigest(body: unknown): Record<string, unknown> {
  const root = obj(body) ?? {};
  const applicant = obj(pick(root, 'applicant', 'candidate')) ?? {};
  const job = obj(pick(root, 'job')) ?? {};
  const resume = obj(pick(applicant, 'resume')) ?? obj(pick(root, 'resume')) ?? {};
  const file = obj(pick(resume, 'file')) ?? {};
  return {
    jobReference: str(pick(job, 'jobId', 'referenceNumber', 'jobReference')),
    jobTitle: str(pick(job, 'jobTitle', 'title')),
    hasEmail: Boolean(str(pick(applicant, 'email', 'emailAddress'))),
    hasPhone: Boolean(str(pick(applicant, 'phoneNumber', 'phone'))),
    hasResumeText: Boolean(str(pick(resume, 'text', 'plainText'))),
    hasResumeFile: Boolean(str(pick(file, 'data', 'base64', 'content'))),
    hasCoverLetter: Boolean(str(pick(applicant, 'coverletter', 'coverLetter'))),
    topLevelKeys: Object.keys(root).slice(0, 25),
  };
}
