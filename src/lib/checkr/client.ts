/**
 * Checkr API client.
 *
 * The integration deliberately uses the *invitation* flow rather than posting
 * candidate PII ourselves. Checkr collects the SSN and date of birth directly
 * from the candidate, along with the FCRA disclosure and authorization, which
 * means this platform never stores either — the safest place for data you do
 * not need is somebody else's system, and the disclosure is presented by the
 * party legally required to present it.
 *
 * Authentication is HTTP Basic with the API key as the username and an empty
 * password, which is Checkr's documented scheme.
 */

import "server-only";

const API_BASE = process.env.CHECKR_API_BASE ?? "https://api.checkr.com/v1";

export class CheckrNotConfiguredError extends Error {
  constructor() {
    super(
      "Background checks are not configured. Set CHECKR_API_KEY to enable them.",
    );
    this.name = "CheckrNotConfiguredError";
  }
}

export class CheckrApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "CheckrApiError";
  }
}

export function isCheckrConfigured(): boolean {
  return Boolean(process.env.CHECKR_API_KEY);
}

function authHeader(): string {
  const key = process.env.CHECKR_API_KEY;
  if (!key) throw new CheckrNotConfiguredError();
  // Basic <base64(key + ":")>
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function request<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    // Never let a slow provider hold a request open indefinitely.
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const detail =
      (parsed as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new CheckrApiError(`Checkr rejected the request: ${detail}`, res.status, parsed);
  }
  return parsed as T;
}

export interface CheckrCandidate {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface CheckrInvitation {
  id: string;
  status: string;
  invitation_url: string;
  expires_at: string | null;
  candidate_id: string;
  report_id: string | null;
  package: string;
}

export interface CheckrReport {
  id: string;
  status: string;
  /** "clear" | "consider" | null while pending. */
  assessment: string | null;
  result: string | null;
  package: string;
  candidate_id: string;
  created_at: string;
  completed_at: string | null;
  /** Screening ids, present per package. */
  [key: string]: unknown;
}

export interface CheckrPackage {
  id: string;
  slug: string;
  name: string;
  price: number;
}

export async function createCandidate(params: {
  email: string;
  firstName: string;
  lastName: string;
  workLocation?: { country: string; state?: string | null; city?: string | null };
}): Promise<CheckrCandidate> {
  return request<CheckrCandidate>("/candidates", {
    method: "POST",
    body: {
      email: params.email,
      first_name: params.firstName,
      last_name: params.lastName,
      work_locations: params.workLocation
        ? [
            {
              country: params.workLocation.country,
              state: params.workLocation.state ?? undefined,
              city: params.workLocation.city ?? undefined,
            },
          ]
        : undefined,
    },
  });
}

export async function createInvitation(params: {
  candidateId: string;
  packageSlug: string;
  workLocation?: { country: string; state?: string | null; city?: string | null };
}): Promise<CheckrInvitation> {
  return request<CheckrInvitation>("/invitations", {
    method: "POST",
    body: {
      candidate_id: params.candidateId,
      package: params.packageSlug,
      work_locations: params.workLocation
        ? [
            {
              country: params.workLocation.country,
              state: params.workLocation.state ?? undefined,
              city: params.workLocation.city ?? undefined,
            },
          ]
        : undefined,
    },
  });
}

export async function getReport(reportId: string): Promise<CheckrReport> {
  return request<CheckrReport>(`/reports/${reportId}`, { method: "GET" });
}
