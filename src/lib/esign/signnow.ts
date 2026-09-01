import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '@/lib/env';
import {
  EsignError,
  type CreateRequestInput,
  type CreateRequestResult,
  type EsignProvider,
  type ParsedWebhookEvent,
  type SignedArtifacts,
  type SigningLink,
} from '@/lib/esign/types';

/**
 * SignNow adapter.
 *
 * ── UNVERIFIED AGAINST THE LIVE API ────────────────────────────────────────
 * The request shapes below were written from SignNow's documented REST API,
 * but network egress to docs.signnow.com was blocked in the environment this
 * was built in, so none of it has been exercised against the real service.
 * Treat every path and field name in ENDPOINTS and the parsers as a
 * best-effort first draft.
 *
 * Everything vendor-specific is therefore concentrated here, and every URL
 * lives in the single ENDPOINTS block so a correction is one edit in one
 * place. `scripts/verify-signnow.ts` exercises each call in order and names
 * the first one that fails.
 *
 * The parts that do NOT depend on getting SignNow right — the state machine,
 * the webhook's signature and idempotency handling, the storage of signed
 * artifacts, the dashboard — are fully tested elsewhere.
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * Every SignNow URL, in one place.
 *
 * If a call 404s during verification, the fix is almost certainly here rather
 * than in the logic below.
 */
const ENDPOINTS = {
  token: '/oauth2/token',
  uploadDocument: '/document',
  documentById: (id: string) => `/document/${id}`,
  /** Embedded signing: create an invite bound to one signer, then mint a link. */
  embeddedInvite: (id: string) => `/v2/documents/${id}/embedded-invites`,
  embeddedInviteLink: (id: string, inviteId: string) =>
    `/v2/documents/${id}/embedded-invites/${inviteId}/link`,
  /** The flattened, completed PDF. */
  download: (id: string) => `/document/${id}/download?type=collapsed`,
  /** The audit trail / completion certificate. */
  downloadWithHistory: (id: string) => `/document/${id}/download?type=collapsed&with_history=1`,
  historyDownload: (id: string) => `/document/${id}/historydownload`,
  cancelInvite: (id: string) => `/document/${id}/fieldinvitecancel`,
  resendInvite: (id: string) => `/document/${id}/invite/resend`,
} as const;

const REQUEST_TIMEOUT_MS = 30_000;
/** How long an embedded signing link stays valid, in seconds. */
const LINK_TTL_SECONDS = 900;

interface TokenCache {
  token: string;
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

/** Test seam: drop the cached access token. */
export function resetSignNowToken(): void {
  tokenCache = null;
}

export class SignNowProvider implements EsignProvider {
  readonly name = 'SIGNNOW';

  isConfigured(): boolean {
    return Boolean(env.SIGNNOW_CLIENT_ID && env.SIGNNOW_CLIENT_SECRET && env.SIGNNOW_USERNAME && env.SIGNNOW_PASSWORD);
  }

  private baseUrl(): string {
    // The evaluation environment is a different host, not a flag — pointing a
    // sandbox key at production would send real invites to real people.
    return env.SIGNNOW_API_BASE ?? 'https://api.signnow.com';
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new EsignError(
        'SignNow is not configured. An administrator sets SIGNNOW_CLIENT_ID, SIGNNOW_CLIENT_SECRET, SIGNNOW_USERNAME and SIGNNOW_PASSWORD — see Admin › Integrations.',
      );
    }
  }

