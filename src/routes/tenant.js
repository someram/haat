/**
 * Tenant routes ("my" = the logged-in tenant's own store).
 *
 *   GET    /api/my/overview
 *   GET    /api/my/store            POST /api/my/store       PATCH /api/my/store
 *   GET    /api/my/products         POST /api/my/products
 *   GET    /api/my/products/:id     PATCH /api/my/products/:id   DELETE /api/my/products/:id
 *   POST   /api/my/products/:id/publish
 *   POST   /api/my/products/:id/unpublish
 *   GET    /api/my/orders           GET /api/my/orders/:id
 *   PATCH  /api/my/orders/:id/status
 *
 * TENANT ISOLATION: there is no tenant id or store id in any of these URLs or
 * bodies. The store is always req.store, which requireTenant() loaded from the
 * session. Every query filters by req.store.id, so asking for another tenant's
 * product or order simply returns 404 — it does not even reveal that it exists.
 */
const express = require('express');
const db = require('../db');
const v = require('../validate');
const S = require('../serialize');
const { errors } = require('../errors');
const { authenticate, requireTenant, requireStore } = require('../auth');
const { canTransition, ORDER_STATUSES } = require('../orderRules');

const router = express.Router();
router.use(authenticate, requireTenant);

const idParam = (req) => v.int(req.params.id, 'Id', { min: 1, max: Number.MAX_SAFE_INTEGER });

/* ───────────── Overview ───────────── */

router.get('/overview', (req, res) => {
  if (!req.store) return res.json({ store: null });
  const sid = req.store.id;
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM products WHERE store_id = @sid) AS products,
      (SELECT COUNT(*) FROM products WHERE store_id = @sid AND status = 'published') AS published,
      (SELECT COUNT(*) FROM products WHERE store_id = @sid AND status = 'published' AND stock = 0) AS sold_out,
      (SELECT COUNT(*) FROM orders   WHERE store_id = @sid) AS orders,
      (SELECT COUNT(*) FROM orders   WHERE store_id = @sid AND status IN ('pending','confirmed','processing')) AS open_orders,
      (SELECT COALESCE(SUM(total_paise),0) FROM orders WHERE store_id = @sid AND status <> 'cancelled') AS revenue_paise
  `).get({ sid });
  const recent = db.prepare(`
    SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
    FROM orders o WHERE store_id = ? ORDER BY o.id DESC LIMIT 5`).all(sid);
  const lowStock = db.prepare(`
    SELECT * FROM products WHERE store_id = ? AND status = 'published' AND stock <= 5
    ORDER BY stock ASC LIMIT 5`).all(sid);
  res.json({
    store: S.store(req.store),
    stats: { ...stats, revenue: S.rupees(stats.revenue_paise) },
    recentOrders: recent.map((o) => S.order(o)),
    lowStock: lowStock.map(S.product),
  });
});

/* ───────────── Store ───────────── */

router.get('/store', (req, res) => {
  res.json({ store: S.store(req.store) });
});

router.post('/store', (req, res) => {
  if (req.store) throw errors.conflict('STORE_EXISTS', 'You already have a store. Edit it instead.');
  const name = v.str(req.body.name, 'Store name', { min: 2, max: 60 });
  const slug = v.slug(req.body.slug);
  const description = v.str(req.body.description, 'Description', { max: 300, required: false });
  const accent = v.hexColor(req.body.accentColor) || '#2F4BA8';
  if (db.prepare('SELECT 1 FROM stores WHERE slug = ?').get(slug)) {
    throw errors.conflict('SLUG_TAKEN', 'That store address is already taken. Try another.');
  }
  const id = db.prepare(
    'INSERT INTO stores (tenant_id, name, slug, description, accent_color) VALUES (?, ?, ?, ?, ?)')
    .run(req.tenantId, name, slug, description, accent).lastInsertRowid;
  res.status(201).json({ store: S.store(db.prepare('SELECT * FROM stores WHERE id = ?').get(id)) });
});

router.patch('/store', requireStore, (req, res) => {
  const s = req.store;
  const b = req.body;
  const name = b.name !== undefined ? v.str(b.name, 'Store name', { min: 2, max: 60 }) : s.name;
  const description = b.description !== undefined
    ? v.str(b.description, 'Description', { max: 300, required: false }) : s.description;
  const accent = v.hexColor(b.accentColor) || s.accent_color;
  const status = b.status !== undefined ? v.oneOf(b.status, 'Store status', ['active', 'inactive']) : s.status;
  let slug = s.slug;
  if (b.slug !== undefined && b.slug !== s.slug) {
    slug = v.slug(b.slug);
    if (db.prepare('SELECT 1 FROM stores WHERE slug = ? AND id <> ?').get(slug, s.id)) {
      throw errors.conflict('SLUG_TAKEN', 'That store address is already taken. Try another.');
    }
  }
  db.prepare(`UPDATE stores SET name = ?, slug = ?, description = ?, accent_color = ?, status = ?
              WHERE id = ? AND tenant_id = ?`)
    .run(name, slug, description, accent, status, s.id, req.tenantId);
  res.json({ store: S.store(db.prepare('SELECT * FROM stores WHERE id = ?').get(s.id)) });
});

/* ───────────── Products ───────────── */

const findOwnProduct = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?');
function ownProduct(req) {
  const p = findOwnProduct.get(idParam(req), req.store.id);
  if (!p) throw errors.notFound('Product');
  return p;
}

router.get('/products', requireStore, (req, res) => {
  const status = req.query.status;
  const rows = status
    ? db.prepare('SELECT * FROM products WHERE store_id = ? AND status = ? ORDER BY id DESC')
      .all(req.store.id, v.oneOf(status, 'Status', ['draft', 'published', 'unpublished']))
    : db.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY id DESC').all(req.store.id);
  res.json({ products: rows.map(S.product) });
});

router.post('/products', requireStore, (req, res) => {
  const b = req.body;
  const name = v.str(b.name, 'Product name', { min: 2, max: 100 });
  const description = v.str(b.description, 'Description', { max: 2000, required: false });
  const price = v.rupeesToPaise(b.price);
  const stock = v.int(b.stock ?? 0, 'Stock', { min: 0, max: 100000 });
  const imageUrl = v.url(b.imageUrl);
  // New products start as drafts unless the owner chooses to publish straight away.
  const status = b.publish === true ? 'published' : 'draft';
  // store_id comes from the session, never from the request body.
  const id = db.prepare(`INSERT INTO products (store_id, name, description, price_paise, stock, image_url, status)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(req.store.id, name, description, price, stock, imageUrl, status).lastInsertRowid;
  res.status(201).json({ product: S.product(findOwnProduct.get(id, req.store.id)) });
});

