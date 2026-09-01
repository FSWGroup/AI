/**
 * Public posting content: the shape a role takes when it leaves the building.
 *
 * Used by the careers page, the JSON-LD block that Google for Jobs and most
 * aggregators read, and the XML feed that Indeed and its peers ingest — all
 * from one source, so the three can never drift apart and describe the same
 * role differently.
 */

import type { EmploymentType, WorkArrangement } from "@prisma/client";

export interface PublicPosting {
  reference: string;
  title: string;
  summary: string | null;
  description: string | null;
  responsibilities: string | null;
  requirements: string | null;
  benefits: string | null;
  departmentName: string | null;
  locationName: string | null;
  city: string | null;
  region: string | null;
  country: string;
  postalCode: string | null;
  remote: boolean;
  employmentType: EmploymentType;
  workArrangement: WorkArrangement;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: string;
  salaryPublish: boolean;
  openedAt: Date | null;
  updatedAt: Date;
}

/** schema.org employmentType values. Aggregators match on these exactly. */
const SCHEMA_EMPLOYMENT: Record<EmploymentType, string> = {
  FULL_TIME: "FULL_TIME",
  PART_TIME: "PART_TIME",
  CONTRACT: "CONTRACTOR",
  TEMPORARY: "TEMPORARY",
  INTERNSHIP: "INTERN",
};

/** Indeed's jobtype values, which differ from schema.org's. */
const FEED_JOBTYPE: Record<EmploymentType, string> = {
  FULL_TIME: "fulltime",
  PART_TIME: "parttime",
  CONTRACT: "contract",
  TEMPORARY: "temporary",
  INTERNSHIP: "internship",
};

const SCHEMA_PERIOD: Record<string, string> = {
  HOUR: "HOUR",
  DAY: "DAY",
  MONTH: "MONTH",
  YEAR: "YEAR",
};

/** Plain-text sections rendered as the HTML description boards expect. */
export function postingDescriptionHtml(p: PublicPosting): string {
  const section = (heading: string, body: string | null): string => {
    if (!body || body.trim() === "") return "";
    const items = body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (items.length > 1) {
      return `<h3>${escapeHtml(heading)}</h3><ul>${items
        .map((i) => `<li>${escapeHtml(i)}</li>`)
        .join("")}</ul>`;
    }
    return `<h3>${escapeHtml(heading)}</h3><p>${escapeHtml(items[0] ?? "")}</p>`;
  };

  return [
    p.summary ? `<p>${escapeHtml(p.summary)}</p>` : "",
    section("About the role", p.description),
    section("What you will do", p.responsibilities),
    section("What we are looking for", p.requirements),
    section("Benefits", p.benefits),
  ]
    .filter(Boolean)
    .join("");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** XML text is escaped and wrapped in CDATA, which feeds require for markup. */
export function cdata(value: string): string {
  // A literal "]]>" inside the payload would close the section early.
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

/**
 * schema.org JobPosting JSON-LD.
 *
 * This is what makes a role eligible for Google for Jobs and is read by a
 * long tail of aggregators that crawl rather than ingest a feed — which is
 * the practical answer for boards that publish no integration API at all.
 */
export function jobPostingJsonLd(
  p: PublicPosting,
  params: { companyName: string; baseUrl: string; logoUrl?: string | null },
): Record<string, unknown> {
  const json: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: p.title,
    description: postingDescriptionHtml(p),
    identifier: {
      "@type": "PropertyValue",
      name: params.companyName,
      value: p.reference,
    },
    datePosted: (p.openedAt ?? p.updatedAt).toISOString().slice(0, 10),
    employmentType: SCHEMA_EMPLOYMENT[p.employmentType],
    hiringOrganization: {
      "@type": "Organization",
      name: params.companyName,
      sameAs: params.baseUrl,
      ...(params.logoUrl ? { logo: params.logoUrl } : {}),
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: p.city ?? p.locationName ?? undefined,
        addressRegion: p.region ?? undefined,
        postalCode: p.postalCode ?? undefined,
        addressCountry: p.country,
      },
    },
    directApply: true,
  };

  // Remote roles need the telecommute marker or they are filtered out of
  // remote searches entirely.
  if (p.remote || p.workArrangement === "REMOTE") {
    json.jobLocationType = "TELECOMMUTE";
    json.applicantLocationRequirements = {
      "@type": "Country",
      name: p.country,
    };
  }

  if (p.salaryPublish && p.salaryMin != null) {
    json.baseSalary = {
      "@type": "MonetaryAmount",
      currency: p.salaryCurrency,
      value: {
        "@type": "QuantitativeValue",
        minValue: p.salaryMin,
        ...(p.salaryMax != null ? { maxValue: p.salaryMax } : {}),
        unitText: SCHEMA_PERIOD[p.salaryPeriod] ?? "MONTH",
      },
    };
  }

  return json;
}

/**
 * One <job> element in the aggregator XML feed.
 *
 * The element names follow the Indeed job-sync format, which the wider
 * programmatic-advertising ecosystem also reads — so a single feed URL serves
 * Indeed and most of the boards that consume a standard feed.
 */
export function jobFeedEntry(
  p: PublicPosting,
  params: { companyName: string; baseUrl: string },
): string {
  const applyUrl = new URL(`/careers/${p.reference}`, params.baseUrl);
  applyUrl.searchParams.set("src", "indeed");

  const fields: [string, string][] = [
    ["title", p.title],
    ["date", (p.openedAt ?? p.updatedAt).toUTCString()],
    ["referencenumber", p.reference],
    ["url", applyUrl.toString()],
    ["company", params.companyName],
    ["city", p.city ?? p.locationName ?? ""],
    ["state", p.region ?? ""],
    ["country", p.country],
    ["postalcode", p.postalCode ?? ""],
    ["description", postingDescriptionHtml(p)],
    ["jobtype", FEED_JOBTYPE[p.employmentType]],
  ];
  if (p.salaryPublish && p.salaryMin != null) {
    const range =
      p.salaryMax != null && p.salaryMax !== p.salaryMin
        ? `${p.salaryMin}-${p.salaryMax}`
        : `${p.salaryMin}`;
    fields.push(["salary", `${p.salaryCurrency} ${range} per ${p.salaryPeriod.toLowerCase()}`]);
  }
  if (p.remote || p.workArrangement === "REMOTE") {
    fields.push(["remotetype", "Fully remote"]);
  }

  const body = fields
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `    <${name}>${cdata(value)}</${name}>`)
    .join("\n");
  return `  <job>\n${body}\n  </job>`;
}

export function buildJobFeed(
  postings: PublicPosting[],
  params: { companyName: string; baseUrl: string },
): string {
  const entries = postings.map((p) => jobFeedEntry(p, params)).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<source>
  <publisher>${cdata(params.companyName)}</publisher>
  <publisherurl>${cdata(params.baseUrl)}</publisherurl>
  <lastBuildDate>${cdata(new Date().toUTCString())}</lastBuildDate>
${entries}
</source>
`;
}
