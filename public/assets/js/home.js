import { api, esc, $ } from './common.js';

async function loadStores() {
  const box = $('#stalls');
  try {
    const { stores } = await api('/api/stores');
    $('#store-count').textContent = `${stores.length} ${stores.length === 1 ? 'store' : 'stores'}`;
    if (!stores.length) {
      box.innerHTML = '<p class="muted">No stores are open yet. <a href="/register">Open the first one.</a></p>';
      return;
    }
    box.innerHTML = stores.map((s, i) => `
      <a class="stall" href="${esc(s.url)}" style="--accent:${esc(s.accentColor)}; --i:${i}">
        <div class="awning" aria-hidden="true"></div>
        <div class="stall-body">
          <h3>${esc(s.name)}</h3>
          <p>${esc(s.description || 'A new store on Haat.')}</p>
          <p class="stall-url">${esc(s.url.replace(/^https?:\/\//, ''))}</p>
          <div class="stall-foot">
            <span class="muted">${s.productCount} ${s.productCount === 1 ? 'product' : 'products'}</span>
            <strong>Visit store</strong>
          </div>
        </div>
      </a>`).join('');
  } catch (e) {
    box.innerHTML = `<p class="muted">Could not load stores: ${esc(e.message)}</p>`;
  }
}

async function nav() {
  try {
    const { user } = await api('/api/auth/me');
    $('#nav').innerHTML = `<a class="btn sm" href="${user.role === 'admin' ? '/admin' : '/dashboard'}">
      ${user.role === 'admin' ? 'Admin console' : 'My dashboard'}</a>`;
  } catch { /* not logged in: keep default links */ }
}

loadStores();
nav();
