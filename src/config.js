/**
 * Settings read from environment variables, with defaults that work on a laptop.
 *
 *   APP_DOMAIN    main domain of the platform. Every store is served on its own
 *                 sub-domain <store-address>.APP_DOMAIN.
 *                 Default: localhost:<PORT>, so stores are e.g. http://cha-ghar.localhost:3000
 *                 (modern browsers send every *.localhost name to this computer).
 *   APP_PROTOCOL  http or https (default http; https when NODE_ENV=production)
 *   TRUST_PROXY   set to 1 behind a hosting proxy, so the original Host header is used
 */
const port = Number(process.env.PORT) || 3000;

const appDomain = (process.env.APP_DOMAIN || `localhost:${port}`)
  .toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

const config = {
  port,
  appDomain,                              // "haat.in" or "localhost:3000"
  appHost: appDomain.split(':')[0],       // host name without the port
  protocol: process.env.APP_PROTOCOL || (process.env.NODE_ENV === 'production' ? 'https' : 'http'),
  trustProxy: process.env.TRUST_PROXY === '1',
};

// Sub-domains need a real domain with a wildcard DNS record (*.haat.in). On a laptop
// *.localhost works by itself. In production without APP_DOMAIN, fall back to /s/<address>.
config.subdomains = Boolean(process.env.APP_DOMAIN) || process.env.NODE_ENV !== 'production';

config.mainUrl = config.subdomains ? `${config.protocol}://${config.appDomain}` : '';
/** Public address of a store: its own sub-domain, or /s/<address> when sub-domains are off. */
config.storeUrl = (slug) => (config.subdomains
  ? `${config.protocol}://${slug}.${config.appDomain}`
  : `/s/${encodeURIComponent(slug)}`);

/** Names that can never be a store address, because the platform needs them as sub-domains. */
config.reservedSlugs = new Set([
  'www', 'api', 'app', 'admin', 'administrator', 'dashboard', 'login', 'logout', 'register', 'signup',
  'account', 'accounts', 'auth', 'mail', 'email', 'smtp', 'imap', 'ftp', 'static', 'assets', 'cdn', 'media',
  'images', 'img', 'files', 'help', 'support', 'status', 'blog', 'docs', 'dev', 'test', 'staging',
  'haat', 'shop', 'shops', 'store', 'stores', 'pay', 'payment', 'payments', 'billing', 'checkout',
  'webhook', 'webhooks', 'root', 'system', 'localhost', 'ns1', 'ns2',
]);

module.exports = config;
