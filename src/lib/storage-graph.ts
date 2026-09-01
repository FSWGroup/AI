import 'server-only';
import { env } from '@/lib/env';
import type { StorageDriver } from '@/lib/storage';

/**
 * SharePoint document storage via Microsoft Graph.
 *
 * ── PARTIALLY UNVERIFIED ───────────────────────────────────────────────────
 * The Graph request shapes here are stable and well-documented, but egress to
 * learn.microsoft.com was blocked in the environment this was written in, so
 * they have not been exercised against a live tenant. The path construction,
 * chunking arithmetic and error translation ARE unit-tested.
 * `scripts/verify-sharepoint.ts` exercises the live calls in order.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * THE SECURITY MODEL, which matters more than the code:
 *
 * The target site must be granted to this app registration with the
 * `Sites.Selected` application permission and have **no human members at
 * all**. SharePoint permissions are a completely separate system from FSW
 * People's RBAC — if people can browse the library, `canAccessDocument()`
 * and the download audit trail become decoration, because the real access
 * control is SharePoint's and nobody is administering it with HR
 * confidentiality in mind.
 *
 * With an app-owned site, FSW People remains the only door: the download route
 * still checks the session, verifies the signed URL token, calls
 * `canAccessDocument()`, and only then fetches bytes from Graph. Every
 * security property of the local driver survives, and Purview retention, DLP
 * and eDiscovery are gained.
 *
 * Do NOT point this at a Team's document library. That is the version that
 * quietly undoes the authorization model.
 */

/** Graph's documented ceiling for a single PUT. Larger files need a session. */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Upload session chunks must be a multiple of 320 KiB. */
const CHUNK_SIZE = 320 * 1024 * 10; // 3.2 MiB
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;

interface TokenCache {
  token: string;
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

/** Test seam: drop the cached Graph token. */
export function resetGraphToken(): void {
  tokenCache = null;
}

export class GraphStorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'GraphStorageError';
  }
}

/**
 * Turn a storage key into a Graph path, safely.
 *
 * Storage keys are generated internally (`documents/2026/09/<random>.pdf`) but
 * this is the boundary to another system's namespace, so it is validated
 * rather than trusted: no traversal, no absolute paths, no empty segments.
 */
export function graphPathFor(key: string, rootFolder = env.MS_GRAPH_ROOT_FOLDER): string {
  const segments = `${rootFolder}/${key}`
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new GraphStorageError(`Invalid storage key: ${key}`);
    }
    // SharePoint rejects these outright; catching it here gives a better error.
    if (/["*:<>?/\\|]/.test(segment)) {
      throw new GraphStorageError(`Storage key contains a character SharePoint will not accept: ${key}`);
    }
  }
  return segments.map(encodeURIComponent).join('/');
}

/** Byte ranges for an upload session, as Graph's Content-Range expects them. */
export function chunkRanges(totalBytes: number, chunkSize = CHUNK_SIZE): { start: number; end: number }[] {
  if (totalBytes <= 0) return [];
  const ranges: { start: number; end: number }[] = [];
  for (let start = 0; start < totalBytes; start += chunkSize) {
    ranges.push({ start, end: Math.min(start + chunkSize, totalBytes) - 1 });
  }
  return ranges;
}

