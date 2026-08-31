/** Identity and access module public surface (ADR-0003). */
export {
  decide,
  allowed,
  scopeCovers,
  scopeFilterFor,
  loadPrincipalContext,
} from './authorization.js';
export type {
  Decision,
  DecisionOutcome,
  GrantedPermission,
  PrincipalContext,
  Scope,
  ScopeFilter,
  ScopeType,
} from './authorization.js';

export {
  loadIssuers,
  assertIssuerUsable,
  verifyToken,
  resolveIdentity,
  linkIdentity,
  remoteKeyResolver,
} from './authentication.js';
export type {
  IssuerConfig,
  KeyResolver,
  ResolutionOutcome,
  VerifiedToken,
} from './authentication.js';

export {
  issueCredential,
  rotateCredential,
  revokeCredential,
  authenticateCredential,
  expiringCredentials,
  safeEqual,
  DEFAULT_CREDENTIAL_DAYS,
  EXPIRY_WARNING_DAYS,
} from './credentials.js';
export type {
  AuthenticatedCredential,
  ExpiringCredential,
  IssuedCredential,
  IssueCredentialInput,
} from './credentials.js';

export {
  createPersonPrincipal,
  createServiceAccount,
  assignRole,
  revokeRole,
  recordDenial,
  describePrincipal,
} from './administration.js';
export type {
  AssignRoleInput,
  CreatePersonPrincipalInput,
  CreateServiceAccountInput,
  DenialRecord,
  PrincipalSummary,
} from './administration.js';

export {
  operatingCompanyPredicate,
  operatingCompanyOrGroupPredicate,
  withinScope,
} from './scoped-read.js';

export {
  PersonRegistered,
  IdentityLinked,
  PendingLinkRequested,
  PrincipalRoleAssigned,
  PrincipalRoleRevoked,
  ServiceAccountCreated,
  CredentialRotated,
  iamEvents,
} from './events.js';
