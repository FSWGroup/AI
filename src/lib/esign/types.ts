/**
 * The e-signature provider seam.
 *
 * Storage and email already sit behind driver interfaces in this codebase and
 * e-sign gets the same treatment, for a specific reason: e-signature vendors
 * get acquired and repriced regularly, and the one thing you cannot afford to
 * lose in a migration is the evidence that somebody signed something. Keeping
 * the vendor surface this thin means switching is a new adapter, not a rewrite
 * — and it keeps the untestable part of the system small.
 *
 * Everything in this file is pure types and pure functions, so the state
 * machine below is fully testable without touching a network.
 */

export interface CreateRequestInput {
  /** The PDF to be signed. */
  file: Buffer;
  fileName: string;
  /** Shown to the signer. */
  documentTitle: string;
  signerName: string;
  signerEmail: string;
  /** Optional note from the requester, shown in the signing ceremony. */
  message?: string | null;
  /** Where the signer is returned after signing, for embedded flows. */
  redirectUrl?: string | null;
}

export interface CreateRequestResult {
  providerDocumentId: string;
  providerInviteId: string | null;
}

export interface SigningLink {
  url: string;
  expiresAt: Date;
}

export interface SignedArtifacts {
  /** The completed, flattened PDF. */
  pdf: Buffer;
  /**
   * The provider's audit certificate — who signed, when, from where, with what
   * verification. Null only if the provider genuinely does not produce one,
   * which is a reason to choose a different provider.
   */
  certificate: Buffer | null;
}

/** The provider-neutral events we act on. Anything else is recorded and ignored. */
export type SignatureEventKind = 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'EXPIRED';

export interface ParsedWebhookEvent {
  kind: SignatureEventKind;
  providerDocumentId: string;
  /** Stable per delivery. The idempotency key — a redelivery is a no-op. */
  providerEventId: string;
  occurredAt: Date;
  detail?: string | null;
}

export interface EsignProvider {
  readonly name: string;
  /** False when the adapter has no credentials; the UI then says so plainly. */
  isConfigured(): boolean;

  createRequest(input: CreateRequestInput): Promise<CreateRequestResult>;
  /** Short-lived and bound to one signer — never a forwardable link. */
  signingLink(providerDocumentId: string, signerEmail: string): Promise<SigningLink>;
  downloadSigned(providerDocumentId: string): Promise<SignedArtifacts>;
  cancel(providerDocumentId: string): Promise<void>;
  remind(providerDocumentId: string): Promise<void>;

  /** Verify against the RAW request bytes, never a re-serialized object. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseWebhook(body: unknown): ParsedWebhookEvent | null;
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export const SIGNATURE_STATUSES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'SIGNED',
  'STORED',
  'DECLINED',
  'EXPIRED',
  'CANCELED',
  'FAILED',
] as const;

export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

/** A status nothing can move out of. */
export const TERMINAL_STATUSES: SignatureStatus[] = ['STORED', 'DECLINED', 'EXPIRED', 'CANCELED'];

/**
 * Legal transitions.
 *
 * Two properties this encodes deliberately:
 *
 *  - **Status never goes backwards.** Providers deliver webhooks out of order,
 *    so a VIEWED arriving after SIGNED must not un-sign the document.
 *  - **SIGNED and STORED are separate.** SIGNED is the provider's claim;
 *    STORED means we hold the bytes and the certificate ourselves. Collapsing
 *    them would let a failed download look like a completed signature.
 */
const TRANSITIONS: Record<SignatureStatus, SignatureStatus[]> = {
  DRAFT: ['SENT', 'CANCELED', 'FAILED'],
  SENT: ['VIEWED', 'SIGNED', 'DECLINED', 'EXPIRED', 'CANCELED', 'FAILED'],
  VIEWED: ['SIGNED', 'DECLINED', 'EXPIRED', 'CANCELED', 'FAILED'],
  SIGNED: ['STORED', 'FAILED'],
  // FAILED is recoverable: a download that failed can be retried, so it can
  // return to SIGNED and go on to STORED.
  FAILED: ['SIGNED', 'STORED', 'CANCELED'],
  STORED: [],
  DECLINED: [],
  EXPIRED: [],
  CANCELED: [],
};

export function canTransition(from: SignatureStatus, to: SignatureStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Map a provider event onto a status, or null when it implies no change. */
export function statusForEvent(kind: SignatureEventKind): SignatureStatus | null {
  switch (kind) {
    case 'SENT':
      return 'SENT';
    case 'VIEWED':
      return 'VIEWED';
    case 'SIGNED':
      return 'SIGNED';
    case 'DECLINED':
      return 'DECLINED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return null;
  }
}

export function isOutstanding(status: string): boolean {
  return status === 'DRAFT' || status === 'SENT' || status === 'VIEWED';
}

export function isOverdue(status: string, dueAt: Date | null, now = new Date()): boolean {
  return isOutstanding(status) && dueAt !== null && dueAt < now;
}

export class EsignError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'EsignError';
  }
}
