/**
 * Demo data. Run `npm run seed` to reset the database to this state.
 * Creates one admin, four tenants (one inactive), their stores, products and orders.
 */
const bcrypt = require('bcryptjs');
const db = require('./db');

const TENANTS = [
  {
    business: 'Cha Ghar Tea Company', owner: 'Rina Das', email: 'rina@chaghar.in',
    store: { name: 'Cha Ghar', slug: 'cha-ghar', accent: '#2F7D5B',
      description: 'Single-estate Darjeeling and Assam teas, packed fresh in Kolkata.' },
    products: [
      ['Darjeeling First Flush 100g', 'Light, floral spring harvest from Makaibari estate.', 450, 24, 'published'],
      ['Assam CTC Strong 250g', 'Bold breakfast tea that stands up to milk and sugar.', 220, 60, 'published'],
      ['Masala Chai Blend 200g', 'Assam tea with cardamom, ginger, clove and cinnamon.', 280, 3, 'published'],
      ['Clay Kulhad Set of 6', 'Hand-thrown terracotta cups for the proper roadside taste.', 360, 0, 'published'],
      ['Darjeeling Second Flush 100g', 'Muscatel notes, deeper colour. Coming soon.', 520, 15, 'draft'],
      ['Green Tea Tulsi 50g', 'Discontinued blend, kept for records.', 190, 8, 'unpublished'],
    ],
  },
  {
    business: 'Matir Kaaj Crafts', owner: 'Sourav Pal', email: 'sourav@matirkaaj.in',
    store: { name: 'Matir Kaaj', slug: 'matir-kaaj', accent: '#B5502A',
      description: 'Terracotta, dokra and kantha work from artisans in Bankura and Bolpur.' },
    products: [
      ['Bankura Horse (Medium)', 'The iconic long-necked terracotta horse, 30 cm.', 850, 7, 'published'],
      ['Dokra Owl Figurine', 'Lost-wax brass casting by Dariyapur artisans.', 1250, 4, 'published'],
      ['Kantha Stitch Cushion Cover', 'Hand-embroidered cotton, 16 × 16 inch.', 640, 18, 'published'],
      ['Terracotta Wall Plate', 'Ramayana panel motif from Bishnupur temples.', 990, 2, 'published'],
      ['Sholapith Durga Mask', 'Pith craft from Murshidabad. Being photographed.', 1800, 5, 'draft'],
    ],
  },
  {
    business: 'Boi Para Books', owner: 'Pallab Sen', email: 'pallab@boipara.in',
    store: { name: 'Boi Para', slug: 'boi-para', accent: '#3A4FA3',
      description: 'Second-hand and new books from College Street, delivered across India.' },
    products: [
      ['Feluda Samagra Vol. 1', 'Satyajit Ray\'s complete Feluda stories, hardcover.', 595, 9, 'published'],
      ['Gitanjali (Bengali)', 'Rabindranath Tagore, Visva-Bharati edition.', 180, 25, 'published'],
      ['Introduction to Algorithms', 'CLRS 3rd edition, used, good condition.', 750, 2, 'published'],
      ['Let Us C', 'Yashavant Kanetkar, 16th edition.', 320, 14, 'published'],
      ['Pather Panchali', 'Bibhutibhushan Bandyopadhyay, paperback.', 220, 0, 'published'],
    ],
  },
  {
    business: 'Shanti Mishti', owner: 'Mitali Ghosh', email: 'mitali@shantimishti.in', inactive: true,
    store: { name: 'Shanti Mishti', slug: 'shanti-mishti', accent: '#C2405A',
      description: 'Nolen gur sandesh and rosogolla from Bagbazar.' },
    products: [['Nolen Gur Sandesh (12 pcs)', 'Winter special made with date-palm jaggery.', 420, 20, 'published']],
  },
];

