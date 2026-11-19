# Haat — Multi-Tenant E-Commerce Platform

Final year project, B.Tech / B.Sc. Computer Science, Swami Vivekananda University.

**Haat** (Bengali for a village market where many sellers each run their own stall) is a website where
many independent businesses ("tenants") open their own online store on one shared application.
Each store has its own products, stock and orders, and no tenant can ever see or change another tenant's data.

| Who | What they can do |
|---|---|
| **Administrator** | Add businesses, activate / deactivate them, see platform totals |
| **Store owner (tenant)** | Create a store, add / edit / delete / publish products, manage stock, process orders |
| **Shopper** | Browse one store, add to cart, check out (cash on delivery) |

---

## 1. Requirements

- **Node.js 22 LTS or newer** — download from <https://nodejs.org> (choose "LTS").
  Check with `node --version`.
- Any modern browser (Chrome, Edge, Firefox).
- No separate database install is needed. SQLite is a file inside the project.

## 2. Run it

Open a terminal (Command Prompt / PowerShell on Windows) in this folder and run:

```bash
npm install      # first time only, downloads dependencies
npm start        # starts the website
```

Then open **http://localhost:3000** in your browser.

On the first start the database is filled with demo data. Demo logins (also shown on the login page — click to fill):

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@haat.local` | `admin1234` |
| Tenant — Cha Ghar (tea) | `rina@chaghar.in` | `password123` |
| Tenant — Matir Kaaj (crafts) | `sourav@matirkaaj.in` | `password123` |
| Tenant — Boi Para (books) | `pallab@boipara.in` | `password123` |
| Tenant — Shanti Mishti (**deactivated**) | `mitali@shantimishti.in` | `password123` |

Other commands:

```bash
npm test         # runs 35 automated tests of the business rules
npm run seed     # resets the database to the demo data
npm run dev      # starts with auto-restart when you edit code
```

To use a different port: `PORT=4000 npm start` (Windows PowerShell: `$env:PORT=4000; npm start`).

## 3. Demo script for the viva

1. **Home page** — shows the open stores as market stalls. Shanti Mishti is missing because the admin deactivated it.
2. **Shop** — open *Matir Kaaj*, add a product to the cart, check out. Note the order number.
3. **Tenant** — log in as `sourav@matirkaaj.in`. The new order is on the Overview. Open it, click *Confirm order*.
   Only the allowed next steps are shown.
4. **Products** — add a product (it starts as a draft and is not in the store), publish it, see it appear in the store.
5. **Isolation** — while logged in as Sourav, try `http://localhost:3000/api/my/products/1` (product 1 belongs to Cha Ghar).
   You get **404 Product not found**: the server does not even admit it exists.
6. **Admin** — log in as `admin@haat.local`, deactivate *Boi Para*, then open `http://localhost:3000/s/boi-para`:
   the store shows as closed and Pallab can no longer log in. Activate it again.
7. **Sub-domains** — on the home page, click a store: it opens on its own address, e.g. `http://matir-kaaj.localhost:3000`.
   Register a new business and create a store: its address is live at once.
8. **Tests** — run `npm test` and show 35 passing tests.

## 4. Project structure

```
haat/
├── server.js                 entry point (seeds demo data on first run, starts the server)
├── src/
│   ├── app.js                Express app: security headers, routes, static pages
│   ├── db.js                 SQLite schema (tables, constraints, indexes)
│   ├── auth.js               authenticate / requireAdmin / requireTenant middleware, JWT cookie
│   ├── orderRules.js         order status state machine
│   ├── validate.js           input validation helpers
│   ├── errors.js             consistent error format, safe error handler
│   ├── serialize.js          database rows → API JSON
│   ├── seed.js               demo data
│   └── routes/
│       ├── auth.js           /api/auth/*      register, login, logout, me
│       ├── admin.js          /api/admin/*     tenants, overview
│       ├── tenant.js         /api/my/*        store, products, orders of the logged-in tenant
│       └── public.js         /api/stores/*, /api/carts/*   storefront, cart, checkout
├── public/                   website (HTML, CSS, JavaScript — no framework)
│   ├── index.html            marketplace home
│   ├── login.html, register.html
│   ├── dashboard.html        store owner dashboard
│   ├── admin.html            administrator console
│   ├── store.html            public storefront at /s/<store-address>
│   └── assets/css, assets/js
├── tests/api.test.js         automated tests (Node's built-in test runner)
└── data/                     created at runtime: haat.db (database) and the session secret
```

## 5. How tenant isolation works

Every protected request goes through the same pipeline:

```
Request → authenticate (JWT cookie) → load user, tenant and store from the DATABASE
        → check role and that the tenant is active → run the query filtered by that store_id
```

- Tenant URLs (`/api/my/...`) contain **no tenant id or store id at all**. The store always comes from the
  logged-in user, so a client cannot ask for someone else's store.
- Any `storeId` / `tenantId` sent in a request body is ignored.
- Every product and order query includes `AND store_id = ?`. Another tenant's record returns **404**, not 403,
  so its existence is not revealed.
