-- =====================================================================
-- PIC2MAP — PostgreSQL schema (Amazon RDS PostgreSQL)
-- =====================================================================
-- Notes:
--  * User identity is owned by Amazon Cognito. We mirror a row per user
--    here keyed by the Cognito "sub" so we can do relational joins,
--    store roles, and own the data model. Cognito groups are the source
--    of truth for roles; `role` here is a synced cache for fast queries.
--  * GPS is stored as numeric lat/lng plus a PostGIS-free bounding-box
--    friendly index. (If PostGIS is enabled you can swap to geography.)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ---------- enums ----------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role     AS ENUM ('USER', 'MODERATOR', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE photo_status  AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE photo_visibility AS ENUM ('PUBLIC', 'PRIVATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE process_state AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- users ----------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub   TEXT UNIQUE NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  role          user_role NOT NULL DEFAULT 'USER',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));
CREATE INDEX IF NOT EXISTS idx_users_role     ON users (role);

-- ---------- albums ---------------------------------------------------
CREATE TABLE IF NOT EXISTS albums (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  visibility    photo_visibility NOT NULL DEFAULT 'PRIVATE',
  cover_photo_id UUID,           -- FK added after photos table exists
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_albums_owner ON albums (owner_id);
CREATE INDEX IF NOT EXISTS idx_albums_name  ON albums (lower(name));

-- ---------- photos ---------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  description   TEXT,

  -- S3 object keys (bucket is configured per-environment)
  s3_key_original  TEXT NOT NULL,
  s3_key_thumb     TEXT,
  s3_key_medium    TEXT,
  s3_key_large     TEXT,

  content_type  TEXT,
  size_bytes    BIGINT,
  width         INTEGER,
  height        INTEGER,

  -- GPS / capture metadata (nullable: image may have no EXIF GPS)
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  captured_at   TIMESTAMPTZ,

  visibility    photo_visibility NOT NULL DEFAULT 'PRIVATE',
  status        photo_status     NOT NULL DEFAULT 'PENDING',
  process_state process_state    NOT NULL DEFAULT 'UPLOADED',
  process_error TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photos_owner      ON photos (owner_id);
CREATE INDEX IF NOT EXISTS idx_photos_visibility ON photos (visibility);
CREATE INDEX IF NOT EXISTS idx_photos_status     ON photos (status);
CREATE INDEX IF NOT EXISTS idx_photos_title      ON photos (lower(title));
CREATE INDEX IF NOT EXISTS idx_photos_captured   ON photos (captured_at);
-- bounding-box search on coordinates
CREATE INDEX IF NOT EXISTS idx_photos_geo        ON photos (latitude, longitude);

-- album cover FK (deferred)
ALTER TABLE albums
  DROP CONSTRAINT IF EXISTS fk_album_cover;
ALTER TABLE albums
  ADD CONSTRAINT fk_album_cover
  FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL;

-- ---------- album <-> photo (many to many) ---------------------------
CREATE TABLE IF NOT EXISTS album_photos (
  album_id  UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  photo_id  UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (album_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_album_photos_photo ON album_photos (photo_id);

-- ---------- moderation log ------------------------------------------
CREATE TABLE IF NOT EXISTS moderation_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id     UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  moderator_id UUID NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL,            -- APPROVE | REJECT | DELETE
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_modlog_photo ON moderation_actions (photo_id);

-- ---------- audit / activity (admin statistics feed) -----------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);

-- ---------- updated_at trigger --------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','albums','photos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON %1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- ---------- statistics view (used by admin dashboard) ----------------
CREATE OR REPLACE VIEW v_system_stats AS
SELECT
  (SELECT count(*) FROM users)                                AS total_users,
  (SELECT count(*) FROM users WHERE role = 'MODERATOR')       AS total_moderators,
  (SELECT count(*) FROM users WHERE role = 'ADMIN')           AS total_admins,
  (SELECT count(*) FROM photos)                               AS total_photos,
  (SELECT count(*) FROM photos WHERE visibility = 'PUBLIC')   AS public_photos,
  (SELECT count(*) FROM photos WHERE status = 'PENDING')      AS pending_photos,
  (SELECT count(*) FROM photos WHERE latitude IS NOT NULL)    AS geotagged_photos,
  (SELECT count(*) FROM albums)                               AS total_albums,
  (SELECT coalesce(sum(size_bytes),0) FROM photos)            AS total_storage_bytes;
