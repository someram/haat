/**
 * End-to-end API tests for the business rules in the specification.
 * Run with: npm test
 * Uses an in-memory database seeded with the demo data, so nothing on disk changes.
 */
process.env.DB_PATH = ':memory:';
process.env.APP_DOMAIN = 'haat.test';
process.env.APP_PROTOCOL = 'https';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { seed } = require('../src/seed');
const db = require('../src/db');
const http = require('node:http');

let base;
let server;

test.before(async () => {
  seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

/** A tiny client that remembers its own session cookie, like a separate browser. */
function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
}

async function login(email, password = 'password123') {
  const c = client();
  const r = await c('POST', '/api/auth/login', { email, password });
  assert.equal(r.status, 200, `login ${email}`);
  return c;
}

const productIdOf = (storeSlug, name) => db.prepare(
  'SELECT p.id FROM products p JOIN stores s ON s.id = p.store_id WHERE s.slug = ? AND p.name = ?').get(storeSlug, name).id;

/* ───────────── Authentication & authorization ───────────── */

test('unauthenticated requests are rejected', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/my/products')).status, 401);
  assert.equal((await c('GET', '/api/admin/tenants')).status, 401);
});

test('wrong password gives one generic message', async () => {
  const r = await client()('POST', '/api/auth/login', { email: 'rina@chaghar.in', password: 'nope-nope' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error.message, 'Email or password is incorrect.');
});

test('a tenant cannot use administrator routes', async () => {
  const rina = await login('rina@chaghar.in');
  const r = await rina('GET', '/api/admin/tenants');
  assert.equal(r.status, 403);
});

test('an administrator cannot use tenant store routes', async () => {
  const admin = await login('admin@haat.local', 'admin1234');
  assert.equal((await admin('GET', '/api/my/products')).status, 403);
});

/* ───────────── Tenant isolation ───────────── */

test('tenant A cannot read, edit, publish or delete tenant B products', async () => {
  const rina = await login('rina@chaghar.in'); // Cha Ghar
  const horse = productIdOf('matir-kaaj', 'Bankura Horse (Medium)'); // belongs to Matir Kaaj

  assert.equal((await rina('GET', `/api/my/products/${horse}`)).status, 404);
  assert.equal((await rina('PATCH', `/api/my/products/${horse}`, { price: 1 })).status, 404);
  assert.equal((await rina('POST', `/api/my/products/${horse}/unpublish`)).status, 404);
  assert.equal((await rina('DELETE', `/api/my/products/${horse}`)).status, 404);

  const still = db.prepare('SELECT price_paise, status FROM products WHERE id = ?').get(horse);
  assert.equal(still.price_paise, 85000);
  assert.equal(still.status, 'published');
});

test('tenant product list only contains its own products', async () => {
  const rina = await login('rina@chaghar.in');
  const { data } = await rina('GET', '/api/my/products');
  const chaGhar = db.prepare("SELECT id FROM stores WHERE slug = 'cha-ghar'").get().id;
  const own = db.prepare('SELECT COUNT(*) n FROM products WHERE store_id = ?').get(chaGhar).n;
  assert.equal(data.products.length, own);
  assert.ok(data.products.every((p) => !p.name.includes('Bankura')));
});

test('tenant A cannot read or change tenant B orders', async () => {
  const rina = await login('rina@chaghar.in');
  const bOrder = db.prepare("SELECT id FROM orders WHERE order_number = 'HT-DEMO-004'").get().id; // Matir Kaaj
  assert.equal((await rina('GET', `/api/my/orders/${bOrder}`)).status, 404);
  assert.equal((await rina('PATCH', `/api/my/orders/${bOrder}/status`, { status: 'cancelled' })).status, 404);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(bOrder).status, 'processing');
});

