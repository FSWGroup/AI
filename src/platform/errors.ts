/**
 * Errors as RFC 9457 Problem Details (ADR-0028, spec §57).
 *
 * Stack traces, SQL, secrets and filesystem paths never reach a client. The
 * correlation ID is the bridge between what the client sees and what the logs hold.
 */

export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  /** Stable machine-readable code. Clients branch on this, never on the message. */
  readonly code: string;
  readonly correlationId?: string;
  readonly errors?: readonly FieldError[];
}

const PROBLEM_BASE = 'https://docs.fsw.group/layer0/problems';

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: readonly FieldError[] | undefined;
  /** Safe to show a client. Anything unsafe stays in `cause` and goes to the logs. */
  readonly publicDetail: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: {
      publicDetail?: string;
      fieldErrors?: readonly FieldError[];
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.publicDetail = options?.publicDetail;
    this.fieldErrors = options?.fieldErrors;
  }

  toProblem(correlationId?: string, instance?: string): ProblemDetails {
    return {
      type: `${PROBLEM_BASE}/${this.code.toLowerCase().replace(/_/g, '-')}`,
      title: this.message,
      status: this.status,
      code: this.code,
      ...(this.publicDetail === undefined ? {} : { detail: this.publicDetail }),
      ...(instance === undefined ? {} : { instance }),
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(this.fieldErrors === undefined ? {} : { errors: this.fieldErrors }),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors: readonly FieldError[] = []) {
    super(422, 'VALIDATION_FAILED', message, { fieldErrors, publicDetail: message });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(404, 'NOT_FOUND', `${resource} not found`, {
      publicDetail: `No ${resource} with identifier '${id}'.`,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, publicDetail?: string) {
    super(409, 'CONFLICT', message, publicDetail === undefined ? {} : { publicDetail });
  }
}

/** Optimistic concurrency: the client's version is stale (ADR-0028, spec §58). */
export class PreconditionFailedError extends AppError {
  readonly currentVersion: number;
  constructor(resource: string, expected: string, currentVersion: number) {
    super(412, 'STALE_VERSION', `${resource} has been modified`, {
      publicDetail:
        `The resource was modified since version ${expected} was read. ` +
        `Re-read it, reapply the change, and retry with If-Match: "${currentVersion}".`,
    });
    this.currentVersion = currentVersion;
  }
}

/** A mutable resource was addressed without If-Match. A missing precondition is an error. */
export class PreconditionRequiredError extends AppError {
  constructor(resource: string) {
    super(428, 'PRECONDITION_REQUIRED', 'If-Match is required', {
      publicDetail:
        `Updating a ${resource} requires an If-Match header carrying the version you ` +
        `read, so a stale write cannot silently overwrite a newer one.`,
    });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(detail = 'Authentication is required.') {
    super(401, 'UNAUTHENTICATED', 'Authentication required', { publicDetail: detail });
  }
}

export class ForbiddenError extends AppError {
  readonly permission: string;
  readonly scope: string;
  constructor(permission: string, scope: string) {
    // Deliberately does not reveal whether the resource exists.
    super(403, 'FORBIDDEN', 'Not permitted', {
      publicDetail: `This principal lacks '${permission}' in the required scope.`,
    });
    this.permission = permission;
    this.scope = scope;
  }
}

/** An idempotency key was reused with a different request body (ADR-0028). */
export class IdempotencyConflictError extends AppError {
  constructor() {
    super(
      422,
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency key reused with different content',
      {
        publicDetail:
          'This Idempotency-Key was already used for a request with a different body. ' +
          'Use a new key, or resend the identical request.',
      },
    );
  }
}

/**
 * Convert anything thrown into a problem document. Unknown errors become a generic
 * 500: the detail goes to the logs under the correlation ID, never to the client.
 */
export function toProblem(
  error: unknown,
  correlationId?: string,
  instance?: string,
): ProblemDetails {
  if (error instanceof AppError) return error.toProblem(correlationId, instance);
  return {
    type: `${PROBLEM_BASE}/internal-error`,
    title: 'Internal server error',
    status: 500,
    code: 'INTERNAL_ERROR',
    detail: 'An unexpected error occurred. Quote the correlation ID when reporting it.',
    ...(instance === undefined ? {} : { instance }),
    ...(correlationId === undefined ? {} : { correlationId }),
  };
}
