-- Customer accounts and login sessions for the GOAXIS portal.
CREATE TABLE IF NOT EXISTS Users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER,
  role TEXT NOT NULL CHECK (role IN ('customer', 'admin')),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON Sessions(expires_at);

CREATE TABLE IF NOT EXISTS LoginAttempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON LoginAttempts(ip, created_at);

ALTER TABLE Leads ADD COLUMN admin_note TEXT;
