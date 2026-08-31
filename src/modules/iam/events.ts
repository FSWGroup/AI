/**
 * Identity and access events (ADR-0009).
 *
 * Payloads carry identifiers only. A person's name and email are personal data and this
 * ledger is immutable: writing them here would make lawful erasure impossible, which is
 * the whole reason the deny-list check exists (ADR-0027).
 *
 * Note what is NOT an event: a successful authentication. Every login would be a ledger
 * row nobody consumes, and the ledger is meant to carry business facts rather than
 * traffic. Access DENIALS are recorded, in `iam.access_denial`, where a refusal rate is
 * actually readable.
 */
import { Type } from '@sinclair/typebox';
import { defineEvent } from '../events/index.js';

export const PersonRegistered = defineEvent({
  type: 'fsw.iam.PersonRegistered',
  version: 1,
  module: 'iam',
  aggregateType: 'Person',
  description:
    'A new canonical person exists. Carries how they came to exist, because a person ' +
    'provisioned automatically on first login warrants a different kind of attention ' +
    'from one an administrator created deliberately.',
  payload: Type.Object(
    {
      personId: Type.String({ format: 'uuid' }),
      principalId: Type.String({ format: 'uuid' }),
      issuerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
      provisioning: Type.Union([Type.Literal('JIT'), Type.Literal('ADMINISTRATIVE')]),
    },
    { additionalProperties: false },
  ),
});

export const IdentityLinked = defineEvent({
  type: 'fsw.iam.IdentityLinked',
  version: 1,
  module: 'iam',
  aggregateType: 'Person',
  description:
    'A person can now authenticate through another issuer. This is the event behind ' +
    'one human being one person across two directories.',
  payload: Type.Object(
    {
      identityId: Type.String({ format: 'uuid' }),
      personId: Type.String({ format: 'uuid' }),
      issuerId: Type.String({ format: 'uuid' }),
    },
    { additionalProperties: false },
  ),
});

export const PendingLinkRequested = defineEvent({
  type: 'fsw.iam.PendingLinkRequested',
  version: 1,
  module: 'iam',
  aggregateType: 'PendingLinkRequest',
  description:
    'Someone authenticated successfully against a trusted issuer and could not be ' +
    'matched to a person. An administrator needs to link or refuse them. The claimed ' +
    'email is deliberately not here: it is personal data, and it is in the request row ' +
    'for an administrator to read.',
  payload: Type.Object(
    {
      requestId: Type.String({ format: 'uuid' }),
      issuerId: Type.String({ format: 'uuid' }),
    },
    { additionalProperties: false },
  ),
});

export const PrincipalRoleAssigned = defineEvent({
  type: 'fsw.iam.PrincipalRoleAssigned',
  version: 1,
  module: 'iam',
  aggregateType: 'Principal',
  description:
    'A principal gained a role in a scope. Consumers cache permission sets, so this is ' +
    'what lets one react immediately rather than waiting out its cache.',
  payload: Type.Object(
    {
      principalId: Type.String({ format: 'uuid' }),
      roleKey: Type.String(),
      scopeType: Type.String(),
      scopeId: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
});

export const PrincipalRoleRevoked = defineEvent({
  type: 'fsw.iam.PrincipalRoleRevoked',
  version: 1,
  module: 'iam',
  aggregateType: 'Principal',
  description:
    'A principal lost a role. More urgent than the grant: a consumer holding a cached ' +
    'permission set is briefly allowing something that is no longer permitted.',
  payload: Type.Object(
    {
      principalId: Type.String({ format: 'uuid' }),
      roleKey: Type.String(),
      scopeType: Type.String(),
      scopeId: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
});

export const ServiceAccountCreated = defineEvent({
  type: 'fsw.iam.ServiceAccountCreated',
  version: 1,
  module: 'iam',
  aggregateType: 'Principal',
  description: 'An automated actor now exists and can be given roles.',
  payload: Type.Object(
    {
      principalId: Type.String({ format: 'uuid' }),
      serviceAccountId: Type.String({ format: 'uuid' }),
      key: Type.String(),
    },
    { additionalProperties: false },
  ),
});

export const CredentialRotated = defineEvent({
  type: 'fsw.iam.CredentialRotated',
  version: 1,
  module: 'iam',
  aggregateType: 'Principal',
  description:
    'A machine credential was issued or replaced. Carries identifiers and the expiry, ' +
    'never the secret — which exists in one response body and nowhere else, ever.',
  payload: Type.Object(
    {
      principalId: Type.String({ format: 'uuid' }),
      credentialId: Type.String(),
      replacesCredentialId: Type.Union([Type.String(), Type.Null()]),
      expiresAt: Type.String({ format: 'date-time' }),
    },
    { additionalProperties: false },
  ),
});

export const iamEvents = [
  PersonRegistered,
  IdentityLinked,
  PendingLinkRequested,
  PrincipalRoleAssigned,
  PrincipalRoleRevoked,
  ServiceAccountCreated,
  CredentialRotated,
] as const;
