# ADR-0026: Binaries live in S3-compatible object storage behind a provider interface

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§39 requires product images, datasheets, IOM manuals, CAD/STEP files, drawings, and
certificates, with metadata in the database and binaries out of it. §8 and ADR-0023
additionally require durable, immutable preservation of every landed source file. §71
requires local development to work from a clean clone with no cloud account.

## Decision

- **Binaries are never stored in PostgreSQL.** No `bytea` columns for documents.
- Access goes through a narrow `ObjectStore` interface: `put`, `get`, `head`, `delete`,
  `presignGet`, `presignPut`, `list`. Two implementations: a local filesystem store for
  development and tests, and an S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2,
  MinIO) for real environments. The interface is deliberately the intersection of what
  every S3-compatible provider supports.
- **Content-addressed keys**: `<bucket>/<kind>/<sha256[0:2]>/<sha256>`. Identical content
  is stored once; a re-uploaded file is recognised, which is the same property that makes
  P21 file re-ingestion idempotent.
- Database metadata (`pim.asset`, `ingest.landed_file`) holds the object reference,
  filename, content type, size, `sha256`, source, revision, effective dates, access
  level, document type, and entity associations.
- **Replacing a document never overwrites**: a new revision is a new object and a new
  `pim.asset_revision` row. The prior revision remains retrievable, because a
  certificate that was valid in 2027 is evidence even after it is superseded.
- **Delivery is by short-lived presigned URL**, authorized by Layer 0 first. Buckets are
  private; there is no public bucket. Confidential assets (customer-specific certificates,
  internal drawings) carry an access level checked before any URL is minted.
- Uploads are validated: declared content type verified against magic bytes, size capped
  per document type, and filenames never used as storage keys.
- Object storage is **versioned and lifecycle-managed** at the bucket level, and is part
  of the backup plan (ADR-0030) — a database restore without its objects is not a restore.

## Alternatives considered

- **`bytea` in PostgreSQL.** Rejected by §39, and it would wreck backup and restore times.
- **PostgreSQL large objects.** Same problems plus awkward APIs.
- **A DAM product.** Premature; the interface leaves the door open.
- **Cloud-native SDK used directly.** Rejected: couples Layer 0 to one provider and makes
  local development require a cloud account.

## Consequences

- Local development and CI need no cloud credentials.
- Deleting an asset is a metadata operation; object deletion is a separate, deliberate
  lifecycle job, so a mistaken delete is recoverable.

## Risks

Orphaned objects if metadata is deleted without lifecycle cleanup. Mitigated by a
reconciliation job reporting objects with no referencing row and rows with no object.

## Reversal cost

Low.

## Revisit if

Asset volume, CDN needs, or image derivative generation justifies a purpose-built DAM.
