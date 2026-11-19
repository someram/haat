/**
 * Authentication and authorization middleware.
 *
 * Request pipeline for every protected route (spec §4):
 *   Request → authenticate → identify tenant → check permission → operation
 *
 * The JWT only carries the user id. Role, tenant and store are always loaded
 * fresh from the database, so a deactivated tenant is blocked immediately and
 * a client can never "claim" a different tenant by editing the token or body.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { errors } = require('./errors');

const COOKIE = 'haat_session';
const SESSION_HOURS = 12;

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.DB_PATH === ':memory:') return crypto.randomBytes(32).toString('hex');
  // Generate once and keep it next to the database so sessions survive restarts.
  const file = path.join(__dirname, '..', 'data', '.jwt-secret');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const SECRET = loadSecret();

function issueSession(res, userId) {
  const token = jwt.sign({ uid: userId }, SECRET, { expiresIn: `${SESSION_HOURS}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true,           // not readable from JavaScript (protects against XSS token theft)
    sameSite: 'strict',       // not sent on cross-site requests (protects against CSRF)
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_HOURS * 3600 * 1000,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE);
}

const findUser = db.prepare(`
  SELECT u.id, u.name, u.email, u.role, u.tenant_id,
         t.name AS tenant_name, t.status AS tenant_status
  FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
  WHERE u.id = ?`);

/** Step 1: who is making the request? */
function authenticate(req, _res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return next(errors.unauthenticated());
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return next(errors.unauthenticated('Your session has expired. Please log in again.'));
  }
  const user = findUser.get(payload.uid);
  if (!user) return next(errors.unauthenticated());
  req.user = user;
  next();
}

/** Step 2 + 3 for administrators. */
function requireAdmin(req, _res, next) {
  if (req.user.role !== 'admin') return next(errors.forbidden('Only platform administrators can do that.'));
  next();
}

const findStoreByTenant = db.prepare('SELECT * FROM stores WHERE tenant_id = ?');

/**
 * Step 2 + 3 for tenants: identify the tenant from the *session*, check it is
 * active, and attach its store (if one exists) to the request.
 * Every tenant route below this middleware works only inside req.store.
 */
function requireTenant(req, _res, next) {
  if (req.user.role !== 'tenant') return next(errors.forbidden('Only store owners can do that.'));
  if (req.user.tenant_status !== 'active') return next(errors.tenantInactive());
  req.tenantId = req.user.tenant_id;
  req.store = findStoreByTenant.get(req.tenantId) || null;
  next();
}

/** Used by routes that only make sense once the tenant has created a store. */
function requireStore(req, _res, next) {
  if (!req.store) return next(errors.conflict('NO_STORE', 'Create your store first.'));
  next();
}

module.exports = { authenticate, requireAdmin, requireTenant, requireStore, issueSession, clearSession };
