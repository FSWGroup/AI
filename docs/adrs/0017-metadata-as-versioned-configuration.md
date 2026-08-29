# ADR-0017: Attributes, product types, vocabularies, and rules are version-controlled configuration

- Status: Accepted (provisional — this one needs explicit owner confirmation, see open question J1)
- Date: 2026-08-29

## Context

Acceptance criterion 3 requires creating a previously unknown product type and new
attributes with "no source-code change, no manually written database migration". There
are two ways to satisfy that, and they produce materially different systems.

## Decision

Metadata is authored as **declarative YAML files in `config/metadata/`**, validated
against a schema, and applied by an idempotent loader (`npm run metadata:apply`) that
diffs desired state against the database and writes metadata rows.

```
config/metadata/
  units.yaml
  vocabularies/materials.yaml
  vocabularies/nominal-size.yaml
  vocabularies/pressure-class.yaml
  attributes/valve-common.yaml
  product-types/ball-valve.yaml
  quality-rules/valveman-publishable.yaml
  survivorship/organization.yaml
```

This satisfies AC3 exactly as written — **no application code changes and no database
migration** — while giving metadata changes the properties that matter for a system of
record: diffable review, pull-request approval, automated validation before apply, a
complete history, and one-command revert.

The loader:

- validates every file against its TypeBox schema before touching the database;
- refuses changes that would be destructive to existing data (narrowing a value type,
  removing an attribute that has values, deleting a vocabulary term in use) unless run
  with an explicit `--allow-breaking` flag _and_ a migration plan;
- deprecates rather than deletes;
- is idempotent — applying the same configuration twice changes nothing;
- runs in CI against a scratch database on every pull request touching `config/`;
- records `metadata_version` and the applying actor, so every attribute value can be
  traced to the metadata version in force when it was written.

A **read-only admin UI** exposes the current metadata. Editing is by pull request.

## Alternatives considered

- **Runtime editing through an admin UI/API by a non-engineer.** This is the other
  legitimate reading of AC3. Rejected for v1 because: metadata changes are schema-shaped
  changes to the meaning of every existing value; an unreviewed production edit that
  narrows an attribute's type or deletes a vocabulary term is a data-loss event; and
  there is no plausible v1 user who needs to define a new engineering attribute without
  an engineer present. The UI can be added later on top of the same loader — the loader,
  not the file format, is the real interface.
- **Metadata as SQL migrations.** Rejected: violates AC3 directly.
- **Metadata as code (TypeScript constants).** Rejected: violates "no source-code change"
  and couples metadata releases to application releases.

## Consequences

- Adding a product type is a pull request, reviewable by an engineer, deployable
  independently of application code.
- **This is the one decision most likely to be wrong about intent**, which is why it is
  flagged for explicit confirmation (open question J1). If the owner intends non-engineers
  to define product types at runtime, this ADR changes and the work grows materially.

## Risks

Metadata drift between environments if the loader is not run. Mitigated by running it as
part of deployment and by a startup check that fails if the database metadata version
lags the repository.

## Reversal cost

Low. Adding a runtime editing API later writes to the same tables through the same
validation.

## Revisit if

The owner confirms that runtime, non-engineer authorship is required (J1), or metadata
change volume makes pull requests a bottleneck.