export class GraphDriver implements StorageDriver {
  constructor() {
    const missing = (
      [
        ['MS_GRAPH_TENANT_ID', env.MS_GRAPH_TENANT_ID],
        ['MS_GRAPH_CLIENT_ID', env.MS_GRAPH_CLIENT_ID],
        ['MS_GRAPH_CLIENT_SECRET', env.MS_GRAPH_CLIENT_SECRET],
        ['MS_GRAPH_SITE_ID', env.MS_GRAPH_SITE_ID],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new GraphStorageError(
        `STORAGE_DRIVER=graph requires ${missing.join(', ')}. See DEPLOYMENT.md — SharePoint storage.`,
      );
    }
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

    const response = await fetch(
      `https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.MS_GRAPH_CLIENT_ID!,
          client_secret: env.MS_GRAPH_CLIENT_SECRET!,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const body = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !body.access_token) {
      throw new GraphStorageError(
        `Microsoft Entra rejected the app credentials: ${body.error_description ?? `HTTP ${response.status}`}`,
        response.status,
      );
    }
    tokenCache = { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
    return tokenCache.token;
  }

  private driveRoot(): string {
    return `https://graph.microsoft.com/v1.0/sites/${env.MS_GRAPH_SITE_ID}/drive/root`;
  }

  /**
   * Graph call with retry on throttling.
   *
   * Graph throttles aggressively and answers 429 with a Retry-After. Ignoring
   * it turns a busy minute into a cascade of failed document uploads.
   */
  private async call(url: string, init: RequestInit, attempt = 1): Promise<Response> {
    const token = await this.accessToken();
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** (attempt - 1));
        return this.call(url, init, attempt + 1);
      }
      throw new GraphStorageError(
        error instanceof Error ? `Could not reach Microsoft Graph: ${error.message}` : 'Could not reach Microsoft Graph.',
        undefined,
        true,
      );
    }

    if (response.status === 401) {
      tokenCache = null;
      if (attempt < MAX_RETRIES) return this.call(url, init, attempt + 1);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('retry-after')) || 2 ** attempt;
      await sleep(Math.min(retryAfter, 30) * 1000);
      return this.call(url, init, attempt + 1);
    }
    return response;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const path = graphPathFor(key);
    if (data.length <= SIMPLE_UPLOAD_LIMIT) {
      const response = await this.call(`${this.driveRoot()}:/${path}:/content`, {
        method: 'PUT',
        headers: { 'content-type': contentType || 'application/octet-stream' },
        body: new Uint8Array(data),
      });
      if (!response.ok) {
        throw new GraphStorageError(await describe(response, `Could not upload ${key}`), response.status);
      }
      return;
    }
    await this.putLarge(path, data, key);
  }

  /** Chunked upload for anything over Graph's simple-PUT ceiling. */
  private async putLarge(path: string, data: Buffer, key: string): Promise<void> {
    const sessionResponse = await this.call(`${this.driveRoot()}:/${path}:/createUploadSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    });
    const session = (await sessionResponse.json()) as { uploadUrl?: string };
    if (!sessionResponse.ok || !session.uploadUrl) {
      throw new GraphStorageError(
        await describe(sessionResponse, `Could not start an upload session for ${key}`),
        sessionResponse.status,
      );
    }

    for (const { start, end } of chunkRanges(data.length)) {
      // The session URL is pre-authorised — deliberately no bearer token here.
      const response = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${data.length}`,
        },
        body: new Uint8Array(data.subarray(start, end + 1)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // 202 means "chunk accepted, send the next"; 200/201 means complete.
      if (![200, 201, 202].includes(response.status)) {
        throw new GraphStorageError(
          await describe(response, `Upload of ${key} failed at bytes ${start}-${end}`),
          response.status,
        );
      }
    }
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.call(`${this.driveRoot()}:/${graphPathFor(key)}:/content`, { method: 'GET' });
    if (response.status === 404) {
      throw new GraphStorageError(`Document not found in SharePoint: ${key}`, 404);
    }
    if (!response.ok) {
      throw new GraphStorageError(await describe(response, `Could not download ${key}`), response.status);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.call(`${this.driveRoot()}:/${graphPathFor(key)}`, { method: 'DELETE' });
    // Already gone is a success, not an error.
    if (!response.ok && response.status !== 404) {
      throw new GraphStorageError(await describe(response, `Could not delete ${key}`), response.status);
    }
  }
}

async function describe(response: Response, prefix: string): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string } };
    detail = body.error?.message ?? body.error?.code ?? '';
  } catch {
    detail = '';
  }
  return `${prefix}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
