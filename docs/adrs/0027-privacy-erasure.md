# ADR-0027: Erasure is anonymization plus crypto-shredding, never deletion

- Status: Accepted (provisional)
- Date: 2026-08-29
- Resolves: conflict item 4

## Context

§15 forbids hard deletion of business entities but insists that "never hard delete" must
not override legal obligations. §13 requires non-mutable audit, §17 a permanently
replayable ledger, §8 unmutated raw source payloads with checksums. A lawful erasure
request touches all four plus every backup. Whether FSW has EU/UK data subjects is
unanswered (question K1); California residents are near-certain.

## Decision

Erasure is a **privileged, audited, reason-bearing operation** (`pii.erase`) that does
four different things to four different classes of storage:

1. **Canonical records.** `party.person` and its candidate values are *anonymized in
   place*: name fields become `[erased]`, email and phone are nulled, and
   `erased_at`/`erased_by`/`erasure_reason` are set. The row and its ID survive, so every
   foreign key, affiliation history, and non-PII operational fact stays intact. A contact
   who was the buyer on a 2024 order remains the buyer; they are simply no longer named.
2. **Domain events.** Nothing to do — payloads never contained PII (ADR-0009). This is
   the entire reason for that constraint, and it is what makes the ledger's immutability
   defensible.
3. **Raw source payloads.** `ingest.source_record.payload` and
   `source_record_version.payload` genuinely contain PII and cannot be emptied without
   destroying lineage and checksums. They are therefore **encrypted per data subject**
   (AES-256-GCM, one data key per subject, wrapped by a master key in the secret store).
   Erasure destroys the subject's data key. The ciphertext, its length, and its checksum
   remain — so run manifests still reconcile — and the plaintext is unrecoverable. This
   is crypto-shredding, and it is the standard answer to immutable-store erasure.
4. **Audit `before`/`after`.** PII-classified fields are replaced with `[erased]` by the
   *maintenance* role (ADR-0021), in a single transaction that writes its own audit entry
   recording that an erasure occurred, by whom, and why. The audit trail records that the
   record was erased; it does not preserve what was erased.

**Backups are the residual gap.** PITR windows and backup archives will contain the
pre-erasure state until they age out. This is unavoidable for any system with backups.
The retention window is documented, is bounded (provisionally 35 days), and is disclosed
in the erasure runbook and privacy documentation. Erasure is re-applied if a restore
occurs, tracked by an `erasure_request` ledger that survives restore.

An **erasure request register** (`party.erasure_request`) records the subject, requester,
legal basis, decision, executor, execution timestamp, and the scope of what was erased.

Organizations are **not** erasable — a company is not a data subject. Only natural
persons and the personal data attached to them.

## Alternatives considered

- **Hard delete the person row.** Rejected: breaks referential integrity and destroys
  non-PII operational history that FSW is entitled and often obliged to keep.
- **Rewrite the ledger.** Rejected: destroys the immutability guarantee for everyone, to
  serve one request.
- **Encrypt all PII everywhere, always.** Attractive but heavy: it would make canonical
  name search impossible without a searchable-encryption scheme. Applied to raw payloads
  only, where the data is not queried operationally.
- **Do nothing until legally compelled.** Rejected: the design decisions that make
  erasure possible (no PII in events, encrypted raw payloads) must be made now or not at
  all.

## Consequences

- Raw payload encryption adds cost to ingestion and makes ad-hoc SQL inspection of raw
  payloads require a decryption step. Accepted; a tooling command provides it under
  permission and audit.
- Only payloads from sources flagged as PII-bearing are encrypted, so product and
  catalogue ingestion is unaffected.

## Risks

Key-management failure would make raw payloads permanently unreadable. Mitigated by the
master key living in the platform secret store with its own backup and rotation runbook,
and by the fact that raw payloads are recoverable from the preserved original source
files for file-based connectors.

## Reversal cost

Moderate — the encryption boundary is at ingestion write time.

## Revisit if

Legal advice establishes different obligations, or a regulator requires shorter backup
retention.
