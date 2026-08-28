import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  buildFeedXml,
  indeedJobType,
  parseApplyPayload,
  payloadDigest,
  verifyApplySignature,
  verifyFeedToken,
  xmlEscape,
  type FeedJob,
} from '@/lib/indeed';
import { splitLocation } from '@/lib/recruiting/postings';

const SECRET = process.env.INDEED_APPLY_SECRET!;
const sign = (body: string) => createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');

function job(overrides: Partial<FeedJob> = {}): FeedJob {
  return {
    id: 'req_1',
    referenceNumber: 'req_1',
    title: 'Inside Sales Representative',
    description: 'Sell valves & fittings to industrial customers.',
    requirements: '2+ years distribution experience',
    location: 'Exton, PA',
    city: 'Exton',
    state: 'PA',
    country: 'US',
    employmentType: 'FULL_TIME',
    remoteType: 'ONSITE',
    department: 'Sales',
    salaryMin: 60000,
    salaryMax: 75000,
    currency: 'USD',
    postedAt: new Date('2026-08-01T12:00:00Z'),
    applyUrl: 'http://localhost:3000/careers/post_1',
    ...overrides,
  };
}

describe('feed token', () => {
  it('accepts the configured token and nothing else', () => {
    expect(verifyFeedToken(process.env.INDEED_FEED_TOKEN!)).toBe(true);
    expect(verifyFeedToken('wrong')).toBe(false);
    expect(verifyFeedToken(null)).toBe(false);
    expect(verifyFeedToken('')).toBe(false);
  });

  it('rejects a token with the right length but wrong bytes', () => {
    const wrong = 'x'.repeat(process.env.INDEED_FEED_TOKEN!.length);
    expect(verifyFeedToken(wrong)).toBe(false);
  });
});

