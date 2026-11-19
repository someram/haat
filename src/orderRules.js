/**
 * Order status state machine (spec §12).
 *
 *   pending → confirmed → processing → shipped → delivered
 *      │          │            │
 *      └──────────┴────────────┴──→ cancelled
 *
 * "delivered" and "cancelled" are final. Anything not listed here is rejected,
 * so a cancelled order can never become shipped.
 */
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

const ORDER_STATUSES = Object.keys(TRANSITIONS);

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function nextStatuses(from) {
  return TRANSITIONS[from] || [];
}

/** Product lifecycle (spec §7). Draft can be published; published/unpublished can swap. */
const PRODUCT_STATUSES = ['draft', 'published', 'unpublished'];

module.exports = { TRANSITIONS, ORDER_STATUSES, PRODUCT_STATUSES, canTransition, nextStatuses };
