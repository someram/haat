// Public storefront: browse one store, fill a cart from that store, check out.
import { api, money, esc, $, $$, date, toast, art, formData, formError, busy } from './common.js';

// A store is opened either on its own sub-domain (cha-ghar.haat.in) or at /s/cha-ghar
// on the main domain. The server only serves this page at "/" on a store sub-domain.
const onPath = location.pathname.startsWith('/s/');
const slug = (onPath
  ? decodeURIComponent(location.pathname.split('/')[2] || '')
  : location.hostname.split('.')[0]).toLowerCase();
/** The marketplace home page on the main domain. */
const mainHome = onPath ? '/' : `${location.protocol}//${location.host.split('.').slice(1).join('.')}/`;
/** This store's own address, wherever we are. */
const storeHome = onPath ? `/s/${encodeURIComponent(slug)}` : '/';
const app = $('#app');
const CART_KEY = `haat_cart_${slug}`;
let store = null;
let products = [];
let cart = null;

/* ───────────── Cart storage (one cart per store) ───────────── */

function savedCartId() { try { return localStorage.getItem(CART_KEY); } catch { return null; } }
function saveCartId(id) { try { id ? localStorage.setItem(CART_KEY, id) : localStorage.removeItem(CART_KEY); } catch { /* private mode */ } }

async function loadCart() {
  const id = savedCartId();
  if (!id) { cart = null; return; }
  try { ({ cart } = await api(`/api/carts/${encodeURIComponent(id)}`)); } catch { cart = null; saveCartId(null); }
}

async function ensureCart() {
  if (cart) return cart;
  ({ cart } = await api(`/api/stores/${encodeURIComponent(slug)}/carts`, { method: 'POST' }));
  saveCartId(cart.id);
  return cart;
}

async function setQty(productId, quantity) {
  const c = await ensureCart();
  ({ cart } = await api(`/api/carts/${encodeURIComponent(c.id)}/items/${productId}`, { method: 'PUT', body: { quantity } }));
  updateCartCount();
}

const cartCount = () => (cart ? cart.items.reduce((n, i) => n + i.quantity, 0) : 0);
const qtyInCart = (id) => cart?.items.find((i) => i.productId === id)?.quantity || 0;
function updateCartCount() {
  const n = cartCount();
  $$('.cart-btn .n').forEach((el) => { el.textContent = n; });
}

/* ───────────── Layout ───────────── */

function shell(inner) {
  document.title = `${store.name} — Haat`;
  document.documentElement.style.setProperty('--accent', store.accentColor);
  app.innerHTML = `
    <header class="sf-header">
      <div class="awning" aria-hidden="true"></div>
      <div class="sf-bar">
        <a class="back" href="${esc(mainHome)}">All stores on Haat</a>
        <button class="cart-btn" type="button" id="open-cart">Cart <span class="n">${cartCount()}</span></button>
      </div>
      <div class="sf-hero">
        <h1>${esc(store.name)}</h1>
        <p>${esc(store.description)}</p>
      </div>
    </header>
    <main class="sf-main" id="sf-main">${inner}</main>
    <footer class="foot">${esc(store.name)} is a store on <a href="${esc(mainHome)}">Haat</a></footer>`;
  $('#open-cart').addEventListener('click', openCart);
}

/* ───────────── Products ───────────── */

async function renderCatalogue(q = '') {
  ({ products } = await api(`/api/stores/${encodeURIComponent(slug)}/products${q ? `?q=${encodeURIComponent(q)}` : ''}`));
  const main = $('#sf-main');
  main.innerHTML = `
    <div class="sf-tools">
      <h2 style="margin:0">${q ? `Results for “${esc(q)}”` : 'Everything in store'}</h2>
      <form id="search" role="search"><input name="q" type="search" placeholder="Search this store" value="${esc(q)}" aria-label="Search this store"></form>
    </div>
    ${products.length ? `<div class="grid">${products.map((p) => `
      <button class="card" type="button" data-product="${p.id}">
        ${art(p)}
        <div class="info">
          <h3>${esc(p.name)}</h3>
          ${p.inStock && p.stockLeft ? `<span class="left">Only ${p.stockLeft} left</span>` : ''}
          <span class="price">${money(p.price)}</span>
        </div>
      </button>`).join('')}</div>`
    : `<div class="empty"><h3>${q ? 'Nothing matches that search' : 'No products yet'}</h3>
        <p>${q ? 'Try a shorter word.' : 'This store is still stocking its shelves. Check back soon.'}</p></div>`}`;
  $('#search').addEventListener('submit', (e) => { e.preventDefault(); renderCatalogue(e.target.q.value.trim()); });
  $$('[data-product]').forEach((b) => b.addEventListener('click', () => openProduct(Number(b.dataset.product))));
}

function openProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  let qty = 1;
  const inCart = qtyInCart(id);
  const max = p.stockLeft ?? 99;
  $('#pd-title').textContent = p.name;
  $('#pd-body').innerHTML = `
    ${art(p)}
    <p style="margin-top:1rem">${esc(p.description)}</p>
    <p style="font:700 1.5rem/1 var(--head)">${money(p.price)}</p>
    ${p.inStock ? `
      <div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap">
        <div class="qty"><button type="button" id="q-minus" aria-label="Fewer">−</button><span id="q-val">1</span><button type="button" id="q-plus" aria-label="More">+</button></div>
        <button class="btn accent" type="button" id="add-btn">Add to cart</button>
      </div>
      ${inCart ? `<p class="small muted" style="margin-top:.6rem">${inCart} already in your cart.</p>` : ''}
      ${p.stockLeft ? `<p class="small" style="color:var(--rose);margin-top:.4rem">Only ${p.stockLeft} left in stock.</p>` : ''}`
    : '<p class="form-error">Sold out. The store owner will restock it soon.</p>'}`;
  if (p.inStock) {
    const show = () => { $('#q-val').textContent = qty; };
    $('#q-minus').addEventListener('click', () => { qty = Math.max(1, qty - 1); show(); });
    $('#q-plus').addEventListener('click', () => { qty = Math.min(max, qty + 1); show(); });
    $('#add-btn').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try {
        await setQty(id, qtyInCart(id) + qty);
        $('#product-dlg').close();
        toast(`Added ${qty} × ${p.name}`);
      } catch (err) { toast(err.message, 'error'); }
    }));
  }
  $('#product-dlg').showModal();
}

/* ───────────── Cart & checkout ───────────── */

async function openCart() {
  await loadCart();
  updateCartCount();
  renderCart();
  if (!$('#cart-dlg').open) $('#cart-dlg').showModal();
}

function renderCart(issues = []) {
  const body = $('#cart-body');
  if (!cart || !cart.items.length) {
    body.innerHTML = '<div class="empty"><h3>Your cart is empty</h3><p>Pick something from the shelves.</p></div>';
    return;
  }
  const allIssues = issues.length ? issues : cart.issues;
  body.innerHTML = `
    ${allIssues.length ? `<div class="form-error">Some items need attention before you can check out.</div>` : ''}
    ${cart.items.map((i) => `
      <div class="cart-line">
        ${art({ name: i.name, imageUrl: i.imageUrl })}
        <div>
          <div class="name">${esc(i.name)}</div>
          <div class="small muted">${money(i.price)} each</div>
          ${i.issue ? `<div class="issue">${esc(cart.issues.find((x) => x.productId === i.productId)?.message || '')}</div>` : ''}
          <div style="margin-top:.4rem;display:flex;gap:.6rem;align-items:center">
            <div class="qty"><button type="button" data-dec="${i.productId}" aria-label="Fewer">−</button><span>${i.quantity}</span><button type="button" data-inc="${i.productId}" aria-label="More">+</button></div>
            <button class="link-btn small" type="button" data-remove="${i.productId}">Remove</button>
          </div>
        </div>
        <b>${money(i.lineTotal)}</b>
      </div>`).join('')}
    <div class="cart-total"><span>Total</span><span>${money(cart.total)}</span></div>
    <p class="small muted">The final total is checked by the store when you place the order.</p>
    <h3 style="margin-top:1.4rem">Delivery details</h3>
    <form id="checkout-form" novalidate>
      <div class="form-error hidden" data-error role="alert"></div>
      <div class="field"><label for="c-name">Full name</label><input id="c-name" name="name" autocomplete="name" data-field="Name" required></div>
      <div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" data-field="Email" required></div>
      <div class="field"><label for="c-phone">Phone <span class="muted small">(optional)</span></label><input id="c-phone" name="phone" type="tel" autocomplete="tel" data-field="Phone"></div>
      <div class="field"><label for="c-addr">Delivery address</label><textarea id="c-addr" name="address" autocomplete="street-address" data-field="Delivery address" required></textarea></div>
      <button class="btn accent block" type="submit" id="place-order">Place order · ${money(cart.total)}</button>
      <p class="small muted" style="margin-top:.6rem">Payment is collected on delivery.</p>
    </form>`;

  const change = (id, q) => async () => {
    try { await setQty(id, q); renderCart(); } catch (e) { toast(e.message, 'error'); await openCart(); }
  };
  $$('[data-inc]').forEach((b) => { const i = cart.items.find((x) => x.productId === +b.dataset.inc); b.addEventListener('click', change(i.productId, i.quantity + 1)); });
  $$('[data-dec]').forEach((b) => { const i = cart.items.find((x) => x.productId === +b.dataset.dec); b.addEventListener('click', change(i.productId, i.quantity - 1)); });
  $$('[data-remove]').forEach((b) => b.addEventListener('click', change(+b.dataset.remove, 0)));

  const form = $('#checkout-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(form, null);
    const customer = formData(form);
    await busy($('#place-order'), async () => {
      try {
        const { order } = await api(`/api/carts/${encodeURIComponent(cart.id)}/checkout`, { method: 'POST', body: { customer } });
        cart = null;
        saveCartId(null);
        $('#cart-dlg').close();
        history.pushState({}, '', `${storeHome}?order=${encodeURIComponent(order.orderNumber)}&email=${encodeURIComponent(order.customer.email)}`);
        renderReceipt(order, true);
      } catch (err) {
        if (err.details?.issues) {
          await loadCart();
          renderCart(err.details.issues);
          // keep what they typed
          const f = $('#checkout-form');
          Object.entries(customer).forEach(([k, v]) => { if (f[k]) f[k].value = v; });
          formError(f, err);
        } else {
          formError(form, err);
        }
      }
    });
  });
}

