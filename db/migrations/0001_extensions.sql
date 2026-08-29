-- Extensions Layer 0 depends on. All are contrib modules shipped with PostgreSQL.
--
--   pgcrypto      gen_random_bytes for UUIDv7 (ADR-0004) and payload encryption (ADR-0027)
--   pg_trgm       trigram similarity for entity resolution (ADR-0025) and text search
--   btree_gist    exclusion constraints combining equality with range overlap (ADR-0018)
--   btree_gin     composite GIN indexes on the facet projection (ADR-0014)
--   citext        case-insensitive natural keys (email hints, vocabulary aliases)
--   unaccent      name normalization for matching
--   fuzzystrmatch Double Metaphone phonetic matching (ADR-0025)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