describe('feed XML', () => {
  it('includes the fields Indeed requires', () => {
    const xml = buildFeedXml([job()]);
    expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(xml).toContain('<title><![CDATA[Inside Sales Representative]]></title>');
    expect(xml).toContain('<referencenumber><![CDATA[req_1]]></referencenumber>');
    expect(xml).toContain('<url><![CDATA[http://localhost:3000/careers/post_1]]></url>');
    expect(xml).toContain('<city><![CDATA[Exton]]></city>');
    expect(xml).toContain('<state><![CDATA[PA]]></state>');
    expect(xml).toContain('<jobtype><![CDATA[fulltime]]></jobtype>');
    expect(xml).toContain(`<date>${new Date('2026-08-01T12:00:00Z').toUTCString()}</date>`);
  });

  it('never leaks an internal field', () => {
    const xml = buildFeedXml([job()]);
    for (const forbidden of ['hiringManager', 'headcount', 'isReplacement', 'recruiterId', 'PENDING_APPROVAL']) {
      expect(xml).not.toContain(forbidden);
    }
  });

  it('omits salary when the recruiter did not publish a range', () => {
    const xml = buildFeedXml([job({ salaryMin: null, salaryMax: null })]);
    expect(xml).not.toContain('<salary>');
  });

  it('cannot be broken out of with a CDATA terminator in the description', () => {
    const xml = buildFeedXml([job({ description: 'Great role ]]><script>alert(1)</script>' })]);
    // The terminator is split, so the injected markup stays inside CDATA.
    expect(xml).toContain(']]]]><![CDATA[>');
    expect(xml).not.toContain(']]><script>');
  });

  it('escapes attacker-controlled text in non-CDATA positions', () => {
    expect(xmlEscape('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('maps employment types to Indeed vocabulary', () => {
    expect(indeedJobType('PART_TIME')).toBe('parttime');
    expect(indeedJobType('CONTRACT')).toBe('contract');
    expect(indeedJobType('something-else')).toBe('fulltime');
  });

  it('has no <indeedapply> block without the publisher API token', () => {
    expect(buildFeedXml([job()])).not.toContain('<indeedapply>');
  });
});

describe('apply signature', () => {
  const body = JSON.stringify({ id: 'abc', applicant: { firstName: 'Jo', lastName: 'Ray' } });

  it('accepts a correctly signed body', () => {
    expect(verifyApplySignature(body, sign(body))).toBe(true);
  });

  it('accepts a hex-encoded signature too', () => {
    const hex = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
    expect(verifyApplySignature(body, hex)).toBe(true);
  });

  it('rejects a missing signature', () => {
    expect(verifyApplySignature(body, null)).toBe(false);
    expect(verifyApplySignature(body, '')).toBe(false);
  });

  it('rejects a signature over different bytes', () => {
    const tampered = body.replace('Jo', 'Mo');
    expect(verifyApplySignature(tampered, sign(body))).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const forged = createHmac('sha256', 'not-the-secret').update(body, 'utf8').digest('base64');
    expect(verifyApplySignature(body, forged)).toBe(false);
  });

  it('rejects whitespace-reordered JSON signed over the original', () => {
    // Signature must cover the exact bytes received, not a re-serialization.
    const reordered = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyApplySignature(reordered, sign(body))).toBe(false);
  });
});

describe('apply payload parsing', () => {
  it('reads the documented shape', () => {
    const result = parseApplyPayload({
      id: 'apply_1',
      appliedOnMillis: Date.UTC(2026, 7, 20, 9, 0, 0),
      job: { jobId: 'req_1', jobTitle: 'Inside Sales Representative' },
      applicant: {
        firstName: 'Dana',
        lastName: 'Okafor',
        email: 'Dana@example.com',
        phoneNumber: '610-555-0100',
        coverletter: 'I would love to join.',
        resume: { text: 'Ten years in industrial distribution.' },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.externalId).toBe('apply_1');
    expect(result.value.referenceNumber).toBe('req_1');
    expect(result.value.firstName).toBe('Dana');
    expect(result.value.resumeText).toContain('industrial distribution');
    expect(result.value.appliedAt.toISOString()).toBe('2026-08-20T09:00:00.000Z');
  });

  it('splits a full name when first/last are not sent separately', () => {
    const result = parseApplyPayload({ id: 'a', applicant: { fullName: 'Maria Santos Cruz' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.firstName).toBe('Maria');
    expect(result.value.lastName).toBe('Santos Cruz');
  });

  it('refuses a payload with no application id', () => {
    const result = parseApplyPayload({ applicant: { firstName: 'A', lastName: 'B' } });
    expect(result.ok).toBe(false);
  });

  it('refuses a payload with no name', () => {
    const result = parseApplyPayload({ id: 'a', applicant: { email: 'x@example.com' } });
    expect(result.ok).toBe(false);
  });

  it('refuses a résumé file over the size limit', () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 1).toString('base64');
    const result = parseApplyPayload({
      id: 'a',
      applicant: { firstName: 'A', lastName: 'B', resume: { file: { fileName: 'cv.pdf', data: big } } },
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a non-object body', () => {
    expect(parseApplyPayload('nope').ok).toBe(false);
    expect(parseApplyPayload(null).ok).toBe(false);
    expect(parseApplyPayload([1, 2]).ok).toBe(false);
  });
});

describe('delivery log digest', () => {
  it('records presence, never the contact details themselves', () => {
    const digest = payloadDigest({
      id: 'apply_1',
      job: { jobId: 'req_1', jobTitle: 'Inside Sales' },
      applicant: {
        firstName: 'Dana',
        email: 'dana@example.com',
        phoneNumber: '610-555-0100',
        coverletter: 'hello',
        resume: { text: 'CV body' },
      },
    });
    const serialized = JSON.stringify(digest);
    expect(serialized).not.toContain('dana@example.com');
    expect(serialized).not.toContain('610-555-0100');
    expect(serialized).not.toContain('CV body');
    expect(digest.hasEmail).toBe(true);
    expect(digest.hasPhone).toBe(true);
    expect(digest.hasResumeText).toBe(true);
    expect(digest.jobReference).toBe('req_1');
  });
});

describe('location parsing', () => {
  it('splits city and state', () => {
    expect(splitLocation('Exton, PA')).toEqual({ city: 'Exton', state: 'PA' });
    expect(splitLocation('Manila, Philippines')).toEqual({ city: 'Manila', state: 'Philippines' });
    expect(splitLocation('Remote')).toEqual({ city: 'Remote', state: null });
  });
});
