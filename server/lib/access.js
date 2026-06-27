'use strict';

const crypto = require('crypto');
const db = require('./db');
const mailer = require('./mailer');

const CODE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_PENDING_PER_EMAIL = 1;     // one open request at a time per email

// Friendly code: 12 chars, alphabet excludes 0/O/1/I to avoid transcription errors.
// 12 chars from a 32-char alphabet = 60 bits of entropy — plenty for a one-hour
// single-use code where guessing requires a network request per attempt.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  const bytes = crypto.randomBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  // Format as XXXX-XXXX-XXXX for readability when pasted into the UI.
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function isValidEmail(email) {
  // Deliberately simple — full RFC 5322 is overkill for a gate check.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * User submits a new request. Returns { ok, requestId } or { ok: false, error }.
 * Idempotent-ish: if the same email already has a pending request, we re-use it
 * rather than spam the admin with duplicates.
 */
async function createRequest({ email, reason }) {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }

  const trimmedReason = (reason || '').slice(0, 500).trim() || null;

  const existing = db
    .prepare(`SELECT id FROM access_requests WHERE email = ? AND status = 'pending' LIMIT ?`)
    .get(e, MAX_PENDING_PER_EMAIL);

  let requestId;
  if (existing) {
    requestId = existing.id;
  } else {
    const info = db
      .prepare(
        `INSERT INTO access_requests (email, reason, status, created_at)
         VALUES (?, ?, 'pending', ?)`
      )
      .run(e, trimmedReason, Date.now());
    requestId = info.lastInsertRowid;
  }

  // Fire-and-forget admin notification. Failure here doesn't block the user —
  // the request is already saved and visible in the admin page.
  mailer
    .notifyAdminOfRequest({ email: e, reason: trimmedReason, requestId })
    .catch((err) => console.error('[access] admin notify failed:', err.message));

  return { ok: true, requestId, reused: Boolean(existing) };
}

function listRequests({ status } = {}) {
  if (status) {
    return db
      .prepare(
        `SELECT id, email, reason, status, created_at, reviewed_at
         FROM access_requests
         WHERE status = ?
         ORDER BY created_at DESC`
      )
      .all(status);
  }
  return db
    .prepare(
      `SELECT id, email, reason, status, created_at, reviewed_at
       FROM access_requests
       ORDER BY created_at DESC
       LIMIT 200`
    )
    .all();
}

function getRequest(id) {
  return db.prepare(`SELECT * FROM access_requests WHERE id = ?`).get(id);
}

/**
 * Admin approves a request. Generates a code, stores it, emails the user.
 * Idempotent: approving an already-approved request just re-issues a code
 * (useful if the previous one expired before the user used it).
 */
async function approveRequest({ requestId, reviewerIp }) {
  const reqRow = getRequest(requestId);
  if (!reqRow) return { ok: false, error: 'Request not found.' };
  if (reqRow.status === 'denied') {
    return { ok: false, error: 'This request was already denied. Ask the user to submit a new one.' };
  }

  const code = generateCode();
  const now = Date.now();
  const expiresAt = now + CODE_TTL_MS;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE access_requests
       SET status = 'approved', reviewed_at = ?, reviewer_ip = ?
       WHERE id = ?`
    ).run(now, reviewerIp || null, requestId);

    db.prepare(
      `INSERT INTO access_codes (code, request_id, email, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(code, requestId, reqRow.email, now, expiresAt);
  });
  tx();

  try {
    await mailer.sendAccessCodeToUser({ email: reqRow.email, code, expiresAt });
  } catch (err) {
    // The code is already in the DB, so the operator could still hand it over
    // manually. Surface the error to the admin so they know.
    console.error('[access] code email failed:', err.message);
    return { ok: true, code, expiresAt, emailWarning: err.message };
  }

  return { ok: true, code, expiresAt };
}

async function denyRequest({ requestId, reviewerIp }) {
  const reqRow = getRequest(requestId);
  if (!reqRow) return { ok: false, error: 'Request not found.' };

  db.prepare(
    `UPDATE access_requests
     SET status = 'denied', reviewed_at = ?, reviewer_ip = ?
     WHERE id = ?`
  ).run(Date.now(), reviewerIp || null, requestId);

  // Also invalidate any outstanding codes — defense in depth.
  db.prepare(`DELETE FROM access_codes WHERE request_id = ?`).run(requestId);

  try {
    await mailer.notifyUserOfDenial({ email: reqRow.email });
  } catch (err) {
    console.error('[access] denial email failed:', err.message);
  }

  return { ok: true };
}

/**
 * Validate a code without consuming it. Returns { ok, email, code } on
 * success so the caller can decide when to commit (via consumeCode).
 */
function validateCode(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'Please enter your access code.' };

  const row = db.prepare(`SELECT * FROM access_codes WHERE code = ?`).get(code);
  if (!row) {
    return { ok: false, error: 'That code isn\'t recognized. Check for typos or request a new one.' };
  }
  if (row.used_at) {
    return { ok: false, error: 'That code has already been used. Each code works once — request a new one.' };
  }
  if (Date.now() > row.expires_at) {
    return { ok: false, error: 'That code has expired. Codes are valid for one hour — request a new one.' };
  }
  return { ok: true, email: row.email, code };
}

/**
 * Atomically mark a code as used. Returns { ok } or { ok: false, error }.
 * Idempotent-safe: if two requests race, only one wins.
 */
function consumeCode(code) {
  const result = db
    .prepare(`UPDATE access_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?`)
    .run(Date.now(), code, Date.now());
  if (result.changes !== 1) {
    return { ok: false, error: 'That code is no longer valid (already used or expired).' };
  }
  return { ok: true };
}

/**
 * Convenience: validate + consume in one step, for callers that don't need
 * to do work between the two (e.g. the standalone /api/redeem endpoint).
 */
function redeemCode(rawCode) {
  const v = validateCode(rawCode);
  if (!v.ok) return v;
  const c = consumeCode(v.code);
  if (!c.ok) return c;
  return { ok: true, email: v.email };
}

module.exports = {
  createRequest,
  listRequests,
  getRequest,
  approveRequest,
  denyRequest,
  validateCode,
  consumeCode,
  redeemCode,
  CODE_TTL_MS,
};
