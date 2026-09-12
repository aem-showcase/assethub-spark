-- Smart Collections: persisted dynamic search queries (query + sort + facetFilters).
-- Distinct from the unrelated "Collections" feature (Dynamic Media asset collections).
CREATE TABLE IF NOT EXISTS smart_collections (
  id          TEXT    PRIMARY KEY,              -- crypto.randomUUID()
  user_id     TEXT    NOT NULL,                  -- owner: Entra sub (stable pseudonymous), matches audit_events.user_id
  user_email  TEXT    NOT NULL,                  -- owner email, for display/debugging
  title       TEXT    NOT NULL,
  description TEXT,
  criteria    TEXT    NOT NULL,                  -- serialized JSON: { query, sortType, sortDirection, facetFilters }
  visibility  TEXT    NOT NULL DEFAULT 'private'  -- private | organization (deployment-wide; single tenant per Worker)
              CHECK(visibility IN ('private', 'organization')),
  created_at  TEXT    NOT NULL,                  -- ISO 8601 UTC
  updated_at  TEXT    NOT NULL                    -- ISO 8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_sc_user ON smart_collections(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_org  ON smart_collections(visibility, updated_at DESC);
