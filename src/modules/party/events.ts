/**
 * Party domain events (ADR-0009).
 *
 * Payloads carry identifiers and field keys — never names, addresses, emails or phone
 * numbers. The event ledger is immutable and a person can demand erasure; those two
 * requirements can only coexist if personal data was never written there (ADR-0027).
 * The deny-list check in `defineEvent` enforces it, and a consumer that needs the
 * value reads it through the API, where authorization and erasure both apply.
 */
import { Type } from '@sinclair/typebox';
import { defineEvent } from '../events/index.js';

const EntityRef = {
  organizationId: Type.String({ format: 'uuid' }),
};

export const OrganizationCreated = defineEvent({
  type: 'fsw.party.OrganizationCreated',
  version: 1,
  module: 'party',
  aggregateType: 'Organization',
  description:
    'A new canonical organization exists. Consumers that keep their own copy learn ' +
    'of it here; the fields themselves are read through the API.',
  payload: Type.Object(
    {
      ...EntityRef,
      sourceSystemCode: Type.String(),
      confidence: Type.String(),
    },
    { additionalProperties: false },
  ),
});

export const OrganizationFieldValueChanged = defineEvent({
  type: 'fsw.party.OrganizationFieldValueChanged',
  version: 1,
  module: 'party',
  aggregateType: 'Organization',
  description:
    'Survivorship selected a different value for a mastered field. Carries the field ' +
    'key and which source won, never the value: the value may be personal data, and ' +
    'a consumer that is entitled to it can read it.',
  payload: Type.Object(
    {
      ...EntityRef,
      fieldKey: Type.String(),
      winningSourceCode: Type.Union([Type.String(), Type.Null()]),
      previousSourceCode: Type.Union([Type.String(), Type.Null()]),
      ruleVersion: Type.Integer(),
    },
    { additionalProperties: false },
  ),
});