test('a store_id or tenant_id sent by the client is ignored', async () => {
  const rina = await login('rina@chaghar.in');
  const matir = db.prepare("SELECT id, tenant_id FROM stores WHERE slug = 'matir-kaaj'").get();
  const r = await rina('POST', '/api/my/products', {
    name: 'Sneaky product', price: 10, stock: 1, store_id: matir.id, storeId: matir.id, tenantId: matir.tenant_id,
  });
  assert.equal(r.status, 201);
  const saved = db.prepare('SELECT s.slug FROM products p JOIN stores s ON s.id = p.store_id WHERE p.id = ?').get(r.data.product.id);
  assert.equal(saved.slug, 'cha-ghar');
});

/* ───────────── Products & public store ───────────── */

test('only published products appear in the public store', async () => {
  const { data } = await client()('GET', '/api/stores/cha-ghar/products');
  const names = data.products.map((p) => p.name);
  assert.ok(!names.includes('Darjeeling Second Flush 100g'), 'draft hidden');
  assert.ok(!names.includes('Green Tea Tulsi 50g'), 'unpublished hidden');
  assert.ok(names.includes('Assam CTC Strong 250g'));
});

test('a draft product cannot be fetched directly from the store', async () => {
  const draft = productIdOf('cha-ghar', 'Darjeeling Second Flush 100g');
  assert.equal((await client()('GET', `/api/stores/cha-ghar/products/${draft}`)).status, 404);
});

test('a store never shows another store\'s product', async () => {
  const horse = productIdOf('matir-kaaj', 'Bankura Horse (Medium)');
  assert.equal((await client()('GET', `/api/stores/cha-ghar/products/${horse}`)).status, 404);
});

test('product lifecycle: draft → published → unpublished, but not unpublish a draft', async () => {
  const rina = await login('rina@chaghar.in');
  const { data } = await rina('POST', '/api/my/products', { name: 'Lifecycle Tea', price: 100, stock: 5 });
  const id = data.product.id;
  assert.equal(data.product.status, 'draft');
  assert.equal((await rina('POST', `/api/my/products/${id}/unpublish`)).status, 409);
  assert.equal((await rina('POST', `/api/my/products/${id}/publish`)).data.product.status, 'published');
  assert.equal((await rina('POST', `/api/my/products/${id}/unpublish`)).data.product.status, 'unpublished');
});

test('invalid product input is rejected with a clear message', async () => {
  const rina = await login('rina@chaghar.in');
  const r = await rina('POST', '/api/my/products', { name: 'X', price: -5 });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'INVALID_INPUT');
});

/* ───────────── Cart & checkout ───────────── */

async function newCart(c, slug) {
  return (await c('POST', `/api/stores/${slug}/carts`)).data.cart.id;
}
const customer = { name: 'Test Shopper', email: 'shopper@example.com', address: '1 Test Street, Kolkata 700001' };

test('a cart cannot mix products from different stores', async () => {
  const c = client();
  const cart = await newCart(c, 'cha-ghar');
  const horse = productIdOf('matir-kaaj', 'Bankura Horse (Medium)');
  const r = await c('PUT', `/api/carts/${cart}/items/${horse}`, { quantity: 1 });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'PRODUCT_UNAVAILABLE');
});

test('cannot add more than the available stock, or a sold-out product', async () => {
  const c = client();
  const cart = await newCart(c, 'cha-ghar');
  const chai = productIdOf('cha-ghar', 'Masala Chai Blend 200g'); // stock 3
  const kulhad = productIdOf('cha-ghar', 'Clay Kulhad Set of 6'); // stock 0
  assert.equal((await c('PUT', `/api/carts/${cart}/items/${chai}`, { quantity: 4 })).data.error.code, 'INSUFFICIENT_STOCK');
  assert.equal((await c('PUT', `/api/carts/${cart}/items/${kulhad}`, { quantity: 1 })).data.error.code, 'INSUFFICIENT_STOCK');
});