/* ───────────── Receipt ───────────── */

function renderReceipt(o, fresh = false) {
  updateCartCount();
  $('#sf-main').innerHTML = `
    <article class="receipt">
      <div class="awning" aria-hidden="true"></div>
      <div class="receipt-body">
        <h2>${fresh ? `Thank you, ${esc(o.customer.name.split(' ')[0])}!` : 'Your order'}</h2>
        <p class="muted">Order <b>${esc(o.orderNumber)}</b> · placed ${date(o.createdAt, true)} ·
          <span class="pill ${esc(o.status)}">${esc(o.status)}</span></p>
        <table class="lines"><tbody>${o.items.map((i) => `
          <tr><td>${esc(i.name)}<div class="small muted">${i.quantity} × ${money(i.unitPrice)}</div></td><td class="num">${money(i.lineTotal)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td>Total (pay on delivery)</td><td class="num">${money(o.total)}</td></tr></tfoot></table>
        <p class="small"><b>Delivering to</b><br>${esc(o.customer.address)}</p>
        <p class="small muted">Bookmark this page to check your order status later.</p>
        <a class="btn accent" href="${esc(storeHome)}">Keep shopping</a>
      </div>
    </article>`;
}

/* ───────────── Start ───────────── */

$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
window.addEventListener('popstate', () => location.reload());

(async function start() {
  try {
    ({ store } = await api(`/api/stores/${encodeURIComponent(slug)}`));
  } catch (e) {
    const closed = e.code === 'STORE_INACTIVE';
    document.title = closed ? 'Store closed — Haat' : 'Store not found — Haat';
    app.innerHTML = `<div class="closed">
      <div class="awning" style="--c:${closed ? '#5B6180' : '#B83A55'}" aria-hidden="true"></div>
      <div class="panel" style="border-radius:0 0 10px 10px;padding:2rem 1.4rem">
        <h1 style="font-size:2rem">${closed ? 'This store is closed' : 'No store at this address'}</h1>
        <p class="muted">${closed ? 'It is not taking orders right now. Please check back later.' : 'Check the link, or browse the stores that are open today.'}</p>
        <a class="btn" href="${esc(mainHome)}">See open stores</a>
      </div></div>`;
    return;
  }
  await loadCart();
  shell('');
  const params = new URLSearchParams(location.search);
  if (params.get('order')) {
    try {
      const { order } = await api(`/api/stores/${encodeURIComponent(slug)}/orders/${encodeURIComponent(params.get('order'))}?email=${encodeURIComponent(params.get('email') || '')}`);
      return renderReceipt(order);
    } catch { toast('That order could not be found.', 'error'); }
  }
  renderCatalogue();
})();