export const OrganizationRoleGranted = defineEvent({
  type: 'fsw.party.OrganizationRoleGranted',
  version: 1,
  module: 'party',
  aggregateType: 'Organization',
  description:
    'An organization now plays a role — becoming a customer of one of the businesses, ' +
    'or being recognised as a manufacturer. Authorization scope can depend on this.',
  payload: Type.Object(
    {
      ...EntityRef,
      roleCode: Type.String(),
      operatingCompany: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
});

export const OrganizationRelationshipChanged = defineEvent({
  type: 'fsw.party.OrganizationRelationshipChanged',
  version: 1,
  module: 'party',
  aggregateType: 'Organization',
  description:
    'Corporate structure changed: a parent, a division, an acquisition. Rollups and ' +
    'territory assignments depend on it.',
  payload: Type.Object(
    {
      ...EntityRef,
      toOrganizationId: Type.String({ format: 'uuid' }),
      relationshipCode: Type.String(),
      change: Type.Union([Type.Literal('ADDED'), Type.Literal('ENDED')]),
    },
    { additionalProperties: false },
  ),
});

export const SiteCreated = defineEvent({
  type: 'fsw.party.SiteCreated',
  version: 1,
  module: 'party',
  aggregateType: 'Site',
  description:
    'A physical facility is now known. The thing a salesperson visits and equipment ' +
    'is installed in — not an address and not a ship-to.',
  payload: Type.Object(
    {
      siteId: Type.String({ format: 'uuid' }),
      ...EntityRef,
      siteType: Type.String(),
    },
    { additionalProperties: false },
  ),
});

export const CommercialAccountLinked = defineEvent({
  type: 'fsw.party.CommercialAccountLinked',
  version: 1,
  module: 'party',
  aggregateType: 'Organization',
  description:
    "A source system's account is now attached to a canonical organization. This is " +
    'the event that lets a consumer answer "which P21 customers are this company".',
  payload: Type.Object(
    {
      ...EntityRef,
      commercialAccountId: Type.String({ format: 'uuid' }),
      sourceSystemCode: Type.String(),
      operatingCompany: Type.String(),
    },
    { additionalProperties: false },
  ),
});

export const PersonAffiliationStarted = defineEvent({
  type: 'fsw.party.PersonAffiliationStarted',
  version: 1,
  module: 'party',
  aggregateType: 'Person',
  description:
    'A person is now affiliated with an organization. Never a boolean on the person: ' +
    'someone who moves from a customer to a competitor is one person with two ' +
    'affiliations, and that history is the valuable part.',
  payload: Type.Object(
    {
      personId: Type.String({ format: 'uuid' }),
      ...EntityRef,
      affiliationCode: Type.String(),
      siteId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
});

export const PersonAffiliationEnded = defineEvent({
  type: 'fsw.party.PersonAffiliationEnded',
  version: 1,
  module: 'party',
  aggregateType: 'Person',
  description:
    'An affiliation ended. The row is kept with an end date; a contact who left is ' +
    'history, not an error to clean up.',
  payload: Type.Object(
    {
      personId: Type.String({ format: 'uuid' }),
      ...EntityRef,
      affiliationCode: Type.String(),
    },
    { additionalProperties: false },
  ),
});

export const OrganizationsMerged = defineEvent({
  type: 'fsw.party.OrganizationsMerged',
  version: 1,
  module: 'party',
  aggregateType: 'Organization',
  description:
    'Two organizations were judged to be one. Consumers holding the merged identifier ' +
    'must follow it to the survivor — the old identifier keeps resolving and is never ' +
    'reused, so nothing breaks, but a consumer that stores it will accumulate ' +
    'redirects until it updates.',
  payload: Type.Object(
    {
      ...EntityRef,
      mergedOrganizationId: Type.String({ format: 'uuid' }),
      mergeId: Type.String({ format: 'uuid' }),
      method: Type.String(),
      movedRows: Type.Integer({ minimum: 0 }),
      changedFieldKeys: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
});

export const OrganizationMergeReversed = defineEvent({
  type: 'fsw.party.OrganizationMergeReversed',
  version: 1,
  module: 'party',
  aggregateType: 'Organization',
  description:
    'A merge was undone and both organizations are live again. Their field values were ' +
    'recomputed rather than restored, so each says what it should say now — which is ' +
    'not necessarily what it said before the merge.',
  payload: Type.Object(
    {
      ...EntityRef,
      restoredOrganizationId: Type.String({ format: 'uuid' }),
      mergeId: Type.String({ format: 'uuid' }),
      restoredRows: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
});

export const MatchCandidateRaised = defineEvent({
  type: 'fsw.party.MatchCandidateRaised',
  version: 1,
  module: 'party',
  aggregateType: 'MatchCandidate',
  description:
    'Two records may be the same thing and a person needs to decide. Carries the score ' +
    'and the identifiers; the feature vector that explains the score is read through ' +
    'the API, where it can be shown properly.',
  payload: Type.Object(
    {
      matchCandidateId: Type.String({ format: 'uuid' }),
      entityType: Type.String(),
      leftEntityId: Type.String({ format: 'uuid' }),
      rightEntityId: Type.String({ format: 'uuid' }),
      score: Type.Number({ minimum: 0, maximum: 1 }),
      method: Type.String(),
    },
    { additionalProperties: false },
  ),
});

export const MatchCandidateDecided = defineEvent({
  type: 'fsw.party.MatchCandidateDecided',
  version: 1,
  module: 'party',
  aggregateType: 'MatchCandidate',
  description:
    'A steward decided a pair. A rejection is as valuable as an approval: it is what ' +
    'stops the pair resurfacing until the evidence actually changes.',
  payload: Type.Object(
    {
      matchCandidateId: Type.String({ format: 'uuid' }),
      entityType: Type.String(),
      status: Type.String(),
      mergeId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
});

export const partyEvents = [
  OrganizationCreated,
  OrganizationFieldValueChanged,
  OrganizationRoleGranted,
  OrganizationRelationshipChanged,
  SiteCreated,
  CommercialAccountLinked,
  PersonAffiliationStarted,
  PersonAffiliationEnded,
  OrganizationsMerged,
  OrganizationMergeReversed,
  MatchCandidateRaised,
  MatchCandidateDecided,
] as const;
