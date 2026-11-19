// Admin console: platform overview and tenant management.
import { api, money, esc, $, $$, date, toast, pill, formData, formError, busy, icons, wireMobileMenu, logout } from './common.js';

const view = $('#view');
let me = null;
let filter = '';

function renderNav() {
  $('#side-nav').innerHTML = `
    <a class="nav-btn" href="#tenants" aria-current="page">${icons.users}Businesses</a>
    <a class="nav-btn" href="/" target="_blank" rel="noopener">${icons.ext}View marketplace</a>`;
  $('#who').innerHTML = `<b>${esc(me.name)}</b><span>Platform administrator</span>
    <button class="nav-btn" id="logout" type="button" style="margin-top:8px;padding-left:0">${icons.out}Log out</button>`;
  $('#logout').addEventListener('click', logout);
}

async function render() {
  const [{ overview: o }, { tenants }] = await Promise.all([api('/api/admin/overview'), api('/api/admin/tenants')]);
  const shown = filter ? tenants.filter((t) => t.status === filter) : tenants;
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Platform</h1><p>Every business on Haat and whether it is allowed to trade.</p></div>
      <button class="btn" id="add-tenant" type="button">Add business</button>
    </div>
    <div class="stats">
      <div class="stat feature"><div class="label">Sales across all stores</div><div class="value">${money(o.gmv_paise / 100)}</div></div>
      <div class="stat"><div class="label">Businesses</div><div class="value">${o.active_tenants}<span class="muted small"> active of ${o.tenants}</span></div></div>
      <div class="stat"><div class="label">Stores</div><div class="value">${o.stores}</div></div>
      <div class="stat"><div class="label">Live products</div><div class="value">${o.live_products}</div></div>
      <div class="stat"><div class="label">Orders</div><div class="value">${o.orders}</div></div>
    </div>
    <section class="panel">
      <div class="panel-head">
        <div class="tabs" role="group" aria-label="Filter">${[['', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([v, l]) =>
          `<button class="tab" type="button" data-filter="${v}" aria-pressed="${filter === v}">${l}</button>`).join('')}</div>
        <span class="small muted">${shown.length} shown</span>
      </div>
      ${shown.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Business</th><th>Owner</th><th>Store</th><th class="num">Products</th><th class="num">Orders</th><th class="num">Sales</th><th>Status</th><th class="num"></th></tr></thead>
        <tbody>${shown.map((t) => `
          <tr>
            <td><b>${esc(t.name)}</b><div class="small muted">Joined ${date(t.created_at)}</div></td>
            <td>${esc(t.owner_name || '—')}<div class="small muted">${esc(t.owner_email || '')}</div></td>
            <td>${t.store_slug ? `<a href="${esc(t.store_url)}" target="_blank" rel="noopener">${esc(t.store_name)}</a>
                 <div class="small muted">${esc(t.store_url.replace(/^https?:\/\//, ''))}</div>
                 ${t.store_status === 'inactive' ? '<div class="small muted">closed by owner</div>' : ''}`
              : '<span class="muted small">Not set up yet</span>'}</td>
            <td class="num">${t.product_count}</td>
            <td class="num">${t.order_count}</td>
            <td class="num">${money(t.revenue_paise / 100)}</td>
            <td>${pill(t.status)}</td>
            <td class="num">${t.status === 'active'
              ? `<button class="btn ghost sm" type="button" data-toggle="${t.id}" data-to="inactive">Deactivate</button>`
              : `<button class="btn sm" type="button" data-toggle="${t.id}" data-to="active">Activate</button>`}</td>
          </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><h3>No businesses here</h3><p>Try another filter or add a business.</p></div>'}
    </section>
    <p class="small muted">Administrators see totals only. Product and order details stay private to each business.</p>`;

  $('#add-tenant').addEventListener('click', openTenant);
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; render(); }));
  const byId = Object.fromEntries(tenants.map((t) => [t.id, t]));
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleStatus(byId[b.dataset.toggle], b.dataset.to)));
}

function toggleStatus(t, to) {
  const dlg = $('#status-dlg');
  const off = to === 'inactive';
  $('#status-title').textContent = off ? `Deactivate ${t.name}?` : `Activate ${t.name}?`;
  $('#status-text').textContent = off
    ? 'The owner will be logged out of their dashboard and their store will stop taking orders. Their data is kept and you can activate them again later.'
    : 'The owner can log in again and their store will be open to shoppers (unless they closed it themselves).';
  const ok = $('#status-ok');
  ok.textContent = off ? 'Deactivate' : 'Activate';
  ok.className = `btn ${off ? 'danger' : ''}`;
  ok.onclick = () => busy(ok, async () => {
    try {
      await api(`/api/admin/tenants/${t.id}/status`, { method: 'PATCH', body: { status: to } });
      dlg.close();
      toast(off ? `${t.name} deactivated` : `${t.name} activated`);
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
  dlg.showModal();
}

const tenantDlg = $('#tenant-dlg');
const tenantForm = $('#tenant-form');
/** A readable random password without look-alike characters (0/O, 1/l/I). */
function makePassword(len = 12) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
const pwInput = $('#t-pw');
const pwShow = $('#pw-show');
function showPassword(on) {
  pwInput.type = on ? 'text' : 'password';
  pwShow.textContent = on ? 'Hide' : 'Show';
  pwShow.setAttribute('aria-pressed', String(on));
}
pwShow.addEventListener('click', () => showPassword(pwInput.type === 'password'));
$('#pw-gen').addEventListener('click', () => { pwInput.value = makePassword(); showPassword(true); pwInput.focus(); pwInput.select(); });

function openTenant() {
  tenantForm.reset();
  showPassword(false);
  formError(tenantForm, null);
  tenantDlg.showModal();
  tenantForm.businessName.focus();
}
tenantForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await busy($('#tenant-save'), async () => {
    try {
      const { tenant } = await api('/api/admin/tenants', { method: 'POST', body: formData(tenantForm) });
      tenantDlg.close();
      toast(`${tenant.name} added`);
      render();
    } catch (err) { formError(tenantForm, err); }
  });
});

$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

(async function start() {
  wireMobileMenu();
  try {
    ({ user: me } = await api('/api/auth/me'));
  } catch { location.href = '/login'; return; }
  if (me.role !== 'admin') { location.href = '/dashboard'; return; }
  renderNav();
  render();
})();
