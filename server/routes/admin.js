'use strict';

const express = require('express');
const crypto = require('crypto');
const access = require('../lib/access');

const router = express.Router();

const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASS = process.env.ADMIN_PASS || '';

function constantTimeEquals(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_USER || !ADMIN_PASS) {
    return res.status(503).json({
      error: 'Admin login isn\'t configured on the server. Set ADMIN_USER and ADMIN_PASS in .env.',
    });
  }

  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Docket admin", charset="UTF-8"');
    return res.status(401).send('Authentication required.');
  }

  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    res.setHeader('WWW-Authenticate', 'Basic realm="Docket admin", charset="UTF-8"');
    return res.status(401).send('Authentication required.');
  }

  const idx = decoded.indexOf(':');
  if (idx === -1) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Docket admin", charset="UTF-8"');
    return res.status(401).send('Authentication required.');
  }
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);

  if (!constantTimeEquals(user, ADMIN_USER) || !constantTimeEquals(pass, ADMIN_PASS)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Docket admin", charset="UTF-8"');
    return res.status(401).send('Authentication required.');
  }
  next();
}

router.use(requireAdmin);

// ---- HTML admin page ----

router.get('/', (req, res) => {
  // Single self-contained page. Lives at /admin, behind basic auth, no
  // separate asset routes needed.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(ADMIN_PAGE_HTML);
});

// ---- JSON API the admin page calls ----

router.get('/requests', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const allowedStatuses = new Set(['pending', 'approved', 'denied']);
  const filtered = status && allowedStatuses.has(status) ? status : undefined;
  return res.json({ requests: access.listRequests({ status: filtered }) });
});

router.post('/requests/:id/approve', express.json(), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid request id.' });
  const result = await access.approveRequest({ requestId: id, reviewerIp: req.ip });
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json(result);
});

router.post('/requests/:id/deny', express.json(), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid request id.' });
  const result = await access.denyRequest({ requestId: id, reviewerIp: req.ip });
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json(result);
});