  /**
   * Access token, cached until shortly before it expires.
   *
   * SignNow issues a bearer token from a Basic-authenticated call carrying the
   * client credentials, exchanged for a user token. Re-requesting one per API
   * call would be both slow and a good way to get rate limited.
   */
  private async accessToken(): Promise<string> {
    this.assertConfigured();
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

    const basic = Buffer.from(`${env.SIGNNOW_CLIENT_ID}:${env.SIGNNOW_CLIENT_SECRET}`).toString('base64');
    const response = await this.fetchRaw(ENDPOINTS.token, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: env.SIGNNOW_USERNAME!,
        password: env.SIGNNOW_PASSWORD!,
        scope: '*',
      }).toString(),
    });

    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!response.ok || !body.access_token) {
      throw new EsignError(`SignNow rejected the credentials (HTTP ${response.status}).`);
    }
    tokenCache = {
      token: body.access_token,
      expiresAt: now + (body.expires_in ?? 3600) * 1000,
    };
    return tokenCache.token;
  }

  private async fetchRaw(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new EsignError(
        error instanceof Error ? `Could not reach SignNow: ${error.message}` : 'Could not reach SignNow.',
        true,
      );
    }
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken();
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    const response = await this.fetchRaw(path, { ...init, headers });

    if (response.status === 401) {
      // The cached token went stale mid-flight; drop it so the next call
      // re-authenticates rather than failing repeatedly.
      tokenCache = null;
      throw new EsignError('SignNow rejected the access token.', true);
    }
    // 429 and 5xx are worth another attempt; 4xx is not.
    if (response.status === 429 || response.status >= 500) {
      throw new EsignError(`SignNow is unavailable (HTTP ${response.status}).`, true);
    }
    return response;
  }

  async createRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.file)], { type: 'application/pdf' }), input.fileName);
    const upload = await this.call(ENDPOINTS.uploadDocument, { method: 'POST', body: form });
    const uploaded = (await upload.json()) as { id?: string; errors?: unknown };
    if (!upload.ok || !uploaded.id) {
      throw new EsignError(`SignNow would not accept the document (HTTP ${upload.status}).`);
    }

    // An embedded invite is bound to one signer and produces a link that
    // cannot be usefully forwarded — the alternative, an emailed invite, can.
    const inviteResponse = await this.call(ENDPOINTS.embeddedInvite(uploaded.id), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        invites: [
          {
            email: input.signerEmail,
            role_id: '',
            order: 1,
            auth_method: 'none',
            ...(input.message ? { message: input.message } : {}),
          },
        ],
        ...(input.redirectUrl ? { redirect_uri: input.redirectUrl } : {}),
      }),
    });
    const invite = (await inviteResponse.json()) as { data?: { id?: string }[]; id?: string };
    if (!inviteResponse.ok) {
      throw new EsignError(`SignNow would not create the invite (HTTP ${inviteResponse.status}).`);
    }

    return {
      providerDocumentId: uploaded.id,
      providerInviteId: invite.data?.[0]?.id ?? invite.id ?? null,
    };
  }

  async signingLink(providerDocumentId: string, signerEmail: string): Promise<SigningLink> {
    const inviteId = await this.firstInviteId(providerDocumentId, signerEmail);
    const response = await this.call(ENDPOINTS.embeddedInviteLink(providerDocumentId, inviteId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ auth_method: 'none', link_expiration: Math.floor(LINK_TTL_SECONDS / 60) }),
    });
    const body = (await response.json()) as { data?: { link?: string }; link?: string };
    const url = body.data?.link ?? body.link;
    if (!response.ok || !url) {
      throw new EsignError(`SignNow would not issue a signing link (HTTP ${response.status}).`);
    }
    return { url, expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000) };
  }

  private async firstInviteId(providerDocumentId: string, signerEmail: string): Promise<string> {
    const response = await this.call(ENDPOINTS.documentById(providerDocumentId));
    const body = (await response.json()) as {
      field_invites?: { id?: string; email?: string }[];
      embedded_invites?: { id?: string; email?: string }[];
    };
    const invites = [...(body.embedded_invites ?? []), ...(body.field_invites ?? [])];
    const match = invites.find((i) => i.email?.toLowerCase() === signerEmail.toLowerCase()) ?? invites[0];
    if (!match?.id) throw new EsignError('SignNow has no signing invite on that document.');
    return match.id;
  }

  /**
   * Fetch the completed PDF and its audit certificate.
   *
   * Both, always. The certificate is what proves who signed and how they were
   * verified, and it is the thing that stops the provider owning your evidence
   * — if FSW leaves SignNow in three years, the proof travels with the file.
   */
  async downloadSigned(providerDocumentId: string): Promise<SignedArtifacts> {
    const pdfResponse = await this.call(ENDPOINTS.download(providerDocumentId));
    if (!pdfResponse.ok) {
      throw new EsignError(`Could not download the signed document (HTTP ${pdfResponse.status}).`, true);
    }
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());

    // A missing certificate is worth recording but must not lose the signed
    // document we already hold.
    let certificate: Buffer | null = null;
    try {
      const certResponse = await this.call(ENDPOINTS.historyDownload(providerDocumentId));
      if (certResponse.ok) certificate = Buffer.from(await certResponse.arrayBuffer());
    } catch {
      certificate = null;
    }
    return { pdf, certificate };
  }

  async cancel(providerDocumentId: string): Promise<void> {
    await this.call(ENDPOINTS.cancelInvite(providerDocumentId), { method: 'PUT' });
  }

  async remind(providerDocumentId: string): Promise<void> {
    await this.call(ENDPOINTS.resendInvite(providerDocumentId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'signer' }),
    });
  }

  /**
   * Verify the webhook signature over the RAW bytes.
   *
   * Never over a re-serialized object: an attacker who can vary whitespace or
   * key order would otherwise be able to reuse a captured signature.
   */
  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const secret = env.SIGNNOW_WEBHOOK_SECRET;
    if (!secret) return false;
    const presented =
      headers.get('x-signnow-signature') ??
      headers.get('signnow-signature') ??
      headers.get('x-hub-signature-256');
    if (!presented) return false;

    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
    for (const encoding of ['base64', 'hex'] as const) {
      let provided: Buffer;
      try {
        provided = Buffer.from(presented.trim().replace(/^sha256=/, ''), encoding);
      } catch {
        continue;
      }
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
    }
    return false;
  }

  parseWebhook(body: unknown): ParsedWebhookEvent | null {
    return parseSignNowEvent(body);
  }
}