test('checkout deducts stock, calculates the total on the server and snapshots prices', async () => {
  const c = client();
  const cart = await newCart(c, 'boi-para');
  const feluda = productIdOf('boi-para', 'Feluda Samagra Vol. 1'); // ₹595, stock 9
  const before = db.prepare('SELECT stock FROM products WHERE id = ?').get(feluda).stock;
  await c('PUT', `/api/carts/${cart}/items/${feluda}`, { quantity: 2 });

  const r = await c('POST', `/api/carts/${cart}/checkout`, { customer, total: 1 }); // client total ignored
  assert.equal(r.status, 201);
  assert.equal(r.data.order.total, 1190);
  assert.equal(r.data.order.status, 'pending');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(feluda).stock, before - 2);

  // Owner later raises the price: the old order must still show ₹595.
  const pallab = await login('pallab@boipara.in');
  await pallab('PATCH', `/api/my/products/${feluda}`, { price: 650 });
  const { data } = await pallab('GET', `/api/my/orders/${r.data.order.id}`);
  assert.equal(data.order.items[0].unitPrice, 595);
  assert.equal(data.order.total, 1190);
});

test('two shoppers racing for the last item: only one order succeeds', async () => {
  const algo = productIdOf('boi-para', 'Introduction to Algorithms');
  db.prepare('UPDATE products SET stock = 1 WHERE id = ?').run(algo);
  const a = client();
  const b = client();
  const cartA = await newCart(a, 'boi-para');
  const cartB = await newCart(b, 'boi-para');
  await a('PUT', `/api/carts/${cartA}/items/${algo}`, { quantity: 1 });
  await b('PUT', `/api/carts/${cartB}/items/${algo}`, { quantity: 1 });

  const [ra, rb] = await Promise.all([
    a('POST', `/api/carts/${cartA}/checkout`, { customer }),
    b('POST', `/api/carts/${cartB}/checkout`, { customer }),
  ]);
  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(algo).stock, 0);
});

test('checkout is blocked if a product was unpublished after it went in the cart', async () => {
  const c = client();
  const cart = await newCart(c, 'cha-ghar');
  const assam = productIdOf('cha-ghar', 'Assam CTC Strong 250g');
  await c('PUT', `/api/carts/${cart}/items/${assam}`, { quantity: 1 });
  const rina = await login('rina@chaghar.in');
  await rina('POST', `/api/my/products/${assam}/unpublish`);
  const r = await c('POST', `/api/carts/${cart}/checkout`, { customer });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'PRODUCT_UNAVAILABLE');
  await rina('POST', `/api/my/products/${assam}/publish`);
});

test('checkout is blocked when the price changed, and works after the shopper reviews it', async () => {
  const c = client();
  const cart = await newCart(c, 'cha-ghar');
  const ff = productIdOf('cha-ghar', 'Darjeeling First Flush 100g'); // ₹450
  await c('PUT', `/api/carts/${cart}/items/${ff}`, { quantity: 1 });
  const rina = await login('rina@chaghar.in');
  await rina('PATCH', `/api/my/products/${ff}`, { price: 480 });

  const first = await c('POST', `/api/carts/${cart}/checkout`, { customer });
  assert.equal(first.status, 409);
  assert.equal(first.data.error.code, 'PRICE_CHANGED');

  const second = await c('POST', `/api/carts/${cart}/checkout`, { customer });
  assert.equal(second.status, 201);
  assert.equal(second.data.order.total, 480);
});

test('an empty cart cannot be checked out', async () => {
  const c = client();
  const cart = await newCart(c, 'cha-ghar');
  assert.equal((await c('POST', `/api/carts/${cart}/checkout`, { customer })).status, 400);
});

/* ───────────── Order status rules ───────────── */

