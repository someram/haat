/** Converts database rows into API objects (paise → rupees, snake_case → camelCase). */
const { nextStatuses } = require('./orderRules');
const config = require('./config');

const rupees = (paise) => Math.round(paise) / 100;

function store(s) {
  if (!s) return null;
  return {
    id: s.id, name: s.name, slug: s.slug, description: s.description,
    accentColor: s.accent_color, status: s.status, createdAt: s.created_at,
    url: config.storeUrl(s.slug),   // the store's own sub-domain
  };
}

/** Full product, for the owner's dashboard. */
function product(p) {
  return {
    id: p.id, name: p.name, description: p.description, price: rupees(p.price_paise),
    imageUrl: p.image_url, stock: p.stock, status: p.status,
    createdAt: p.created_at, updatedAt: p.updated_at,
  };
}

/** Public product, for shoppers: hides internal status and exact stock beyond "low". */
function publicProduct(p) {
  return {
    id: p.id, name: p.name, description: p.description, price: rupees(p.price_paise),
    imageUrl: p.image_url, inStock: p.stock > 0, stockLeft: p.stock <= 5 ? p.stock : null,
  };
}

function order(o, items, history) {
  const out = {
    id: o.id, orderNumber: o.order_number, status: o.status, total: rupees(o.total_paise),
    customer: { name: o.customer_name, email: o.customer_email, phone: o.customer_phone, address: o.address },
    createdAt: o.created_at, updatedAt: o.updated_at, nextStatuses: nextStatuses(o.status),
  };
  if (o.item_count !== undefined) out.itemCount = o.item_count;
  if (items) {
    out.items = items.map((i) => ({
      productId: i.product_id, name: i.product_name, unitPrice: rupees(i.unit_paise),
      quantity: i.quantity, lineTotal: rupees(i.line_paise),
    }));
  }
  if (history) {
    out.history = history.map((h) => ({ from: h.from_status, to: h.to_status, at: h.changed_at }));
  }
  return out;
}

module.exports = { rupees, store, product, publicProduct, order };
