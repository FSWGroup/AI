/**
 * A local identity provider for tests (ADR-0029).
 *
 * Real key generation and real signature verification, with no network: the point is
 * that `verifyToken` runs its actual code path, including a signature check that a
 * tampered token fails. A test double that returns a fixed payload would prove nothing
 * about the thing most worth proving.
 */
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import type { IssuerConfig, KeyResolver } from '../../src/modules/iam/index.js';

export interface FakeIssuer {
  readonly config: Omit<IssuerConfig, 'id'>;
  readonly keys: JWTVerifyGetKey;
  sign(claims: Record<string, unknown>, options?: SignOptions): Promise<string>;
}

export interface SignOptions {
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresIn?: string;
  readonly notBefore?: string;
}

export async function createFakeIssuer(input: {
  issuerUrl: string;
  name: string;
  audience: string;
  allowedTenantIds?: readonly string[];
  jitEnabled?: boolean;
  jitEmailDomains?: readonly string[];
  defaultOperatingCompany?: string;
}): Promise<FakeIssuer> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = `${input.name}-1`;
  jwk.alg = 'RS256';
  const keys = createLocalJWKSet({ keys: [jwk] });

  return {
    config: {
      issuerUrl: input.issuerUrl,
      name: input.name,
      jwksUri: `${input.issuerUrl}/.well-known/jwks.json`,
      audiences: [input.audience],
      allowedTenantIds: input.allowedTenantIds ?? [],
      jitEnabled: input.jitEnabled ?? false,
      jitEmailDomains: input.jitEmailDomains ?? [],
      defaultOperatingCompany: input.defaultOperatingCompany,
      clockSkewSeconds: 60,
    },
    keys,
    async sign(claims, options = {}) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid as string })
        .setIssuer(options.issuer ?? input.issuerUrl)
        .setAudience(options.audience ?? input.audience)
        .setIssuedAt()
        .setNotBefore(options.notBefore ?? '0s')
        .setExpirationTime(options.expiresIn ?? '5m')
        .sign(privateKey);
    },
  };
}

/** A key resolver over a fixed set of fake issuers. No network, by construction. */
export function localKeyResolver(issuers: readonly FakeIssuer[]): KeyResolver {
  return (issuer) => {
    const found = issuers.find(
      (candidate) => candidate.config.issuerUrl === issuer.issuerUrl,
    );
    if (found === undefined) {
      throw new Error(`No test keys for issuer ${issuer.issuerUrl}`);
    }
    return found.keys;
  };
}
