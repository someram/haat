/**
 * Public storefront routes (no login needed).
 *
 *   GET    /api/stores                                 open stores on the platform
 *   GET    /api/stores/:slug                           one store
 *   GET    /api/stores/:slug/products                  its published products (?q= search)
 *   GET    /api/stores/:slug/products/:id              one published product
 *   POST   /api/stores/:slug/carts                     start a cart for this store
 *   GET    /api/stores/:slug/orders/:orderNumber?email=  order receipt for the shopper
 *   GET    /api/carts/:cartId                          cart with live availability checks
 *   PUT    /api/carts/:cartId/items/:productId         set quantity (0 removes)
 *   DELETE /api/carts/:cartId/items/:productId
 *   POST   /api/carts/:cartId/checkout                 place the order
 *
 * The store slug in the URL decides which tenant's data is used. Every product
 * lookup is filtered by that store's id AND status = 'published', so one store
 * can never show or sell another store's products.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const v = require('../validate');
const S = require('../serialize');
const { errors, AppError } = require('../errors');
const config = require('../config');

const router = express.Router();

/* ───────────── Store resolution ───────────── */

const findStoreBySlug = db.prepare(`
  SELECT s.*, t.status AS tenant_status FROM stores s
  JOIN tenants t ON t.id = s.tenant_id WHERE s.slug = ?`);
const findStoreById = db.prepare(`
  SELECT s.*, t.status AS tenant_status FROM stores s
  JOIN tenants t ON t.id = s.tenant_id WHERE s.id = ?`);

function assertOpen(store) {
  if (!store) throw errors.notFound('Store');
  // An inactive tenant OR an inactive store means no public shopping (spec §5, §14).
  if (store.status !== 'active' || store.tenant_status !== 'active') throw errors.storeInactive();
  return store;
}
const openStore = (slug) => assertOpen(findStoreBySlug.get(String(slug).toLowerCase()));

const publicStore = (s) => ({
  name: s.name, slug: s.slug, description: s.description, accentColor: s.accent_color,
  url: config.storeUrl(s.slug), // the store's own sub-domain, e.g. https://cha-ghar.haat.in
});

/* ───────────── Browsing ───────────── */

