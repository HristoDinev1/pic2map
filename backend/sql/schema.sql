-- =====================================================================
-- PIC2MAP — MySQL / MariaDB schema
-- =====================================================================
-- Notes:
--  * User identity is owned by Amazon Cognito. We mirror a row per user
--    here keyed by the Cognito "sub" so we can do relational joins,
--    store roles, and own the data model. Cognito groups are the source
--    of truth for roles; `role` here is a synced cache for fast queries.
--  * Primary keys are CHAR(36) UUID strings generated in PHP (UUID v4),
--    so the schema needs no vendor-specific UUID functions.
--  * Default charset/collation is utf8mb4 with a case-insensitive
--    collation so `username`/`title` lookups behave like the original
--    case-insensitive (lower(...)) Postgres indexes.
-- =====================================================================

SET NAMES utf8mb4;

-- ---------- users ----------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  cognito_sub   VARCHAR(64)  NOT NULL UNIQUE,
  username      VARCHAR(190) NOT NULL UNIQUE,
  email         VARCHAR(190) NOT NULL UNIQUE,
  role          ENUM('USER','MODERATOR','ADMIN') NOT NULL DEFAULT 'USER',
  -- Local auth driver only (NULL for Cognito-managed accounts)
  password_hash VARCHAR(255),
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------- albums ---------------------------------------------------
CREATE TABLE IF NOT EXISTS albums (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  owner_id      CHAR(36)     NOT NULL,
  name          VARCHAR(120) NOT NULL,
  description   TEXT,
  visibility    ENUM('PUBLIC','PRIVATE') NOT NULL DEFAULT 'PRIVATE',
  cover_photo_id CHAR(36),
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_albums_owner (owner_id),
  KEY idx_albums_name (name),
  CONSTRAINT fk_albums_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------- photos ----------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  owner_id      CHAR(36)     NOT NULL,
  title         VARCHAR(200) NOT NULL DEFAULT 'Untitled',
  description   TEXT,

  -- S3 object keys (bucket is configured per-environment)
  s3_key_original  VARCHAR(500) NOT NULL,
  s3_key_thumb     VARCHAR(500),
  s3_key_medium    VARCHAR(500),
  s3_key_large     VARCHAR(500),

  content_type  VARCHAR(100),
  size_bytes    BIGINT,
  width         INT,
  height        INT,

  -- GPS / capture metadata (nullable: image may have no EXIF GPS)
  latitude      DOUBLE,
  longitude     DOUBLE,
  captured_at   DATETIME,

  visibility    ENUM('PUBLIC','PRIVATE') NOT NULL DEFAULT 'PRIVATE',
  status        ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  process_state ENUM('UPLOADED','PROCESSING','READY','FAILED') NOT NULL DEFAULT 'UPLOADED',
  process_error TEXT,

  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_photos_owner (owner_id),
  KEY idx_photos_visibility (visibility),
  KEY idx_photos_status (status),
  KEY idx_photos_title (title),
  KEY idx_photos_captured (captured_at),
  KEY idx_photos_geo (latitude, longitude),
  CONSTRAINT fk_photos_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- album cover FK (deferred: photos table must exist first)
ALTER TABLE albums
  ADD CONSTRAINT fk_album_cover
  FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL;

-- ---------- album <-> photo (many to many) ----------------------------
CREATE TABLE IF NOT EXISTS album_photos (
  album_id  CHAR(36) NOT NULL,
  photo_id  CHAR(36) NOT NULL,
  added_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (album_id, photo_id),
  KEY idx_album_photos_photo (photo_id),
  CONSTRAINT fk_ap_album FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  CONSTRAINT fk_ap_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------- moderation log --------------------------------------------
CREATE TABLE IF NOT EXISTS moderation_actions (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  photo_id     CHAR(36) NOT NULL,
  moderator_id CHAR(36) NOT NULL,
  action       VARCHAR(20) NOT NULL,           -- APPROVE | REJECT | DELETE
  reason       TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_modlog_photo (photo_id),
  CONSTRAINT fk_modlog_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  CONSTRAINT fk_modlog_moderator FOREIGN KEY (moderator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------- audit / activity (admin statistics feed) ------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id    CHAR(36),
  action      VARCHAR(40) NOT NULL,
  entity      VARCHAR(40),
  entity_id   VARCHAR(64),
  meta        JSON,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_created (created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------- statistics view (used by admin dashboard) -----------------
CREATE OR REPLACE VIEW v_system_stats AS
SELECT
  (SELECT COUNT(*) FROM users)                              AS total_users,
  (SELECT COUNT(*) FROM users WHERE role = 'MODERATOR')     AS total_moderators,
  (SELECT COUNT(*) FROM users WHERE role = 'ADMIN')         AS total_admins,
  (SELECT COUNT(*) FROM photos)                             AS total_photos,
  (SELECT COUNT(*) FROM photos WHERE visibility = 'PUBLIC') AS public_photos,
  (SELECT COUNT(*) FROM photos WHERE status = 'PENDING')    AS pending_photos,
  (SELECT COUNT(*) FROM photos WHERE latitude IS NOT NULL)  AS geotagged_photos,
  (SELECT COUNT(*) FROM albums)                             AS total_albums,
  (SELECT COALESCE(SUM(size_bytes), 0) FROM photos)         AS total_storage_bytes;