- The JWT only stores the user id. Role and tenant status are re-read from the database on every request,
  so deactivating a tenant takes effect immediately.

## 6. Key business rules and where they live

| Rule | Code |
|---|---|
| One store per tenant | `stores.tenant_id UNIQUE` in `db.js` |
| Only published products are public | `status = 'published'` in every query in `routes/public.js` |
| Cart belongs to one store | `PUT /api/carts/:id/items/:pid` checks `product.store_id = cart.store_id` |
| Stock checked & deducted atomically | `checkout` transaction: `UPDATE … SET stock = stock - ? WHERE stock >= ?` |
| Stock can never be negative | `CHECK (stock >= 0)` |
| Server calculates the total | checkout ignores any client total and sums live prices |
| Price at time of purchase kept | `order_items.unit_paise`, `product_name` snapshot |
| Price change blocks checkout until reviewed | `PRICE_CHANGED` 409 in `routes/public.js` |
| Valid order status changes only | `orderRules.js` state machine |
| Cancelling restocks | `PATCH /api/my/orders/:id/status` |
| Inactive tenant can't operate | `requireTenant` + `assertOpen` |

## 7. API reference

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/register` | public — create tenant account |
| POST | `/api/auth/login` · `/api/auth/logout` | public |
| GET | `/api/auth/me` | logged in |
| GET | `/api/admin/overview` | admin |
| GET / POST | `/api/admin/tenants` | admin |
| GET | `/api/admin/tenants/:id` | admin |
| PATCH | `/api/admin/tenants/:id/status` | admin |
| GET | `/api/my/overview` | tenant |
| GET / POST / PATCH | `/api/my/store` | tenant |
| GET / POST | `/api/my/products` | tenant |
| GET / PATCH / DELETE | `/api/my/products/:id` | tenant |
| POST | `/api/my/products/:id/publish` · `/unpublish` | tenant |
| GET | `/api/my/orders` · `/api/my/orders/:id` | tenant |
| PATCH | `/api/my/orders/:id/status` | tenant |
| GET | `/api/stores` · `/api/stores/:slug` | public |
| GET | `/api/stores/:slug/products` · `/:id` | public |
| POST | `/api/stores/:slug/carts` | public |
| GET | `/api/carts/:cartId` | public (cart token) |
| PUT / DELETE | `/api/carts/:cartId/items/:productId` | public (cart token) |
| POST | `/api/carts/:cartId/checkout` | public (cart token) |
| GET | `/api/stores/:slug/orders/:orderNumber?email=` | shopper receipt |

Errors always look like `{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Only 2 left in stock." } }`.

## 8. Technology

Node.js · Express 5 · SQLite (better-sqlite3) · bcryptjs (password hashing) · jsonwebtoken (sessions) ·
plain HTML/CSS/JavaScript (ES modules) · Node test runner.

## 9. Troubleshooting

- **`npm install` fails on `better-sqlite3`** — make sure you use Node 22 LTS. On Windows, if it still fails,
  install "Desktop development with C++" from Visual Studio Build Tools, then run `npm install` again.
- **Port 3000 already in use** — run on another port (see section 2).
- **Want a clean start** — stop the server and run `npm run seed`, or delete the `data` folder.

## 10. Vendor sub-domains

Every store is served on its own sub-domain, made from its **store address**:

| Store address | Store opens at (laptop) | Store opens at (online, `APP_DOMAIN=haat.in`) |
|---|---|---|
| `cha-ghar` | `http://cha-ghar.localhost:3000` | `https://cha-ghar.haat.in` |
| `kolkata-kitchen` (new vendor) | `http://kolkata-kitchen.localhost:3000` | `https://kolkata-kitchen.haat.in` |

- A new vendor's store is live on its sub-domain **as soon as the store is created**; nothing has to be
  set up per store. Changing the store address in *Store settings* moves the sub-domain.
- Names the platform needs (`www`, `admin`, `api`, `login`, `mail`, …) cannot be used as store addresses.
- The sub-domain only chooses which **public** store is shown. Owner and admin pages and their APIs work
  only on the main domain; on a store sub-domain they redirect or answer 404.
- The old address `/s/<store-address>` still works.

**On a laptop** nothing needs configuring: Chrome, Edge and Firefox send every `*.localhost` name to your
own computer.

**Online** you need your own domain and two DNS records pointing at the server: one for `haat.in` and a
wildcard record for `*.haat.in` (plus an HTTPS certificate that covers `*.haat.in`). Then set
`APP_DOMAIN=haat.in` and `TRUST_PROXY=1`. Without `APP_DOMAIN`, the online site falls back to
`/s/<store-address>` links.

## 11. Put it online (free)

The project includes `render.yaml`, so it deploys to [Render](https://render.com) in a few clicks:

1. Upload this folder to a GitHub repository (without `node_modules` and `data`).
2. On Render, sign in with GitHub → **New** → **Blueprint** → choose the repository → **Apply**.
3. After the build (3–5 minutes) Render shows a link like `https://haat-xxxx.onrender.com`.

On the free plan the site sleeps after 15 minutes without visitors, so open it a minute before your viva.
Each restart resets the database to the demo data.