router.get('/products/:id', requireStore, (req, res) => {
  res.json({ product: S.product(ownProduct(req)) });
});

router.patch('/products/:id', requireStore, (req, res) => {
  const p = ownProduct(req);
  const b = req.body;
  const next = {
    name: b.name !== undefined ? v.str(b.name, 'Product name', { min: 2, max: 100 }) : p.name,
    description: b.description !== undefined
      ? v.str(b.description, 'Description', { max: 2000, required: false }) : p.description,
    price: b.price !== undefined ? v.rupeesToPaise(b.price) : p.price_paise,
    stock: b.stock !== undefined ? v.int(b.stock, 'Stock', { min: 0, max: 100000 }) : p.stock,
    imageUrl: b.imageUrl !== undefined ? v.url(b.imageUrl) : p.image_url,
  };
  db.prepare(`UPDATE products SET name = ?, description = ?, price_paise = ?, stock = ?, image_url = ?,
              updated_at = datetime('now') WHERE id = ? AND store_id = ?`)
    .run(next.name, next.description, next.price, next.stock, next.imageUrl, p.id, req.store.id);
  res.json({ product: S.product(findOwnProduct.get(p.id, req.store.id)) });
});

function setProductStatus(from, to) {
  return (req, res) => {
    const p = ownProduct(req);
    if (!from.includes(p.status)) {
      throw errors.conflict('INVALID_PRODUCT_STATE', `A ${p.status} product cannot be ${to}.`);
    }
    db.prepare(`UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?`)
      .run(to, p.id, req.store.id);
    res.json({ product: S.product(findOwnProduct.get(p.id, req.store.id)) });
  };
}
router.post('/products/:id/publish', requireStore, setProductStatus(['draft', 'unpublished'], 'published'));
router.post('/products/:id/unpublish', requireStore, setProductStatus(['published'], 'unpublished'));

router.delete('/products/:id', requireStore, (req, res) => {
  const p = ownProduct(req);
  // Past orders keep their item snapshot; order_items.product_id becomes NULL.
  db.prepare('DELETE FROM products WHERE id = ? AND store_id = ?').run(p.id, req.store.id);
  res.json({ ok: true });
});

/* ───────────── Orders ───────────── */

const findOwnOrder = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?');
const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
const orderHistory = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id');

function ownOrder(req) {
  const o = findOwnOrder.get(idParam(req), req.store.id);
  if (!o) throw errors.notFound('Order');
  return o;
}

router.get('/orders', requireStore, (req, res) => {
  const params = [req.store.id];
  let where = 'o.store_id = ?';
  if (req.query.status) {
    where += ' AND o.status = ?';
    params.push(v.oneOf(req.query.status, 'Status', ORDER_STATUSES));
  }
  const rows = db.prepare(`
    SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
    FROM orders o WHERE ${where} ORDER BY o.id DESC`).all(...params);
  res.json({ orders: rows.map((o) => S.order(o)) });
});

router.get('/orders/:id', requireStore, (req, res) => {
  const o = ownOrder(req);
  res.json({ order: S.order(o, orderItems.all(o.id), orderHistory.all(o.id)) });
});

router.patch('/orders/:id/status', requireStore, (req, res) => {
  const to = v.oneOf(req.body.status, 'Status', ORDER_STATUSES);
  const storeId = req.store.id;

  const updated = db.transaction(() => {
    // Re-read inside the transaction so two simultaneous updates can't both pass the check.
    const o = ownOrder(req);
    if (!canTransition(o.status, to)) {
      throw errors.conflict('INVALID_ORDER_STATE',
        `An order that is ${o.status} cannot be changed to ${to}.`, { current: o.status, requested: to });
    }
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?`)
      .run(to, o.id, storeId);
    db.prepare('INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)')
      .run(o.id, o.status, to, req.user.id);

    // Cancelling puts the reserved stock back on the shelf (if the product still exists).
    if (to === 'cancelled') {
      const restock = db.prepare(`UPDATE products SET stock = stock + ?, updated_at = datetime('now')
                                  WHERE id = ? AND store_id = ?`);
      for (const item of orderItems.all(o.id)) {
        if (item.product_id) restock.run(item.quantity, item.product_id, storeId);
      }
    }
    return findOwnOrder.get(o.id, storeId);
  })();

  res.json({ order: S.order(updated, orderItems.all(updated.id), orderHistory.all(updated.id)) });
});

module.exports = router;
