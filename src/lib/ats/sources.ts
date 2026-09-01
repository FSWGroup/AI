/**
 * Source attribution.
 *
 * Knowing where a hire came from is the single highest-leverage number in
 * recruiting — it decides where the advertising budget goes. It is also the
 * easiest to get wrong, because attribution has to be captured at apply time
 * and can never be reconstructed afterwards.
 *
 * So: capture what the browser tells us, normalize it into a stable channel
 * key, and keep the raw values alongside for when the normalization is wrong.
 */

export interface AttributionInput {
  /** Explicit channel from the apply URL, e.g. ?src=indeed */
  src?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  referrer?: string | null;
}

export interface Attribution {
  /** Stable key used to group source-effectiveness reporting. */
  channelKey: string;
  /** Everything captured, kept verbatim for later re-analysis. */
  detail: Record<string, string>;
}

/** Channels seeded on install. Organizations add their own. */
export const SEED_CHANNELS: {
  key: string;
  name: string;
  category: string;
}[] = [
  { key: "careers_site", name: "Careers site", category: "CAREERS_SITE" },
  { key: "indeed", name: "Indeed", category: "JOB_BOARD" },
  { key: "jobstreet_ph", name: "JobStreet Philippines", category: "JOB_BOARD" },
  { key: "jobs_ph", name: "Jobs.ph", category: "JOB_BOARD" },
  { key: "linkedin", name: "LinkedIn", category: "JOB_BOARD" },
  { key: "facebook", name: "Facebook", category: "JOB_BOARD" },
  { key: "kalibrr", name: "Kalibrr", category: "JOB_BOARD" },
  { key: "referral", name: "Employee referral", category: "REFERRAL" },
  { key: "agency", name: "Recruitment agency", category: "AGENCY" },
  { key: "walk_in", name: "Walk-in / direct", category: "DIRECT" },
  { key: "import", name: "Imported", category: "IMPORT" },
  { key: "other", name: "Other", category: "OTHER" },
];

/** Referrer hostnames that map to a known channel. */
const HOST_CHANNELS: [RegExp, string][] = [
  [/(^|\.)indeed\./i, "indeed"],
  [/(^|\.)jobstreet\./i, "jobstreet_ph"],
  [/(^|\.)jobs\.ph$/i, "jobs_ph"],
  [/(^|\.)linkedin\./i, "linkedin"],
  [/(^|\.)facebook\.|(^|\.)fb\.com$/i, "facebook"],
  [/(^|\.)kalibrr\./i, "kalibrr"],
  [/(^|\.)glassdoor\./i, "other"],
];

const ALIASES: Record<string, string> = {
  indeed: "indeed",
  "indeed.com": "indeed",
  jobstreet: "jobstreet_ph",
  "jobstreet.com.ph": "jobstreet_ph",
  jobsph: "jobs_ph",
  "jobs.ph": "jobs_ph",
  linkedin: "linkedin",
  li: "linkedin",
  fb: "facebook",
  facebook: "facebook",
  kalibrr: "kalibrr",
  referral: "referral",
  ref: "referral",
  agency: "agency",
  careers: "careers_site",
  careers_site: "careers_site",
  website: "careers_site",
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Resolve the channel an application should be attributed to.
 *
 * Precedence is explicit-over-inferred: a `src` parameter we put on our own
 * posting URLs beats a utm_source we did not control, which beats a referrer
 * header the browser may not send at all. Falling back to `careers_site` for
 * a direct visit is honest — someone who typed the URL did come through the
 * careers site.
 */
export function resolveAttribution(input: AttributionInput): Attribution {
  const detail: Record<string, string> = {};
  const put = (k: string, v: string | null | undefined) => {
    if (v && v.trim() !== "") detail[k] = v.trim().slice(0, 300);
  };
  put("src", input.src);
  put("utm_source", input.utmSource);
  put("utm_medium", input.utmMedium);
  put("utm_campaign", input.utmCampaign);
  put("utm_content", input.utmContent);
  put("referrer", input.referrer);

  // A canonical key must resolve to itself. trackedApplyUrl() publishes
  // ?src=<channelKey>, so anything that fails to round-trip would silently
  // misattribute traffic from our own posting URLs.
  const canonical = new Set(SEED_CHANNELS.map((c) => c.key));
  const resolve = (value: string): string | null => {
    if (canonical.has(value)) return value;
    return ALIASES[value] ?? null;
  };

  const explicit = (input.src ?? "").trim().toLowerCase();
  const fromExplicit = explicit ? resolve(explicit) : null;
  if (fromExplicit) return { channelKey: fromExplicit, detail };

  const utm = (input.utmSource ?? "").trim().toLowerCase();
  const fromUtm = utm ? resolve(utm) : null;
  if (fromUtm) return { channelKey: fromUtm, detail };
  if (input.referrer) {
    const host = hostOf(input.referrer);
    if (host) {
      for (const [pattern, key] of HOST_CHANNELS) {
        if (pattern.test(host)) return { channelKey: key, detail };
      }
    }
  }
  // An unrecognized explicit value is still a real signal — keep it visible
  // as "other" rather than silently claiming the careers site.
  if (explicit || utm) return { channelKey: "other", detail };
  return { channelKey: "careers_site", detail };
}

/** Build the tracked apply URL to hand to a job board. */
export function trackedApplyUrl(
  baseUrl: string,
  requisitionReference: string,
  channelKey: string,
): string {
  const url = new URL(`/careers/${requisitionReference}`, baseUrl);
  url.searchParams.set("src", channelKey);
  return url.toString();
}
