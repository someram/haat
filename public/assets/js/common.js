// Shared helpers used by every page.

/** Calls the JSON API. Throws an Error with .code, .status and .details on failure. */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.error?.code;
    err.details = data.error?.details;
    throw err;
  }
  return data;
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const money = (n) => inr.format(n);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function date(s, withTime = false) {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-IN', withTime
    ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function toast(message, type = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

/** Picks a pleasant tile colour from the product name, tinted towards the store accent. */
const TILE_COLOURS = ['#2F4BA8', '#2F7D5B', '#B5502A', '#7A4BA8', '#2F7FA8', '#A8742F', '#B83A55', '#4F6B2F'];
export function tileColour(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLOURS[h % TILE_COLOURS.length];
}

/** Product image, or a coloured monogram tile when there's no image. */
export function art(p, extra = '') {
  const initials = String(p.name).split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('');
  const sold = p.inStock === false || p.stock === 0 ? ' sold' : '';
  const inner = p.imageUrl
    ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy">`
    : `<div class="mono" style="--tile:${tileColour(p.name)}" aria-hidden="true">${esc(initials)}</div>`;
  return `<div class="art${sold} ${extra}">${inner}</div>`;
}

export const pill = (status) => `<span class="pill ${esc(status)}">${esc(status)}</span>`;

/** Reads a form into a plain object. */
export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/** Shows an error inside a form (element with [data-error]). */
export function formError(form, err) {
  const box = form.querySelector('[data-error]');
  if (!box) return toast(err.message, 'error');
  if (!err) { box.classList.add('hidden'); return; }
  box.textContent = err.message;
  box.classList.remove('hidden');
  const field = err.details?.field;
  if (field) {
    const input = [...form.elements].find((el) => el.dataset.field === field);
    input?.focus();
  }
}

/** Disables a button while an async action runs. */
export async function busy(button, fn) {
  const label = button?.textContent;
  if (button) { button.disabled = true; }
  try { return await fn(); } finally {
    if (button) { button.disabled = false; button.textContent = label; }
  }
}

export const icons = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4"/></svg>',
  shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l2-5h14l2 5M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13v8h14v-8"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

/** Mobile sidebar toggle for console pages. */
export function wireMobileMenu() {
  const side = $('.side');
  $('#menu-btn')?.addEventListener('click', () => side.classList.toggle('open'));
  side?.addEventListener('click', (e) => { if (e.target.closest('.nav-btn')) side.classList.remove('open'); });
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/login';
}