test('order status must follow the allowed path', async () => {
  const rina = await login('rina@chaghar.in');
  const pending = db.prepare("SELECT id FROM orders WHERE order_number = 'HT-DEMO-003'").get().id;
  const skip = await rina('PATCH', `/api/my/orders/${pending}/status`, { status: 'shipped' });
  assert.equal(skip.status, 409);
  assert.equal(skip.data.error.code, 'INVALID_ORDER_STATE');
  assert.equal((await rina('PATCH', `/api/my/orders/${pending}/status`, { status: 'confirmed' })).data.order.status, 'confirmed');
});

test('a cancelled order can never be shipped, and cancelling returns stock', async () => {
  const c = client();
  const cart = await newCart(c, 'cha-ghar');
  const assam = productIdOf('cha-ghar', 'Assam CTC Strong 250g');
  await c('PUT', `/api/carts/${cart}/items/${assam}`, { quantity: 2 });
  const { data } = await c('POST', `/api/carts/${cart}/checkout`, { customer });
  const afterOrder = db.prepare('SELECT stock FROM products WHERE id = ?').get(assam).stock;

  const rina = await login('rina@chaghar.in');
  await rina('PATCH', `/api/my/orders/${data.order.id}/status`, { status: 'cancelled' });
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(assam).stock, afterOrder + 2);

  const r = await rina('PATCH', `/api/my/orders/${data.order.id}/status`, { status: 'shipped' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'INVALID_ORDER_STATE');
});

test('deleting a product keeps the order history intact', async () => {
  const rina = await login('rina@chaghar.in');
  const { data } = await rina('POST', '/api/my/products', { name: 'Short-lived Tea', price: 99, stock: 5, publish: true });
  const c = client();
  const cart = await newCart(c, 'cha-ghar');
  await c('PUT', `/api/carts/${cart}/items/${data.product.id}`, { quantity: 1 });
  const order = (await c('POST', `/api/carts/${cart}/checkout`, { customer })).data.order;
  await rina('DELETE', `/api/my/products/${data.product.id}`);
  const detail = (await rina('GET', `/api/my/orders/${order.id}`)).data.order;
  assert.equal(detail.items[0].name, 'Short-lived Tea');
  assert.equal(detail.items[0].unitPrice, 99);
  assert.equal(detail.items[0].productId, null);
});

/* ───────────── Administrator & inactive tenants ───────────── */

test('an inactive tenant cannot log in and its store is closed', async () => {
  const r = await client()('POST', '/api/auth/login', { email: 'mitali@shantimishti.in', password: 'password123' });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'TENANT_INACTIVE');
  assert.equal((await client()('GET', '/api/stores/shanti-mishti/products')).data.error.code, 'STORE_INACTIVE');
  const list = (await client()('GET', '/api/stores')).data.stores.map((s) => s.slug);
  assert.ok(!list.includes('shanti-mishti'));
});

test('deactivating a tenant takes effect immediately, even mid-session and mid-cart', async () => {
  const sourav = await login('sourav@matirkaaj.in');
  const shopper = client();
  const cart = await newCart(shopper, 'matir-kaaj');
  const cushion = productIdOf('matir-kaaj', 'Kantha Stitch Cushion Cover');
  await shopper('PUT', `/api/carts/${cart}/items/${cushion}`, { quantity: 1 });

  const admin = await login('admin@haat.local', 'admin1234');
  const tid = db.prepare("SELECT tenant_id FROM stores WHERE slug = 'matir-kaaj'").get().tenant_id;
  assert.equal((await admin('PATCH', `/api/admin/tenants/${tid}/status`, { status: 'inactive' })).status, 200);

  assert.equal((await sourav('GET', '/api/my/products')).data.error.code, 'TENANT_INACTIVE');
  assert.equal((await shopper('POST', `/api/carts/${cart}/checkout`, { customer })).data.error.code, 'STORE_INACTIVE');

  await admin('PATCH', `/api/admin/tenants/${tid}/status`, { status: 'active' });
  assert.equal((await sourav('GET', '/api/my/products')).status, 200);
});

