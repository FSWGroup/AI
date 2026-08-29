# ADR-0023: Prophet 21 enters through a file-based adapter behind a source-neutral contract

- Status: Accepted (provisional) — depends on unanswered questions C1–C3
- Date: 2026-08-29

## Context

FSW runs current cloud-hosted Epicor Prophet 21 and **has no API access available to this
project**. The specification forbids assuming an API, fabricating endpoints, screen
scraping, and any dependence of the canonical model on P21's schema or extraction
mechanism.

What can actually be extracted is unknown (question C1) and is the longest-lead unknown
in the programme.

## Decision

### Build the adapter, not the assumption

The P21 connector implements the ADR-0022 connector interface over a **file drop**:
delimited or Excel exports arriving in a watched location (local directory in
development, S3-compatible object storage in production, with SFTP as a supported
landing mechanism). The connector does not care how the files got there — scheduled
Epicor report delivery, a manual export by a named person on a schedule, or a future
managed extract. A human-in-the-loop extraction is an acceptable v1 mechanism (C2) and
changes only freshness guarantees, not architecture.

**The canonical model has no knowledge of P21.** No P21 table names, no P21 column names,
and no `p21_*` columns exist outside the `ingest` schema. When an API becomes available,
we replace `discover`/`fetch`/`parse` and keep `map`, the canonical model, and every
downstream consumer.

### File handling requirements, all mandatory

- **Checksum-keyed files.** A file's `sha256` identifies it. Re-presenting the same file
  is recognised and produces no duplicate business facts (AC14). The original file is
  preserved in object storage, immutably, with a durable reference.
- **Header-name parsing against an approved fingerprint.** Never positional. An
  unapproved structure halts the run and quarantines the file (AC15).
- **Explicit encoding and locale handling.** Files are read with a declared encoding
  (default `windows-1252`, which is what Epicor exports commonly are, overridable per
  connector); a BOM is honoured; decoding failures quarantine rather than substitute
  replacement characters.
- **Explicit null semantics.** Empty string, `NULL`, `N/A`, and `0` are distinguished per
  column by the mapping, because P21 exports conflate them and the canonical meaning
  differs.
- **Time zones.** Source timestamps without offsets are interpreted in a declared source
  time zone (`America/New_York`) and stored as `timestamptz`. The declared zone is part of
  the mapping version.
- **Duplicate rows and stable source keys.** Rows are keyed by the declared business key;
  a duplicate key within one file is a quarantine event, not a last-one-wins overwrite.
- **Deletion detection.** If P21 exports do not carry a status flag (question C7),
  disappearance from a full snapshot marks `deleted_in_source_at` — never a hard delete.
- **Late, partial, and corrupt files.** A truncated or unparseable file fails the run
  atomically; nothing is half-imported.
- **Multi-file consistency.** Related files from one extraction form a manifest and are
  processed as a unit, so ship-tos are never loaded against customers from a different
  extraction.

### Anti-corruption mappings

Recorded explicitly, versioned, and tested:

- a P21 **customer** is a `party.commercial_account`, and *proposes* an organization
- a P21 **ship-to** is a `party.ship_to` over a `party.location`, and **is not a site**
  unless separately evidenced
- a P21 **item** proposes a `pim.variant` with identifiers, not a product hierarchy

### Write-back

**None.** Layer 0 does not write to P21 in v1 (ADR-0033). Any Layer-0-authored field that
P21 also stores will diverge in P21, and that is an accepted, documented consequence of
question B3.

## Alternatives considered

- **Wait for API access before building.** Rejected: it blocks the whole Account Master
  programme on a third-party commercial decision.
- **Direct database or ODBC access to the cloud instance.** Not available, and
  unsupported access is forbidden by §80.
- **Model canonical tables on P21's schema to ease mapping.** Explicitly forbidden, and
  it is how a spine becomes "another copy of P21".

## Consequences

- Freshness is bounded by extraction frequency, which must be published to consumers as
  an explicit staleness guarantee rather than implied.
- The mapping is where the domain judgement lives, and it is the artefact most likely to
  need revision once real files are seen.

## Risks

The largest risk is that the mapping is written against fixture files that do not
represent production. Mitigated by treating the first real extract as a discovery
exercise with the mapping explicitly provisional and every mapped record reviewable.

## Reversal cost

Low — that is the entire point of the adapter boundary, and acceptance criterion 26
tests it.

## Revisit if

Any supported API or managed extract becomes available (question C1).
