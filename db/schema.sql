-- ZZ Registry Database Schema (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_login TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS packages (
  name TEXT PRIMARY KEY,
  latest TEXT NOT NULL,
  author TEXT NOT NULL,
  repo TEXT,
  description TEXT,
  license TEXT DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS versions (
  pkg TEXT NOT NULL,
  version TEXT NOT NULL,
  tarball_key TEXT NOT NULL,
  tarball_sha256 TEXT DEFAULT '',
  readme_key TEXT,
  deps TEXT DEFAULT '{}',
  license TEXT DEFAULT '',
  published_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (pkg, version),
  FOREIGN KEY (pkg) REFERENCES packages(name)
);

-- Migrations for databases created before license/hash tracking:
-- (safe to re-run; duplicate-column errors can be ignored)
-- ALTER TABLE packages ADD COLUMN license TEXT DEFAULT '';
-- ALTER TABLE versions ADD COLUMN tarball_sha256 TEXT DEFAULT '';
-- ALTER TABLE versions ADD COLUMN license TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pkg_search ON packages(name, description);
CREATE INDEX IF NOT EXISTS idx_versions_pkg ON versions(pkg);
