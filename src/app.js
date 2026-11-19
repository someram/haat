/** Builds the Express application (kept separate from server.js so tests can import it). */
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { errorHandler, errors } = require('./errors');
const { router: authRoutes } = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const tenantRoutes = require('./routes/tenant');
const publicRoutes = require('./routes/public');
const config = require('./config');
const db = require('./db');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  const pub = path.join(__dirname, '..', 'public');

  // Basic security headers.
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': [
        "default-src 'self'",
        "img-src 'self' https: data:",
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
        "font-src https://fonts.gstatic.com",
        "script-src 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    next();
  });

  // ── Vendor sub-domains ──
  // <store-address>.APP_DOMAIN shows that store. The sub-domain only chooses which
  // PUBLIC store is shown; it never grants access to anything. Owner and admin pages and
  // their APIs live only on the main domain, where the login cookie is set.
  const findSlug = db.prepare('SELECT 1 FROM stores WHERE slug = ?');
  app.use((req, res, next) => {
    if (!config.subdomains) return next();
    const host = (req.hostname || '').toLowerCase();
    const base = config.appHost;
    if (!host.endsWith(`.${base}`)) return next();
    const sub = host.slice(0, -(base.length + 1));
    if (sub === 'www') return res.redirect(301, config.mainUrl + req.originalUrl);
    if (sub.includes('.')) return res.redirect(302, config.mainUrl + '/');
    req.storeSlug = sub;
    if (/^\/api\/(my|admin|auth)(\/|$)/.test(req.path)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not available on a store address.' } });
    }
    if (/^\/(dashboard|admin|login|register)(\.html)?$/.test(req.path)) {
      return res.redirect(302, config.mainUrl + req.originalUrl);
    }
    if (req.path === '/' || req.path === '/index.html') {
      // Unknown store: the store page itself shows "No store at this address".
      if (!findSlug.get(sub)) return res.status(404).sendFile(path.join(pub, 'store.html'));
      return res.sendFile(path.join(pub, 'store.html'));
    }
    next();
  });


  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // ── API ──
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/my', tenantRoutes);
  app.use('/api', publicRoutes);
  app.use('/api', (_req, _res, next) => next(errors.notFound('API route')));

  // ── Pages ──
  app.use(express.static(pub, { extensions: ['html'] }));
  app.get('/s/:slug', (_req, res) => res.sendFile(path.join(pub, 'store.html')));
  app.use((_req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