// ---------------------------------------------------------------------------
// Payload parsing — pure, and therefore fully tested
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const obj = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;

const str = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

/** SignNow event names mapped onto our provider-neutral vocabulary. */
const EVENT_MAP: Record<string, ParsedWebhookEvent['kind']> = {
  'document.open': 'VIEWED',
  'document.view': 'VIEWED',
  'document.complete': 'SIGNED',
  'document.completed': 'SIGNED',
  'document.update': 'VIEWED',
  'invite.create': 'SENT',
  'invite.sent': 'SENT',
  'document.decline': 'DECLINED',
  'document.declined': 'DECLINED',
  'invite.decline': 'DECLINED',
  'document.expire': 'EXPIRED',
  'document.expired': 'EXPIRED',
};

/**
 * Normalise a SignNow webhook body.
 *
 * Returns null for anything we do not recognise, rather than guessing. An
 * unrecognised event is still logged by the caller — silence about a delivery
 * we could not read would be worse than an unhandled one.
 */
export function parseSignNowEvent(body: unknown): ParsedWebhookEvent | null {
  const root = obj(body);
  if (!root) return null;

  const meta = obj(root.meta) ?? {};
  const content = obj(root.content) ?? obj(root.data) ?? {};

  const rawEvent = (str(root.event) ?? str(meta.event) ?? str(root.event_type) ?? '').toLowerCase();
  const kind = EVENT_MAP[rawEvent];
  if (!kind) return null;

  const providerDocumentId =
    str(content.document_id) ?? str(root.document_id) ?? str(content.id) ?? str(meta.document_id);
  if (!providerDocumentId) return null;

  // A provider event id is what makes redelivery a no-op. Without one, fall
  // back to a deterministic composite so idempotency still holds.
  const providerEventId =
    str(root.event_id) ?? str(meta.event_id) ?? str(root.id) ?? `${rawEvent}:${providerDocumentId}`;

  const timestampRaw = root.timestamp ?? meta.timestamp ?? content.created;
  let occurredAt = new Date();
  if (typeof timestampRaw === 'number') {
    // SignNow sends seconds; a value that large is already milliseconds.
    occurredAt = new Date(timestampRaw > 1e12 ? timestampRaw : timestampRaw * 1000);
  } else if (typeof timestampRaw === 'string') {
    const parsed = new Date(timestampRaw);
    if (!Number.isNaN(parsed.getTime())) occurredAt = parsed;
  }

  return {
    kind,
    providerDocumentId,
    providerEventId,
    occurredAt,
    detail: str(content.reason) ?? str(root.reason) ?? null,
  };
}

/** What we keep about a delivery: shape, never contents. */
export interface PayloadDigest {
  // Index signature so the digest drops straight into a Prisma Json column and
  // an audit metadata field without a cast at every call site.
  [key: string]: string | boolean | string[] | null;
  event: string | null;
  hasDocumentId: boolean;
  hasUserId: boolean;
  topLevelKeys: string[];
}

/** Presence flags only — never a second copy of the payload's contents. */
export function signNowPayloadDigest(body: unknown): PayloadDigest {
  const root = obj(body) ?? {};
  const content = obj(root.content) ?? obj(root.data) ?? {};
  return {
    event: str(root.event) ?? str(root.event_type),
    hasDocumentId: Boolean(str(content.document_id) ?? str(root.document_id)),
    hasUserId: Boolean(str(content.user_id) ?? str(root.user_id)),
    topLevelKeys: Object.keys(root).slice(0, 25),
  };
}
