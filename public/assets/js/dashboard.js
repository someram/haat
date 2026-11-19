// Tenant dashboard: overview, products, orders, store settings.
import { api, money, esc, $, $$, date, toast, art, pill, formData, formError, busy, icons, wireMobileMenu, logout } from './common.js';

const view = $('#view');
let me = null;
let store = null;
/** "https://cha-ghar.haat.in" → "cha-ghar.haat.in" */
const host = (url) => String(url).replace(/^https?:\/\//, '');

/* ───────────── Shell ───────────── */

const PAGES = [
  ['overview', 'Overview', icons.home],
  ['products', 'Products', icons.box],
  ['orders', 'Orders', icons.receipt],
  ['store', 'Store settings', icons.shop],
];

function renderNav(openOrders = 0) {
  const current = currentPage();
  const items = store
    ? PAGES.map(([id, label, icon]) => `
        <a class="nav-btn" href="#${id}" ${current === id ? 'aria-current="page"' : ''}>${icon}${label}
          ${id === 'orders' && openOrders ? `<span class="count" title="Open orders">${openOrders}</span>` : ''}</a>`).join('')
      + `<a class="nav-btn" href="${esc(store.url)}" target="_blank" rel="noopener">${icons.ext}View my store</a>`
    : `<a class="nav-btn" href="#store" aria-current="page">${icons.shop}Create store</a>`;
  $('#side-nav').innerHTML = items;
  $('#who').innerHTML = `<b>${esc(me.name)}</b><span>${esc(me.tenant.name)}</span>
    <button class="nav-btn" id="logout" type="button" style="margin-top:8px;padding-left:0">${icons.out}Log out</button>`;
  $('#logout').addEventListener('click', logout);
}

function currentPage() {
  const h = location.hash.slice(1);
  return PAGES.some(([id]) => id === h) ? h : 'overview';
}

async function route() {
  if (!store) return renderCreateStore();
  const page = currentPage();
  renderNav(window.__openOrders || 0);
  if (page === 'overview') await renderOverview();
  if (page === 'products') await renderProducts();
  if (page === 'orders') await renderOrders();
  if (page === 'store') renderStoreSettings();
  view.focus({ preventScroll: true });
}

/* ───────────── Overview ───────────── */

async function renderOverview() {
  const data = await api('/api/my/overview');
  store = data.store;
  window.__openOrders = data.stats.open_orders;
  renderNav(data.stats.open_orders);
  const s = data.stats;
  view.innerHTML = `
    ${store.status === 'inactive' ? `<div class="banner warn"><span>Your store is closed, so shoppers can't buy anything right now.</span>
      <a class="btn sm" href="#store">Open store</a></div>` : ''}
    <div class="page-head">
      <div><h1>${esc(store.name)}</h1><p><a href="${esc(store.url)}" target="_blank" rel="noopener">${esc(host(store.url))}</a></p></div>
      <a class="btn" href="#products" id="quick-add">Add product</a>
    </div>
    <div class="stats">
      <div class="stat feature"><div class="label">Revenue (excl. cancelled)</div><div class="value">${money(s.revenue)}</div></div>
      <div class="stat"><div class="label">Open orders</div><div class="value">${s.open_orders}</div></div>
      <div class="stat"><div class="label">Total orders</div><div class="value">${s.orders}</div></div>
      <div class="stat"><div class="label">Live products</div><div class="value">${s.published}<span class="muted small"> / ${s.products}</span></div></div>
    </div>
    <div class="split">
      <section class="panel">
        <div class="panel-head"><h2>Latest orders</h2><a href="#orders" class="small">All orders</a></div>
        ${data.recentOrders.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th class="num">Total</th></tr></thead>
          <tbody>${data.recentOrders.map((o) => `
            <tr class="clickable" data-order="${o.id}"><td><b>${esc(o.orderNumber)}</b><div class="small muted">${date(o.createdAt)}</div></td>
            <td>${esc(o.customer.name)}</td><td>${pill(o.status)}</td><td class="num">${money(o.total)}</td></tr>`).join('')}
          </tbody></table></div>`
        : '<div class="empty"><h3>No orders yet</h3><p>Publish a product and share your store link to get your first order.</p></div>'}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Running low</h2><span class="small muted">5 or fewer left</span></div>
        ${data.lowStock.length ? `<div class="table-wrap"><table><tbody>${data.lowStock.map((p) => `
            <tr><td><div class="prod-cell">${art(p)}<b>${esc(p.name)}</b></div></td>
            <td class="num ${p.stock === 0 ? 'stock-low' : ''}">${p.stock === 0 ? 'Sold out' : `${p.stock} left`}</td></tr>`).join('')}
          </tbody></table></div>`
        : '<div class="empty"><p>All live products have healthy stock.</p></div>'}
      </section>
    </div>`;
  $('#quick-add').addEventListener('click', () => setTimeout(() => openProduct(), 50));
  wireOrderRows();
}

/* ───────────── Products ───────────── */

let productFilter = '';

async function renderProducts() {
  const { products } = await api(`/api/my/products${productFilter ? `?status=${productFilter}` : ''}`);
  const filters = [['', 'All'], ['published', 'Published'], ['draft', 'Drafts'], ['unpublished', 'Unpublished']];
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Products</h1><p>Only published products appear in your store.</p></div>
      <button class="btn" id="add-product" type="button">Add product</button>
    </div>
    <section class="panel">
      <div class="panel-head">
        <div class="tabs" role="group" aria-label="Filter by status">${filters.map(([v, l]) =>
          `<button class="tab" type="button" data-filter="${v}" aria-pressed="${productFilter === v}">${l}</button>`).join('')}</div>
        <span class="small muted">${products.length} ${products.length === 1 ? 'product' : 'products'}</span>
      </div>
      ${products.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Status</th><th class="num">Price</th><th class="num">Stock</th><th class="num">Actions</th></tr></thead>
        <tbody>${products.map(productRow).join('')}</tbody></table></div>`
      : `<div class="empty"><h3>${productFilter ? 'Nothing here' : 'Add your first product'}</h3>
          <p>${productFilter ? 'No products with this status.' : 'New products start as drafts. Publish one when it is ready to sell.'}</p></div>`}
    </section>`;

  $('#add-product').addEventListener('click', () => openProduct());
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { productFilter = b.dataset.filter; renderProducts(); }));
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  $$('[data-act]').forEach((b) => b.addEventListener('click', () => productAction(b, byId[b.dataset.id])));
}

function productRow(p) {
  const toggle = p.status === 'published'
    ? `<button class="btn ghost sm" type="button" data-act="unpublish" data-id="${p.id}">Unpublish</button>`
    : `<button class="btn sm" type="button" data-act="publish" data-id="${p.id}">Publish</button>`;
  return `<tr>
    <td><div class="prod-cell">${art(p)}<div><b>${esc(p.name)}</b><span class="small muted">${esc(p.description).slice(0, 60)}</span></div></div></td>
    <td>${pill(p.status)}</td>
    <td class="num">${money(p.price)}</td>
    <td class="num ${p.stock <= 5 ? 'stock-low' : ''}">${p.stock}</td>
    <td><div class="actions">${toggle}
      <button class="btn ghost sm" type="button" data-act="edit" data-id="${p.id}">Edit</button>
      <button class="btn ghost sm" type="button" data-act="delete" data-id="${p.id}" aria-label="Delete ${esc(p.name)}">Delete</button>
    </div></td></tr>`;
}

async function productAction(button, p) {
  const act = button.dataset.act;
  if (act === 'edit') return openProduct(p);
  if (act === 'delete') {
    const ok = await confirmBox(`Delete “${p.name}”? Past orders keep their copy of the name and price.`);
    if (!ok) return;
    await api(`/api/my/products/${p.id}`, { method: 'DELETE' });
    toast('Product deleted');
    return renderProducts();
  }
  await busy(button, async () => {
    try {
      await api(`/api/my/products/${p.id}/${act}`, { method: 'POST' });
      toast(act === 'publish' ? 'Published — now visible in your store' : 'Unpublished — hidden from your store');
      renderProducts();
    } catch (e) { toast(e.message, 'error'); }
  });
}

const productDlg = $('#product-dlg');
const productForm = $('#product-form');
let editing = null;

function openProduct(p = null) {
  editing = p;
  productForm.reset();
  formError(productForm, null);
  $('#product-dlg-title').textContent = p ? 'Edit product' : 'Add product';
  $('#product-save').textContent = p ? 'Save changes' : 'Add product';
  $('#publish-now-row').classList.toggle('hidden', !!p);
  if (p) {
    productForm.name.value = p.name;
    productForm.description.value = p.description;
    productForm.price.value = p.price;
    productForm.stock.value = p.stock;
    productForm.imageUrl.value = p.imageUrl;
  } else {
    productForm.stock.value = 10;
  }
  productDlg.showModal();
  productForm.name.focus();
}

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formData(productForm);
  const body = {
    name: f.name, description: f.description, imageUrl: f.imageUrl,
    price: f.price === '' ? undefined : Number(f.price),
    stock: f.stock === '' ? undefined : Number(f.stock),
  };
  if (!editing) body.publish = productForm.publish.checked;
  await busy($('#product-save'), async () => {
    try {
      if (editing) await api(`/api/my/products/${editing.id}`, { method: 'PATCH', body });
      else await api('/api/my/products', { method: 'POST', body });
      productDlg.close();
      toast(editing ? 'Product saved' : 'Product added');
      if (currentPage() === 'products') renderProducts(); else location.hash = '#products';
    } catch (err) { formError(productForm, err); }
  });
});

/* ───────────── Orders ───────────── */

let orderFilter = '';

async function renderOrders() {
  const { orders } = await api(`/api/my/orders${orderFilter ? `?status=${orderFilter}` : ''}`);
  const filters = [['', 'All'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['processing', 'Processing'],
    ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
  view.innerHTML = `
    <div class="page-head"><div><h1>Orders</h1><p>Move each order forward as you pack and ship it.</p></div></div>
    <section class="panel">
      <div class="panel-head">
        <div class="tabs" role="group" aria-label="Filter by status">${filters.map(([v, l]) =>
          `<button class="tab" type="button" data-filter="${v}" aria-pressed="${orderFilter === v}">${l}</button>`).join('')}</div>
      </div>
      ${orders.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th class="num">Total</th></tr></thead>
        <tbody>${orders.map((o) => `
          <tr class="clickable" data-order="${o.id}" tabindex="0">
            <td><b>${esc(o.orderNumber)}</b><div class="small muted">${date(o.createdAt, true)}</div></td>
            <td>${esc(o.customer.name)}<div class="small muted">${esc(o.customer.email)}</div></td>
            <td>${o.itemCount}</td><td>${pill(o.status)}</td><td class="num">${money(o.total)}</td></tr>`).join('')}
        </tbody></table></div>`
      : '<div class="empty"><h3>No orders here</h3><p>Orders appear as soon as a shopper checks out.</p></div>'}
    </section>`;
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { orderFilter = b.dataset.filter; renderOrders(); }));
  wireOrderRows();
}

