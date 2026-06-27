'use strict';

const express = require('express');
const access = require('../lib/access');

const router = express.Router();

router.post('/request-access', express.json(), async (req, res) => {
  try {
    const result = await access.createRequest({
      email: req.body?.email,
      reason: req.body?.reason,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({
      ok: true,
      message: result.reused
        ? 'You already have a pending request — we\'ll email you the code as soon as it\'s reviewed.'
        : 'Request submitted. You\'ll receive an email with an access code once it\'s reviewed.',
    });
  } catch (err) {
    console.error('[access] request failed:', err);
    return res.status(500).json({ error: 'Could not submit your request. Try again in a moment.' });
  }
});

router.post('/redeem', express.json(), (req, res) => {
  const result = access.redeemCode(req.body?.code);
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ ok: true, email: result.email });
});

module.exports = router;
