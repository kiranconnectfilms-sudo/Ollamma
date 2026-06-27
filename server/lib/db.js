'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'docket.db');

// Ensure the parent dir exists — first-run convenience so the operator
// doesn't have to mkdir manually.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS access_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT NOT NULL,
    reason       TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'denied'
    created_at   INTEGER NOT NULL,
    reviewed_at  INTEGER,
    reviewer_ip  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
  CREATE INDEX IF NOT EXISTS idx_access_requests_email  ON access_requests(email);

  CREATE TABLE IF NOT EXISTS access_codes (
    code         TEXT PRIMARY KEY,                 -- the random one-time code
    request_id   INTEGER NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    issued_at    INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,                 -- issued_at + 1 hour
    used_at      INTEGER                            -- null = unused, set on first successful use
  );

  CREATE INDEX IF NOT EXISTS idx_access_codes_email ON access_codes(email);
`);

module.exports = db;
