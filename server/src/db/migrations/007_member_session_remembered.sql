ALTER TABLE member_sessions
ADD COLUMN remembered INTEGER NOT NULL DEFAULT 0 CHECK (remembered IN (0, 1));
