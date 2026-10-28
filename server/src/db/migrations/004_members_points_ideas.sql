CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'administrator')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  privacy_consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE member_sessions (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ideas (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  moderation_note TEXT NOT NULL DEFAULT '',
  moderated_by INTEGER REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE reservations
ADD COLUMN member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;

CREATE INDEX member_sessions_member_expiry_idx ON member_sessions (member_id, expires_at);
CREATE INDEX ideas_status_created_idx ON ideas (status, created_at DESC);
CREATE INDEX reservations_member_status_idx ON reservations (member_id, status);