const ORDERS = [
  // [storeIndex, customer, items: [[productIndex, qty]], status path]
  [0, ['Ananya Roy', 'ananya@example.com', '9830012345', '12 Lake Road, Kolkata 700029'], [[0, 2], [1, 1]], ['confirmed', 'processing', 'shipped', 'delivered']],
  [0, ['Rohit Mondal', 'rohit@example.com', '9123456780', 'Flat 4B, Salt Lake Sector V, Kolkata 700091'], [[2, 1]], ['confirmed']],
  [0, ['Priya Banerjee', 'priya@example.com', '', '45 Hazra Road, Kolkata 700026'], [[1, 3]], []],
  [1, ['Arjun Sharma', 'arjun@example.com', '9876543210', '7 MG Road, Bengaluru 560001'], [[0, 1], [2, 2]], ['confirmed', 'processing']],
  [1, ['Debjani Kar', 'debjani@example.com', '9007001234', '22 Park Street, Kolkata 700016'], [[1, 1]], ['cancelled']],
  [2, ['Sayan Dutta', 'sayan@example.com', '9433011122', 'SVU Hostel, Barrackpore 700121'], [[2, 1], [3, 1]], ['confirmed', 'processing', 'shipped']],
  [2, ['Moumita Saha', 'moumita@example.com', '', '18 Gariahat Road, Kolkata 700019'], [[0, 1]], []],
];

function seed() {
  db.exec(`DELETE FROM order_status_history; DELETE FROM order_items; DELETE FROM orders;
           DELETE FROM cart_items; DELETE FROM carts; DELETE FROM products; DELETE FROM stores;
           DELETE FROM users; DELETE FROM tenants; DELETE FROM sqlite_sequence;`);

  const pw = bcrypt.hashSync('password123', 10);
  const run = db.transaction(() => {
    db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Platform Admin', 'admin@haat.local', ?, 'admin')")
      .run(bcrypt.hashSync('admin1234', 10));

    const storeIds = [];
    const productIds = [];
    TENANTS.forEach((t, i) => {
      const daysAgo = 60 - i * 12;
      const tid = db.prepare(`INSERT INTO tenants (name, status, created_at) VALUES (?, ?, datetime('now', ?))`)
        .run(t.business, t.inactive ? 'inactive' : 'active', `-${daysAgo} days`).lastInsertRowid;
      db.prepare("INSERT INTO users (name, email, password_hash, role, tenant_id) VALUES (?, ?, ?, 'tenant', ?)")
        .run(t.owner, t.email, pw, tid);
      const sid = db.prepare(`INSERT INTO stores (tenant_id, name, slug, description, accent_color, created_at)
                              VALUES (?, ?, ?, ?, ?, datetime('now', ?))`)
        .run(tid, t.store.name, t.store.slug, t.store.description, t.store.accent, `-${daysAgo - 1} days`).lastInsertRowid;
      storeIds.push(sid);
      productIds.push(t.products.map(([name, desc, price, stock, status]) =>
        db.prepare(`INSERT INTO products (store_id, name, description, price_paise, stock, status)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(sid, name, desc, price * 100, stock, status).lastInsertRowid));
    });

    ORDERS.forEach(([si, cust, items, path], n) => {
      const ago = `-${(ORDERS.length - n) * 2} days`;
      const lines = items.map(([pi, qty]) => {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productIds[si][pi]);
        return { p, qty };
      });
      const total = lines.reduce((s, l) => s + l.p.price_paise * l.qty, 0);
      const status = path.length ? path[path.length - 1] : 'pending';
      const oid = db.prepare(`INSERT INTO orders (store_id, order_number, customer_name, customer_email, customer_phone,
                              address, total_paise, status, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`)
        .run(storeIds[si], `HT-DEMO-${String(n + 1).padStart(3, '0')}`, ...cust, total, status, ago, ago).lastInsertRowid;
      for (const l of lines) {
        db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, unit_paise, quantity, line_paise)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(oid, l.p.id, l.p.name, l.p.price_paise, l.qty, l.p.price_paise * l.qty);
      }
      let prev = null;
      for (const s of ['pending', ...path]) {
        db.prepare(`INSERT INTO order_status_history (order_id, from_status, to_status, changed_at)
                    VALUES (?, ?, ?, datetime('now', ?))`).run(oid, prev, s, ago);
        prev = s;
      }
    });
  });
  run();
}

if (require.main === module) {
  seed();
  console.log('Database reset to demo data.');
}

module.exports = { seed };
