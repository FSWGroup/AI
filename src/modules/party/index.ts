/** Party module public surface (ADR-0003). */
export {
  loadFieldRegistry,
  FieldRegistry,
  UnknownFieldError,
  ENTITY_TABLE,
} from './fields.js';
export type {
  EntityType,
  FieldValueType,
  Classification,
  MasteredField,
} from './fields.js';

export { assertCandidates, readProvenance } from './candidates.js';
export type {
  CandidateInput,
  ProvenanceEntry,
  VerificationStatus,
} from './candidates.js';

export {
  evaluateFields,
  loadSurvivorshipDeps,
  selectWinner,
  RuleSet,
} from './survivorship.js';
export type {
  Candidate,
  EvaluationResult,
  FieldOwnership,
  Strategy,
  SurvivorshipDeps,
  SurvivorshipRule,
} from './survivorship.js';

export {
  createLocation,
  normalizeLine,
  normalizedKey,
  composeRaw,
  NORMALIZATION_VERSION,
} from './locations.js';
export type { AddressInput, CreateLocationInput } from './locations.js';

export {
  loadPartyDeps,
  createOrganization,
  assertOrganizationFields,
  reevaluateOrganization,
  grantRole,
  relateOrganizations,
  readOrganization,
  RelationshipCycleError,
} from './organizations.js';
export type {
  PartyDeps,
  CreateOrganizationInput,
  OrganizationRoleInput,
  AssertFieldsInput,
  RelationshipInput,
  OrganizationView,
} from './organizations.js';

export {
  OrganizationCreated,
  OrganizationFieldValueChanged,
  OrganizationRoleGranted,
  OrganizationRelationshipChanged,
  SiteCreated,
  CommercialAccountLinked,
  PersonAffiliationStarted,
  PersonAffiliationEnded,
  partyEvents,
} from './events.js';
