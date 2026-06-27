'use strict';

const nodemailer = require('nodemailer');

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || SMTP_USER;
const APP_NAME = process.env.APP_NAME || 'Docket';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

let transporter = null;
let configReason = null;

if (!SMTP_USER || !SMTP_PASS) {
  configReason = 'SMTP_USER / SMTP_PASS not set in .env';
} else if (!ADMIN_EMAIL) {
  configReason = 'ADMIN_EMAIL not set in .env (and SMTP_USER is empty)';
} else {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function isConfigured() {
  return transporter !== null;
}

function configurationError() {
  return configReason;
}

async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    // Loud no-op: log the email to the console so the operator can still
    // see what would have been sent, instead of silently swallowing it.
    console.log('\n[mailer] SMTP not configured — would have sent:');
    console.log(`  to:      ${to}`);
    console.log(`  subject: ${subject}`);
    console.log(`  body:\n${text}\n`);
    return { skipped: true, reason: configReason };
  }
  return transporter.sendMail({
    from: `"${APP_NAME}" <${SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

async function notifyAdminOfRequest({ email, reason, requestId }) {
  const reviewUrl = `${APP_URL}/admin`;
  const subject = `[${APP_NAME}] New access request from ${email}`;
  const reasonLine = reason ? `Reason given: ${reason}` : 'No reason provided.';
  const text =
    `Someone has requested access to ${APP_NAME}.\n\n` +
    `Email:   ${email}\n` +
    `Request: #${requestId}\n` +
    `${reasonLine}\n\n` +
    `Review pending requests: ${reviewUrl}`;
  return sendMail({ to: ADMIN_EMAIL, subject, text });
}

async function sendAccessCodeToUser({ email, code, expiresAt }) {
  const expiresMin = Math.round((expiresAt - Date.now()) / 60000);
  const subject = `[${APP_NAME}] Your access code`;
  const text =
    `Your request was approved.\n\n` +
    `Access code: ${code}\n\n` +
    `This code is single-use and expires in about ${expiresMin} minutes.\n` +
    `Open ${APP_URL} and paste it on the access screen.\n\n` +
    `If you didn't request this, you can ignore the email.`;
  return sendMail({ to: email, subject, text });
}

async function notifyUserOfDenial({ email }) {
  const subject = `[${APP_NAME}] Access request update`;
  const text =
    `Thanks for your interest in ${APP_NAME}.\n\n` +
    `Your access request was not approved at this time.\n\n` +
    `If you think this is a mistake, please reach out to the person who runs this app.`;
  return sendMail({ to: email, subject, text });
}

module.exports = {
  isConfigured,
  configurationError,
  notifyAdminOfRequest,
  sendAccessCodeToUser,
  notifyUserOfDenial,
};
