/**
 * Tiny input validation helpers. Each helper returns a clean value or throws a
 * 400 error with a message the user can act on.
 */
const { errors } = require('./errors');

function str(value, field, { min = 0, max = 500, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw errors.invalid(`${field} is required.`, { field });
    return '';
  }
  if (typeof value !== 'string') throw errors.invalid(`${field} must be text.`, { field });
  const v = value.trim();
  if (required && v.length === 0) throw errors.invalid(`${field} is required.`, { field });
  if (v.length < min) throw errors.invalid(`${field} must be at least ${min} characters.`, { field });
  if (v.length > max) throw errors.invalid(`${field} must be at most ${max} characters.`, { field });
  return v;
}

function int(value, field, { min = 0, max = 1_000_000 } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n)) throw errors.invalid(`${field} must be a whole number.`, { field });
  if (n < min || n > max) throw errors.invalid(`${field} must be between ${min} and ${max}.`, { field });
  return n;
}

/** Accepts a rupee amount like 499 or "499.50" and returns integer paise. */
function rupeesToPaise(value, field = 'Price') {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10_000_000) {
    throw errors.invalid(`${field} must be a positive amount.`, { field });
  }
  return Math.round(n * 100);
}

function email(value, field = 'Email') {
  const v = str(value, field, { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw errors.invalid(`${field} is not a valid email address.`, { field });
  return v;
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw errors.invalid(`${field} must be one of: ${allowed.join(', ')}.`, { field });
  return value;
}

function slug(value, field = 'Store address') {
  const v = str(value, field, { min: 3, max: 40 }).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) {
    throw errors.invalid(`${field} can only use lowercase letters, numbers and single hyphens.`, { field });
  }
  // The store address is also the store's sub-domain, so names the platform needs are not allowed.
  if (require('./config').reservedSlugs.has(v)) {
    throw errors.invalid(`“${v}” is reserved by the platform. Choose another store address.`, { field });
  }
  return v;
}

function hexColor(value, field = 'Accent colour') {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw errors.invalid(`${field} must be a hex colour like #2F4BA8.`, { field });
  }
  return value.toUpperCase();
}

function url(value, field = 'Image URL') {
  const v = str(value, field, { max: 1000, required: false });
  if (v && !/^(https?:\/\/|\/)/i.test(v)) throw errors.invalid(`${field} must start with http://, https:// or /.`, { field });
  return v;
}

module.exports = { str, int, rupeesToPaise, email, oneOf, slug, hexColor, url };