router.get('/stores', (_req, res) => {
  const rows = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.status = 'published') AS product_count
    FROM stores s JOIN tenants t ON t.id = s.tenant_id
    WHERE s.status = 'active' AND t.status = 'active'
    ORDER BY s.created_at, s.id`).all();
  res.json({ stores: rows.map((s) => ({ ...publicStore(s), productCount: s.product_count })) });
});

router.get('/stores/:slug', (req, res) => {
  res.json({ store: publicStore(openStore(req.params.slug)) });
});

const findPublished = db.prepare(
  "SELECT * FROM products WHERE id = ? AND store_id = ? AND status = 'published'");

router.get('/stores/:slug/products', (req, res) => {
  const store = openStore(req.params.slug);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const rows = q
    ? db.prepare(`SELECT * FROM products WHERE store_id = ? AND status = 'published'
                  AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY stock = 0, id DESC`)
      .all(store.id, `%${q.replace(/[\\%_]/g, '\\$&')}%`, `%${q.replace(/[\\%_]/g, '\\$&')}%`)
    : db.prepare(`SELECT * FROM products WHERE store_id = ? AND status = 'published' ORDER BY stock = 0, id DESC`)
      .all(store.id);
  res.json({ products: rows.map(S.publicProduct) });
});

router.get('/stores/:slug/products/:id', (req, res) => {
  const store = openStore(req.params.slug);
  const p = findPublished.get(v.int(req.params.id, 'Product id', { min: 1, max: Number.MAX_SAFE_INTEGER }), store.id);
  if (!p) throw errors.notFound('Product');
  res.json({ product: S.publicProduct(p) });
});

/* ───────────── Cart ───────────── */

router.post('/stores/:slug/carts', (req, res) => {
  const store = openStore(req.params.slug);
  const id = crypto.randomBytes(18).toString('base64url'); // unguessable cart token
  db.prepare('INSERT INTO carts (id, store_id) VALUES (?, ?)').run(id, store.id);
  res.status(201).json({ cart: { id, store: publicStore(store), items: [], total: 0, issues: [] } });
});

const findCart = db.prepare('SELECT * FROM carts WHERE id = ?');
function loadCart(cartId) {
  const cart = findCart.get(String(cartId));
  if (!cart) throw errors.notFound('Cart');
  const store = assertOpen(findStoreById.get(cart.store_id));
  return { cart, store };
}

const cartRows = db.prepare(`
  SELECT ci.product_id, ci.quantity, ci.price_paise AS cart_price,
         p.id AS pid, p.name, p.image_url, p.stock, p.status, p.price_paise AS live_price, p.store_id
  FROM cart_items ci LEFT JOIN products p ON p.id = ci.product_id
  WHERE ci.cart_id = ? ORDER BY ci.rowid`);

/**
 * Checks every cart line against the live product (spec §10):
 * exists, belongs to this store, published, in stock, enough quantity, same price.
 */
function reviewCart(cart) {
  const issues = [];
  const items = cartRows.all(cart.id).map((r) => {
    let problem = null;
    if (!r.pid || r.store_id !== cart.store_id) problem = ['PRODUCT_MISSING', 'This product no longer exists.'];
    else if (r.status !== 'published') problem = ['PRODUCT_UNAVAILABLE', 'This product is no longer for sale.'];
    else if (r.stock === 0) problem = ['INSUFFICIENT_STOCK', 'This product is sold out.'];
    else if (r.stock < r.quantity) problem = ['INSUFFICIENT_STOCK', `Only ${r.stock} left in stock.`];
    else if (r.live_price !== r.cart_price) {
      problem = ['PRICE_CHANGED', `Price changed from ₹${S.rupees(r.cart_price)} to ₹${S.rupees(r.live_price)}.`];
    }
    if (problem) issues.push({ productId: r.product_id, name: r.name, code: problem[0], message: problem[1] });
    return {
      productId: r.product_id, name: r.name || 'Removed product', imageUrl: r.image_url || '',
      quantity: r.quantity, price: S.rupees(r.cart_price), lineTotal: S.rupees(r.cart_price * r.quantity),
      available: r.stock ?? 0, issue: problem ? problem[0] : null,
    };
  });
  const totalPaise = cartRows.all(cart.id).reduce((sum, r) => sum + r.cart_price * r.quantity, 0);
  return { items, issues, total: S.rupees(totalPaise) };
}

function cartResponse(cart, store) {
  return { cart: { id: cart.id, store: publicStore(store), ...reviewCart(cart) } };
}

router.get('/carts/:cartId', (req, res) => {
  const { cart, store } = loadCart(req.params.cartId);
  res.json(cartResponse(cart, store));
});

router.put('/carts/:cartId/items/:productId', (req, res) => {
  const { cart, store } = loadCart(req.params.cartId);
  const productId = v.int(req.params.productId, 'Product id', { min: 1, max: Number.MAX_SAFE_INTEGER });
  const quantity = v.int(req.body.quantity, 'Quantity', { min: 0, max: 99 });

  if (quantity === 0) {
    db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(cart.id, productId);
    return res.json(cartResponse(cart, store));
  }

  // The product must be published AND belong to the cart's store: no mixing stores in one cart.
  const p = findPublished.get(productId, cart.store_id);
  if (!p) {
    const elsewhere = db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId);
    if (elsewhere) throw errors.conflict('PRODUCT_UNAVAILABLE', 'This product is not available in this store.');
    throw errors.notFound('Product');
  }
  if (p.stock === 0) throw errors.conflict('INSUFFICIENT_STOCK', `${p.name} is sold out.`);
  if (quantity > p.stock) {
    throw errors.conflict('INSUFFICIENT_STOCK', `Only ${p.stock} of ${p.name} left in stock.`, { available: p.stock });
  }
  // Upsert; the current price is (re)captured so the shopper always sees what they will pay.
  db.prepare(`INSERT INTO cart_items (cart_id, product_id, quantity, price_paise) VALUES (?, ?, ?, ?)
              ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity, price_paise = excluded.price_paise`)
    .run(cart.id, p.id, quantity, p.price_paise);
  res.json(cartResponse(cart, store));
});

router.delete('/carts/:cartId/items/:productId', (req, res) => {
  const { cart, store } = loadCart(req.params.cartId);
  db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(cart.id, Number(req.params.productId));
  res.json(cartResponse(cart, store));
});

/* ───────────── Checkout ───────────── */

function newOrderNumber() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `HT-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * Checkout runs in ONE database transaction:
 *   1. re-check the store is open
 *   2. re-check every line (exists, published, stock, price)
 *   3. deduct stock with "UPDATE … WHERE stock >= qty" (never goes negative)
 *   4. create the order + item snapshots, total calculated on the server
 *   5. empty the cart
 * If any step fails the whole transaction rolls back, so stock is never lost.
 */
const checkout = db.transaction((cartId, customer) => {
  const { cart, store } = loadCart(cartId);
  const lines = cartRows.all(cart.id);
  if (lines.length === 0) throw errors.invalid('Your cart is empty.');

  const { issues } = reviewCart(cart);
  if (issues.length) return { issues, cartId: cart.id }; // nothing written; handled below

  const take = db.prepare(`UPDATE products SET stock = stock - ?, updated_at = datetime('now')
                           WHERE id = ? AND store_id = ? AND status = 'published' AND stock >= ?`);
  let totalPaise = 0;
  for (const l of lines) {
    const r = take.run(l.quantity, l.product_id, store.id, l.quantity);
    if (r.changes !== 1) throw errors.conflict('INSUFFICIENT_STOCK', `Not enough stock for ${l.name}.`);
    totalPaise += l.live_price * l.quantity; // server-side total from live prices
  }

  const orderNumber = newOrderNumber();
  const orderId = db.prepare(`INSERT INTO orders (store_id, order_number, customer_name, customer_email,
                              customer_phone, address, total_paise) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(store.id, orderNumber, customer.name, customer.email, customer.phone, customer.address, totalPaise)
    .lastInsertRowid;

  const addItem = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, unit_paise, quantity, line_paise)
                              VALUES (?, ?, ?, ?, ?, ?)`);
  for (const l of lines) addItem.run(orderId, l.product_id, l.name, l.live_price, l.quantity, l.live_price * l.quantity);

  db.prepare("INSERT INTO order_status_history (order_id, from_status, to_status) VALUES (?, NULL, 'pending')").run(orderId);
  db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
  return { orderId, store };
});

const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');

router.post('/carts/:cartId/checkout', (req, res) => {
  const c = req.body.customer || {};
  const customer = {
    name: v.str(c.name, 'Name', { min: 2, max: 80 }),
    email: v.email(c.email),
    phone: v.str(c.phone, 'Phone', { max: 20, required: false }),
    address: v.str(c.address, 'Delivery address', { min: 8, max: 300 }),
  };
  const result = checkout(req.params.cartId, customer);
  if (result.issues) {
    // Accept the new live prices into the cart so the shopper sees them when reviewing,
    // then stop. They must confirm the new total by placing the order again.
    db.prepare(`UPDATE cart_items SET price_paise = (SELECT price_paise FROM products p WHERE p.id = cart_items.product_id)
                WHERE cart_id = ? AND product_id IN (SELECT id FROM products)`).run(result.cartId);
    throw new AppError(409, result.issues[0].code,
      'Some items in your cart need attention before you can place the order.', { issues: result.issues });
  }
  const { orderId, store } = result;
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json({ order: S.order(o, orderItems.all(o.id)), store: publicStore(store) });
});

router.get('/stores/:slug/orders/:orderNumber', (req, res) => {
  const store = findStoreBySlug.get(String(req.params.slug).toLowerCase());
  if (!store) throw errors.notFound('Order');
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const o = db.prepare('SELECT * FROM orders WHERE order_number = ? AND store_id = ? AND customer_email = ?')
    .get(String(req.params.orderNumber), store.id, email);
  if (!o) throw errors.notFound('Order'); // same answer for wrong email, wrong store or wrong number
  const out = S.order(o, orderItems.all(o.id));
  delete out.nextStatuses;
  res.json({ order: out, store: publicStore(store) });
});

module.exports = router;
