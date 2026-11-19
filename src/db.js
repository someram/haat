/**
 * Database layer (SQLite via better-sqlite3).
 *
 * Every table that holds tenant data is linked to a store, and every store is
 * linked to exactly one tenant. Tenant isolation is enforced in the route layer
 * by always filtering with the store_id that belongs to the *authenticated*
 * tenant, never with an id supplied by the client.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'haat.db');

if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','tenant')),
  tenant_id     INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- an admin never belongs to a tenant, a tenant user always does
  CHECK ((role = 'admin' AND tenant_id IS NULL) OR (role = 'tenant' AND tenant_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS stores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE, -- one store per tenant
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '#2F4BA8',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id     INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_paise  INTEGER NOT NULL CHECK (price_paise >= 0),   -- money stored as integer paise
  image_url    TEXT NOT NULL DEFAULT '',
  stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0), -- can never go negative
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','unpublished')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id, status);

CREATE TABLE IF NOT EXISTS carts (
  id         TEXT PRIMARY KEY,                       -- random, unguessable token
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id     TEXT    NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  price_paise INTEGER NOT NULL,                      -- price the shopper saw when adding
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id       INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_number   TEXT NOT NULL UNIQUE,
  customer_name  TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL,
  total_paise    INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','confirmed','processing','shipped','delivered','cancelled')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, created_at);

-- Order items keep a snapshot of the product name and price at purchase time.
CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT    NOT NULL,
  unit_paise   INTEGER NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  line_paise   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
