/**
 * Address handling (spec §46).
 *
 * The rule: the raw address is preserved exactly as the source gave it, and a
 * normalized form sits beside it. Normalizing in place destroys the only evidence
 * that distinguishes a normalization bug from a bad source, and there is no way to
 * get it back once the import has run.
 *
 * The normalization here is deliberately conservative — case, whitespace, punctuation
 * and the small set of USPS street-suffix abbreviations. It exists to produce a
 * blocking key for entity resolution, not to validate deliverability. Address
 * verification is a third-party service and a discovery question (H3); guessing at it
 * would produce addresses that look verified and are not.
 */
import { sql } from 'kysely';
import type { UnitOfWork } from '../../kernel/unit-of-work.js';
import { ValidationError } from '../../platform/errors.js';

/** Bumped when normalization changes meaning, so stored keys can be recomputed. */
export const NORMALIZATION_VERSION = 1;

/**
 * Street-suffix abbreviations, from the USPS standard set. Only the unambiguous ones:
 * 'ST' is Street, but a source writing 'ST' may mean Saint, so expansion is one-way
 * (long form to short) and never the reverse.
 */
const SUFFIXES = new Map<string, string>([
  ['street', 'st'],
  ['avenue', 'ave'],
  ['boulevard', 'blvd'],
  ['road', 'rd'],
  ['drive', 'dr'],
  ['lane', 'ln'],
  ['court', 'ct'],
  ['circle', 'cir'],
  ['place', 'pl'],
  ['parkway', 'pkwy'],
  ['highway', 'hwy'],
  ['turnpike', 'tpke'],
  ['terrace', 'ter'],
  ['square', 'sq'],
  ['suite', 'ste'],
  ['building', 'bldg'],
  ['floor', 'fl'],
  ['north', 'n'],
  ['south', 's'],
  ['east', 'e'],
  ['west', 'w'],
  ['northeast', 'ne'],
  ['northwest', 'nw'],
  ['southeast', 'se'],
  ['southwest', 'sw'],
]);

export interface AddressInput {
  readonly line1?: string | undefined;
  readonly line2?: string | undefined;
  readonly city?: string | undefined;
  readonly regionCode?: string | undefined;
  readonly postalCode?: string | undefined;
  readonly countryCode?: string | undefined;
  /**
   * The address exactly as the source gave it. Supplied where the source has a single
   * address blob; otherwise it is composed from the parts, unedited.
   */
  readonly rawAddress?: string | undefined;
}

/** Normalize one line for comparison. Never stored over the raw value. */
export function normalizeLine(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token !== '');
  return tokens.map((token) => SUFFIXES.get(token) ?? token).join(' ');
}

/**
 * A stable key over the normalized components, used to block candidate matches.
 *
 * Deliberately NOT unique in the database: two suites at one street address are two
 * locations, and a change to this function must not require a data migration.
 */
export function normalizedKey(address: AddressInput): string | undefined {
  const parts = [
    address.line1 === undefined ? '' : normalizeLine(address.line1),
    address.city === undefined ? '' : normalizeLine(address.city),
    (address.regionCode ?? '').toLowerCase().trim(),
    // The five-digit portion only: ZIP+4 differs between sources for one address far
    // more often than it distinguishes two addresses.
    (address.postalCode ?? '').trim().slice(0, 5).toLowerCase(),
    (address.countryCode ?? 'US').toLowerCase(),
  ];
  if (parts[0] === '' && parts[1] === '') return undefined;
  return parts.join('|');
}

/** Compose a raw address from parts, unedited, for a source that supplies no blob. */
export function composeRaw(address: AddressInput): string {
  return [
    address.line1,
    address.line2,
    [address.city, address.regionCode].filter(Boolean).join(', '),
    address.postalCode,
    address.countryCode,
  ]
    .filter((part) => part !== undefined && part !== '')
    .join('\n');
}

export interface CreateLocationInput extends AddressInput {
  readonly latitude?: number | undefined;
  readonly longitude?: number | undefined;
  readonly geocodePrecision?: string | undefined;
}

export async function createLocation(
  uow: UnitOfWork,
  input: CreateLocationInput,
): Promise<string> {
  const raw = input.rawAddress ?? composeRaw(input);
  if (raw.trim() === '') {
    throw new ValidationError(
      'A location needs at least one address component. An empty location would ' +
        'block against everything during matching.',
    );
  }

  const country = (input.countryCode ?? 'US').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new ValidationError(
      `'${country}' is not an ISO 3166-1 alpha-2 country code. The country is never ` +
        `guessed from the postal code shape: 'SW1A 1AA' and '12345' are not evidence ` +
        `a normalizer should act on.`,
    );
  }

  const id = uow.ids.next();
  await sql`
    INSERT INTO party.location
      (id, raw_address, line1, line2, city, region_code, postal_code, country_code,
       normalized_key, normalization_version, latitude, longitude, geocode_precision,
       created_by, updated_by)
    VALUES (${id}, ${raw}, ${input.line1 ?? null}, ${input.line2 ?? null},
            ${input.city ?? null}, ${input.regionCode?.toUpperCase() ?? null},
            ${input.postalCode ?? null}, ${country},
            ${normalizedKey({ ...input, countryCode: country }) ?? null},
            ${NORMALIZATION_VERSION},
            ${input.latitude ?? null}, ${input.longitude ?? null},
            ${input.geocodePrecision ?? null},
            ${uow.context.actor.principalId ?? null}::uuid,
            ${uow.context.actor.principalId ?? null}::uuid)
  `.execute(uow.tx);

  uow.audit({
    schema: 'party',
    table: 'location',
    entityId: id,
    operation: 'INSERT',
    after: { id, raw_address: raw, country_code: country },
  });

  return id;
}