test('a store closed by its owner stops public shopping', async () => {
  const pallab = await login('pallab@boipara.in');
  await pallab('PATCH', '/api/my/store', { status: 'inactive' });
  assert.equal((await client()('GET', '/api/stores/boi-para')).data.error.code, 'STORE_INACTIVE');
  await pallab('PATCH', '/api/my/store', { status: 'active' });
  assert.equal((await client()('GET', '/api/stores/boi-para')).status, 200);
});

test('administrator can create a tenant who can then set up a store', async () => {
  const admin = await login('admin@haat.local', 'admin1234');
  const r = await admin('POST', '/api/admin/tenants', {
    businessName: 'Test Business', ownerName: 'Tess Owner', email: 'tess@example.com', password: 'temp-pass-1',
  });
  assert.equal(r.status, 201);
  const tess = await login('tess@example.com', 'temp-pass-1');
  assert.equal((await tess('GET', '/api/my/products')).data.error.code, 'NO_STORE');
  const s = await tess('POST', '/api/my/store', { name: 'Tess Shop', slug: 'tess-shop' });
  assert.equal(s.status, 201);
  assert.equal((await tess('POST', '/api/my/store', { name: 'Again', slug: 'again' })).data.error.code, 'STORE_EXISTS');
  assert.equal((await tess('PATCH', '/api/my/store', { slug: 'cha-ghar' })).data.error.code, 'SLUG_TAKEN');
});

test('errors never leak SQL or stack traces', async () => {
  const r = await client()('POST', '/api/auth/register', { businessName: 'A', name: 'B', email: 'x', password: '1' });
  assert.equal(r.status, 400);
  assert.ok(!JSON.stringify(r.data).match(/SQLITE|at .*\.js|stack/i));
});

/* ───────────── Vendor sub-domains ───────────── */

/** Sends a request with a chosen Host header, as a browser on that sub-domain would. */
function onHost(host, path, { method = 'GET', body } = {}) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method,
      headers: { Host: host, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('every store gets its own sub-domain address', async () => {
  const { data } = await client()('GET', '/api/stores');
  const cha = data.stores.find((s) => s.slug === 'cha-ghar');
  assert.equal(cha.url, 'https://cha-ghar.haat.test');
});

test('a store sub-domain opens that store’s page and its products', async () => {
  const page = await onHost('cha-ghar.haat.test', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /assets\/js\/store\.js/);
  const api = JSON.parse((await onHost('cha-ghar.haat.test', '/api/stores/cha-ghar/products')).text);
  assert.ok(api.products.length > 0);
});

test('an unknown sub-domain answers 404', async () => {
  assert.equal((await onHost('no-such-store.haat.test', '/')).status, 404);
});

test('owner and admin pages and APIs are not served on a store sub-domain', async () => {
  const dash = await onHost('cha-ghar.haat.test', '/dashboard');
  assert.equal(dash.status, 302);
  assert.equal(dash.headers.location, 'https://haat.test/dashboard');
  assert.equal((await onHost('cha-ghar.haat.test', '/api/my/products')).status, 404);
  assert.equal((await onHost('cha-ghar.haat.test', '/api/admin/tenants')).status, 404);
  assert.equal((await onHost('cha-ghar.haat.test', '/api/auth/login', { method: 'POST', body: { email: 'rina@chaghar.in', password: 'password123' } })).status, 404);
});

test('the main domain still shows the marketplace', async () => {
  const home = await onHost('haat.test', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /assets\/js\/home\.js/);
  assert.equal((await onHost('www.haat.test', '/')).status, 301);
});

test('a new vendor’s store is live on its sub-domain at once; reserved names are refused', async () => {
  const c = client();
  await c('POST', '/api/auth/register', { businessName: 'Kolkata Kitchen', name: 'Hassan Ali', email: 'hassan@kk.example', password: 'password123' });
  const bad = await c('POST', '/api/my