function wireOrderRows() {
  $$('tr[data-order]').forEach((tr) => {
    tr.addEventListener('click', () => openOrder(tr.dataset.order));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openOrder(tr.dataset.order); });
  });
}

const STEP_LABEL = { confirmed: 'Confirm order', processing: 'Start packing', shipped: 'Mark shipped', delivered: 'Mark delivered', cancelled: 'Cancel order' };

async function openOrder(id) {
  const { order: o } = await api(`/api/my/orders/${id}`);
  $('#order-dlg-title').innerHTML = `${esc(o.orderNumber)} ${pill(o.status)}`;
  $('#order-body').innerHTML = `
    <dl class="order-meta">
      <div><dt>Customer</dt><dd>${esc(o.customer.name)}</dd></div>
      <div><dt>Placed</dt><dd>${date(o.createdAt, true)}</dd></div>
      <div><dt>Email</dt><dd>${esc(o.customer.email)}</dd></div>
      <div><dt>Phone</dt><dd>${esc(o.customer.phone || '—')}</dd></div>
      <div style="grid-column:1/-1"><dt>Deliver to</dt><dd>${esc(o.customer.address)}</dd></div>
    </dl>
    <table class="lines"><tbody>${o.items.map((i) => `
      <tr><td>${esc(i.name)}${i.productId ? '' : ' <span class="small muted">(product deleted)</span>'}
        <div class="small muted">${i.quantity} × ${money(i.unitPrice)}</div></td><td class="num">${money(i.lineTotal)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td>Total</td><td class="num">${money(o.total)}</td></tr></tfoot></table>
    <p class="small muted">Prices are what the customer paid at checkout, even if you have changed them since.</p>
    ${o.nextStatuses.length ? `<h4>Next step</h4><div class="next-steps">${o.nextStatuses.map((s) =>
      `<button class="btn ${s === 'cancelled' ? 'ghost' : ''} sm" type="button" data-status="${s}">${STEP_LABEL[s]}</button>`).join('')}</div>`
    : `<p class="small"><b>This order is ${o.status}.</b> No further changes are possible.</p>`}
    <h4 style="margin-top:1.2rem">History</h4>
    <ul class="timeline">${o.history.map((h) => `<li><b style="text-transform:capitalize">${esc(h.to)}</b> <span class="muted">· ${date(h.at, true)}</span></li>`).join('')}</ul>`;
  $$('#order-body [data-status]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    try {
      await api(`/api/my/orders/${o.id}/status`, { method: 'PATCH', body: { status: b.dataset.status } });
      toast(`Order ${b.dataset.status}${b.dataset.status === 'cancelled' ? ' — stock returned' : ''}`);
      await openOrder(o.id);
      route();
    } catch (e) { toast(e.message, 'error'); }
  })));
  if (!$('#order-dlg').open) $('#order-dlg').showModal();
}

/* ───────────── Store ───────────── */

function storeForm(s) {
  return `
    <form id="store-form" novalidate>
      <div class="form-error hidden" data-error role="alert"></div>
      <div class="field"><label for="s-name">Store name</label>
        <input id="s-name" name="name" value="${esc(s?.name || '')}" data-field="Store name" required></div>
      <div class="field"><label for="s-slug">Store address</label>
        <div class="prefix suffix"><span class="pre">${esc(location.protocol)}//</span><input id="s-slug" name="slug" value="${esc(s?.slug || '')}" data-field="Store address" required><span>.${esc(location.host)}</span></div>
        <div class="hint">Your store gets its own sub-domain. Use lowercase letters, numbers and hyphens. This is the link you share with customers.</div></div>
      <div class="field"><label for="s-desc">Description</label>
        <textarea id="s-desc" name="description" data-field="Description" maxlength="300">${esc(s?.description || '')}</textarea></div>
      <div class="field"><label for="s-color">Store colour</label>
        <div style="display:flex;gap:1rem;align-items:center">
          <input id="s-color" name="accentColor" type="color" value="${esc(s?.accentColor || '#2F4BA8')}" data-field="Accent colour">
          <div class="awning" id="awning-preview" style="flex:1;max-width:280px;--c:${esc(s?.accentColor || '#2F4BA8')}"></div>
        </div></div>
      ${s ? `<div class="field"><label>Store status</label>
        <label style="display:flex;gap:.5rem;align-items:center;font-weight:500"><input type="radio" name="status" value="active" style="width:auto" ${s.status === 'active' ? 'checked' : ''}> Open — shoppers can buy</label>
        <label style="display:flex;gap:.5rem;align-items:center;font-weight:500"><input type="radio" name="status" value="inactive" style="width:auto" ${s.status === 'inactive' ? 'checked' : ''}> Closed — store page shows as unavailable</label></div>` : ''}
      <button class="btn" type="submit" id="store-save">${s ? 'Save changes' : 'Create store'}</button>
    </form>`;
}

function wireStoreForm(isNew) {
  const form = $('#store-form');
  const slug = form.slug;
  let slugTouched = !isNew;
  slug.addEventListener('input', () => { slugTouched = true; });
  form.name.addEventListener('input', () => {
    if (!slugTouched) slug.value = form.name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  });
  form.accentColor.addEventListener('input', () => $('#awning-preview').style.setProperty('--c', form.accentColor.value));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(form, null);
    await busy($('#store-save'), async () => {
      try {
        const oldSlug = store?.slug;
        const { store: s } = await api('/api/my/store', { method: isNew ? 'POST' : 'PATCH', body: formData(form) });
        store = s;
        toast(isNew ? `Store created. It is live at ${host(s.url)}` : (s.slug !== oldSlug ? `Saved. Your store is now at ${host(s.url)}` : 'Store saved'));
        location.hash = isNew ? '#products' : '#store';
        route();
      } catch (err) { formError(form, err); }
    });
  });
}

function renderCreateStore() {
  renderNav();
  view.innerHTML = `
    <div class="page-head"><div><h1>Set up your store</h1><p>Welcome, ${esc(me.name)}. One last step before you can add products.</p></div></div>
    <section class="panel" style="max-width:620px"><div class="panel-body">${storeForm(null)}</div></section>`;
  wireStoreForm(true);
}

function renderStoreSettings() {
  view.innerHTML = `
    <div class="page-head"><div><h1>Store settings</h1><p>How your store looks to shoppers.</p></div>
      <a class="btn ghost" href="${esc(store.url)}" target="_blank" rel="noopener">View store</a></div>
    <section class="panel" style="max-width:620px"><div class="panel-body">${storeForm(store)}</div></section>`;
  wireStoreForm(false);
}

/* ───────────── Dialog helpers ───────────── */

function confirmBox(text) {
  const dlg = $('#confirm-dlg');
  $('#confirm-text').textContent = text;
  dlg.showModal();
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); $('#confirm-ok').onclick = null; resolve(v); };
    $('#confirm-ok').onclick = () => done(true);
    dlg.querySelector('[data-close]').onclick = () => done(false);
    dlg.addEventListener('cancel', () => resolve(false), { once: true });
  });
}

$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

/* ───────────── Start ───────────── */

(async function start() {
  wireMobileMenu();
  try {
    ({ user: me } = await api('/api/auth/me'));
  } catch {
    location.href = '/login';
    return;
  }
  if (me.role === 'admin') { location.href = '/admin'; return; }
  try {
    ({ store } = await api('/api/my/store'));
  } catch (e) {
    view.innerHTML = `<div class="empty"><h3>Account unavailable</h3><p>${esc(e.message)}</p><p><button class="btn" id="lo" type="button">Log out</button></p></div>`;
    $('#lo').addEventListener('click', logout);
    return;
  }
  window.addEventListener('hashchange', route);
  route();
})();
