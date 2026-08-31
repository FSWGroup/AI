/**
 * The mandatory scope predicate (ADR-0019).
 *
 * Function-level permission is never sufficient. Holding `account.read` says nothing
 * about WHICH accounts, and a system that checks the permission and then runs an
 * unfiltered query is a system where every reader sees everything — with a permission
 * check on top that makes it look otherwise.
 *
 * So a scoped read does not merely refuse an out-of-scope row. It does not return it.
 * The difference matters: a refusal still tells the caller the row exists, and "403 on
 * this identifier, 404 on that one" is an enumeration oracle.
 *
 * The predicate is produced here and applied by the caller, deliberately as a value
 * rather than by convention. A query that forgot it is then visibly different from one
 * that did not, which is what lets `tests/architecture/scoped-reads.test.ts` tell them
 * apart.
 */
import { sql, type RawBuilder } from 'kysely';
import type { ScopeFilter } from './authorization.js';

/**
 * A SQL predicate restricting rows to what this principal may see.
 *
 * `column` names the operating-company column on the table being read, qualified where
 * the query has more than one table in scope. It is validated rather than escaped: a
 * scope predicate built from an unvalidated identifier would be a hole in exactly the
 * control it exists to be.
 */
export function operatingCompanyPredicate(
  filter: ScopeFilter,
  column: string,
): RawBuilder<boolean> {
  if (!/^[a-z][a-z0-9_]{0,62}(\.[a-z][a-z0-9_]{0,62})?$/.test(column)) {
    throw new Error(
      `Refusing '${column}' as a scope column. It must be a plain identifier, ` +
        `optionally table-qualified.`,
    );
  }

  switch (filter.kind) {
    case 'all':
      return sql<boolean>`true`;
    case 'none':
      // No rows, rather than an error. "You have no accounts" is a legitimate state:
      // a new joiner with no roles yet should see an empty list, not a failure.
      return sql<boolean>`false`;
    case 'companies':
      return sql<boolean>`${sql.raw(column)} = ANY(${[...filter.operatingCompanies]}::text[])`;
  }
}

/**
 * The same predicate, for a table whose company is nullable.
 *
 * A null operating company means group-wide data — an organization's identity, a
 * manufacturer — which everyone with the permission may see. This is assumption A-021
 * and open question I6: after entity resolution merges a ValveMan customer with a
 * Welsford customer, organization identity and sites are visible group-wide while
 * commercial accounts, ship-tos and role assignments stay within their owning company.
 *
 * That rule is provisional and it is the kind of thing a business decides rather than
 * an architect. It is implemented in one place so that changing it is one change.
 */
export function operatingCompanyOrGroupPredicate(
  filter: ScopeFilter,
  column: string,
): RawBuilder<boolean> {
  if (filter.kind === 'all') return sql<boolean>`true`;
  if (filter.kind === 'none') return sql<boolean>`false`;
  if (!/^[a-z][a-z0-9_]{0,62}(\.[a-z][a-z0-9_]{0,62})?$/.test(column)) {
    throw new Error(`Refusing '${column}' as a scope column.`);
  }
  return sql<boolean>`(${sql.raw(column)} IS NULL OR ${sql.raw(column)} = ANY(${[
    ...filter.operatingCompanies,
  ]}::text[]))`;
}

/**
 * Whether a principal may see one specific row's company.
 *
 * For the single-row read, where a predicate would be overkill. Returns false rather
 * than throwing, so the caller can decide between 404 and an empty result — and should
 * choose 404, because "it exists but you cannot have it" is information.
 */
export function withinScope(
  filter: ScopeFilter,
  operatingCompany: string | null,
): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'none':
      return false;
    case 'companies':
      return operatingCompany === null
        ? true
        : filter.operatingCompanies.includes(operatingCompany);
  }
}
