/**
 * Authentication routes
 *   POST /api/auth/register   tenant sign-up (creates a tenant + its first user)
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const v = require('../validate');
const { errors } = require('../errors');
const { authenticate, issueSession, clearSession } = require('../auth');

const router = express.Router();

// Simple in-memory brute-force protection: 10 failed logins per email per 15 minutes.
const failed = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function tooManyAttempts(key) {
  const entry = failed.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) return false;
  return entry.count >= 10;
}
function recordFailure(key) {
  const entry = failed.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failed.set(key, { count: 1, first: Date.now() });
  else entry.count += 1;
}

const insertTenant = db.prepare('INSERT INTO tenants (name) VALUES (?)');
const insertUser = db.prepare(
  "INSERT INTO users (name, email, password_hash, role, tenant_id) VALUES (?, ?, ?, 'tenant', ?)");
const emailTaken = db.prepare('SELECT 1 FROM users WHERE email = ?');

/** Creates a tenant and its owner account in one transaction. Shared with the admin route. */
function createTenantWithOwner({ businessName, ownerName, email, password }) {
  if (emailTaken.get(email)) throw errors.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
  const hash = bcrypt.hashSync(password, 10);
  return db.transaction(() => {
    const tenantId = insertTenant.run(businessName).lastInsertRowid;
    const userId = insertUser.run(ownerName, email, hash, tenantId).lastInsertRowid;
    return { tenantId: Number(tenantId), userId: Number(userId) };
  })();
}

router.post('/register', (req, res) => {
  const businessName = v.str(req.body.businessName, 'Business name', { min: 2, max: 80 });
  const ownerName = v.str(req.body.name, 'Your name', { min: 2, max: 80 });
  const email = v.email(req.body.email);
  const password = v.str(req.body.password, 'Password', { min: 8, max: 100 });
  const { userId } = createTenantWithOwner({ businessName, ownerName, email, password });
  issueSession(res, userId);
  res.status(201).json({ user: { id: userId, name: ownerName, email, role: 'tenant' } });
});

const findByEmail = db.prepare(`
  SELECT u.*, t.status AS tenant_status FROM users u
  LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.email = ?`);

router.post('/login', (req, res) => {
  const email = v.email(req.body.email);
  const password = v.str(req.body.password, 'Password', { max: 100 });
  if (tooManyAttempts(email)) {
    throw errors.conflict('TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in 15 minutes.');
  }
  const user = findByEmail.get(email);
  // Same message for "no such user" and "wrong password" so emails can't be probed.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailure(email);
    throw errors.unauthenticated('Email or password is incorrect.');
  }
  if (user.role === 'tenant' && user.tenant_status !== 'active') throw errors.tenantInactive();
  failed.delete(email);
  issueSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id, name: u.name, email: u.email, role: u.role,
      tenant: u.tenant_id ? { id: u.tenant_id, name: u.tenant_name, status: u.tenant_status } : null,
    },
  });
});

module.exports = { router, createTenantWithOwner };
