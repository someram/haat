/**
 * Administrator routes (platform level). All require an admin session.
 *   GET   /api/admin/overview            platform totals
 *   GET   /api/admin/tenants             list tenants with basic info
 *   POST  /api/admin/tenants             create a tenant + owner login
 *   GET   /api/admin/tenants/:id         one tenant's basic info
 *   PATCH /api/admin/tenants/:id/status  activate / deactivate
 *
 * The admin sees counts and status only. It does not run a tenant's store,
 * so there are no admin routes that edit products or orders (spec ยง2).
 */
const express = require('express');
const db = require('../db');
const v = require('../validate');
const { errors } = require('../errors');
const { authenticate, requireAdmin } = require('../auth');
const { createTenantWithOwner } = require('./auth');
const config = require('../config');

const router = express.Router();
router.use(authenticate, requireAdmin);

const tenantSelect = `
  SELECT t.id, t.name, t.status, t.created_at,
         (SELECT u.email FROM users u WHERE u.tenant_id = t.id ORDER BY u.id LIMIT 1) AS owner_email,
         (SELECT u.name  FROM users u WHERE u.tenant_id = t.id ORDER BY u.id LIMIT 1) AS owner_name,
         s.name AS store_name, s.slug AS store_slug, s.status AS store_status,
         (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS product_count,
         (SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) AS order_count,
         (SELECT COALESCE(SUM(o.total_paise),0) FROM orders o
            WHERE o.store_id = s.id AND o.status <> 'cancelled') AS revenue_paise
  FROM tenants t LEFT JOIN stores s ON s.tenant_id = t.id`;

const listTenants = db.prepare(`${tenantSelect} ORDER BY t.created_at DESC, t.id DESC`);
const getTenant = db.prepare(`${tenantSelect} WHERE t.id = ?`);

router.get('/overview', (_req, res) => {
  const row = db.prepare(`
    SELECT (SELECT COUNT(*) FROM tenants) AS tenants,
           (SELECT COUNT(*) FROM tenants WHERE status = 'active') AS active_tenants,
           (SELECT COUNT(*) FROM stores) AS stores,
           (SELECT COUNT(*) FROM products WHERE status = 'published') AS live_products,
           (SELECT COUNT(*) FROM orders) AS orders,
           (SELECT COALESCE(SUM(total_paise),0) FROM orders WHERE status <> 'cancelled') AS gmv_paise`).get();
  res.json({ overview: row });
});

const withUrl = (t) => t && ({ ...t, store_url: t.store_slug ? config.storeUrl(t.store_slug) : null });

router.get('/tenants', (_req, res) => {
  res.json({ tenants: listTenants.all().map(withUrl) });
});

router.post('/tenants', (req, res) => {
  const businessName = v.str(req.body.businessName, 'Business name', { min: 2, max: 80 });
  const ownerName = v.str(req.body.ownerName, 'Owner name', { min: 2, max: 80 });
  const email = v.email(req.body.email, 'Owner email');
  const password = v.str(req.body.password, 'Temporary password', { min: 8, max: 100 });
  const { tenantId } = createTenantWithOwner({ businessName, ownerName, email, password });
  res.status(201).json({ tenant: withUrl(getTenant.get(tenantId)) });
});

function tenantId(req) {
  return v.int(req.params.id, 'Tenant id', { min: 1, max: Number.MAX_SAFE_INTEGER });
}

router.get('/tenants/:id', (req, res) => {
  const tenant = getTenant.get(tenantId(req));
  if (!tenant) throw errors.notFound('Tenant');
  res.json({ tenant: withUrl(tenant) });
});

router.patch('/tenants/:id/status', (req, res) => {
  const id = tenantId(req);
  const status = v.oneOf(req.body.status, 'Status', ['active', 'inactive']);
  const result = db.prepare('UPDATE tenants SET status = ? WHERE id = ?').run(status, id);
  if (result.changes === 0) throw errors.notFound('Tenant');
  res.json({ tenant: withUrl(getTenant.get(id)) });
});

module.exports = router;