// Inline so we don't need a separate static path under basic auth.
// Same visual language as the main app (paper white, near-black ink,
// monospace metadata, single-action rows).
const ADMIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Docket — admin</title>
<style>
  :root {
    --paper: #FFFFFF;
    --paper-deep: #F0F0F0;
    --ink: #111111;
    --ink-soft: #5C5C5C;
    --rule: #CFCFCF;
    --pencil: #000000;
    --pencil-soft: #E2E2E2;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    min-height: 100vh;
  }
  header {
    padding: 28px 40px 12px;
    border-bottom: 1px solid var(--rule);
    display: flex; align-items: baseline; justify-content: space-between;
  }
  h1 { margin: 0; font-size: 1.4rem; font-weight: 600; letter-spacing: -0.01em; }
  .note { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.72rem; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.04em; }
  main { padding: 32px 40px 80px; max-width: 900px; margin: 0 auto; }
  .tabs { display: flex; gap: 4px; margin-bottom: 24px; border-bottom: 1px solid var(--rule); }
  .tab { padding: 10px 16px; background: none; border: none; cursor: pointer; font-size: 0.92rem; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tab.active { color: var(--ink); border-bottom-color: var(--ink); font-weight: 600; }
  .empty { padding: 60px 20px; text-align: center; color: var(--ink-soft); }
  .row { display: flex; align-items: flex-start; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--rule); }
  .row-main { flex: 1; min-width: 0; }
  .row-email { font-weight: 600; font-size: 1rem; }
  .row-reason { color: var(--ink-soft); font-size: 0.9rem; margin-top: 4px; white-space: pre-wrap; word-wrap: break-word; }
  .row-meta { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.72rem; color: var(--ink-soft); margin-top: 6px; }
  .row-actions { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
  button.action {
    padding: 8px 16px; border-radius: 3px; font-size: 0.88rem; font-weight: 600; cursor: pointer;
    border: 1px solid var(--rule); background: var(--paper); color: var(--ink);
  }
  button.action.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  button.action.danger  { color: var(--ink); }
  button.action:hover:not(:disabled) { border-color: var(--ink); }
  button.action.primary:hover:not(:disabled) { background: #000; }
  button.action:disabled { opacity: 0.5; cursor: not-allowed; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 2px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.65rem; letter-spacing: 0.05em; text-transform: uppercase; }
  .badge.approved { background: var(--pencil-soft); }
  .badge.denied   { background: var(--paper-deep); color: var(--ink-soft); }
  .badge.pending  { background: var(--ink); color: var(--paper); }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--paper); padding: 12px 18px; border-radius: 3px; font-size: 0.9rem; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; transition: opacity 0.2s ease; pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
  <header>
    <h1>Docket — admin</h1>
    <div class="note">access requests</div>
  </header>
  <main>
    <div class="tabs">
      <button class="tab active" data-status="pending">Pending</button>
      <button class="tab" data-status="approved">Approved</button>
      <button class="tab" data-status="denied">Denied</button>
    </div>
    <div id="list"><div class="empty">Loading…</div></div>
  </main>
  <div id="toast" class="toast"></div>
<script>
(() => {
  const listEl = document.getElementById('list');
  const toastEl = document.getElementById('toast');
  let currentStatus = 'pending';

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  function fmtDate(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleString();
  }

  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function load() {
    listEl.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const res = await fetch('/admin/requests?status=' + encodeURIComponent(currentStatus));
      const data = await res.json();
      const items = data.requests || [];
      if (items.length === 0) {
        listEl.innerHTML = '<div class="empty">No ' + currentStatus + ' requests.</div>';
        return;
      }
      listEl.innerHTML = items.map(renderRow).join('');
      wireRowActions();
    } catch (err) {
      listEl.innerHTML = '<div class="empty">Could not load requests: ' + escape(err.message) + '</div>';
    }
  }

  function renderRow(r) {
    const reason = r.reason ? '<div class="row-reason">' + escape(r.reason) + '</div>' : '';
    const reviewed = r.reviewed_at ? ' · reviewed ' + escape(fmtDate(r.reviewed_at)) : '';
    const actions = r.status === 'pending'
      ? '<button class="action primary" data-act="approve" data-id="' + r.id + '">Approve</button>' +
        '<button class="action danger"  data-act="deny"    data-id="' + r.id + '">Deny</button>'
      : '<span class="badge ' + escape(r.status) + '">' + escape(r.status) + '</span>';
    return '<div class="row">' +
      '<div class="row-main">' +
        '<div class="row-email">' + escape(r.email) + '</div>' +
        reason +
        '<div class="row-meta">#' + r.id + ' · requested ' + escape(fmtDate(r.created_at)) + reviewed + '</div>' +
      '</div>' +
      '<div class="row-actions">' + actions + '</div>' +
    '</div>';
  }

  function wireRowActions() {
    listEl.querySelectorAll('button.action').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        const verb = act === 'approve' ? 'approve' : 'deny';
        if (!confirm('Are you sure you want to ' + verb + ' request #' + id + '?')) return;

        // Disable both buttons in the row while the call is in flight.
        btn.closest('.row-actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          const res = await fetch('/admin/requests/' + id + '/' + act, { method: 'POST' });
          const data = await res.json();
          if (!res.ok) {
            toast(data.error || 'Action failed.');
            btn.closest('.row-actions').querySelectorAll('button').forEach((b) => (b.disabled = false));
            return;
          }
          if (act === 'approve') {
            const warn = data.emailWarning ? ' (email failed: ' + data.emailWarning + ')' : '';
            toast('Approved. Code emailed to user.' + warn);
          } else {
            toast('Request denied.');
          }
          load();
        } catch (err) {
          toast('Network error: ' + err.message);
          btn.closest('.row-actions').querySelectorAll('button').forEach((b) => (b.disabled = false));
        }
      });
    });
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentStatus = tab.dataset.status;
      load();
    });
  });

  load();
})();
</script>
</body>
</html>
`;

module.exports = router;
