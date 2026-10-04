// What happens automatically when an order's status changes — the single
// place these rules are written. Used by the server (creating and editing
// orders, the hourly "забравен" check) and by the order form, which shows
// the result before saving. Настройки lists them (RULES).
//
// Loaded like statuses.js: require() on the server, <script> in the pages
// (as window.STATUS_RULES, after statuses.js).
//
// Orders here use the database's field names (date_returned, kaparo, …).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./statuses'));
  else root.STATUS_RULES = factory(root.STATUSES);
})(typeof self !== 'undefined' ? self : this, function (STATUSES) {
  const FORGET_AFTER_DAYS = 30;

  // Applied when an order enters `status`: created with it, or changed to
  // it from another status. Staff can still change the result afterwards.
  const ON_ENTER = [
    {
      status: STATUSES.COMPLETED,
      text: 'Датата на връщане се попълва с днешна дата, ако е празна.',
      apply(order, { today }) {
        if (!order.date_returned) order.date_returned = today;
      }
    },
    {
      status: STATUSES.REFUSED,
      text: 'Капаро, изкупната и продажната цена стават 0.',
      apply(order) {
        order.kaparo = '0';
        order.service_price = 0;
        order.customer_price = 0;
      }
    }
  ];

  // The order as it should be saved, given how it was (`before`; null for a
  // new order) and how it's being saved (`after`). `today` is YYYY-MM-DD in
  // the shop's time zone. Returns a new object; neither input is changed.
  function applyTransition(before, after, { today }) {
    const next = { ...after };
    if (before && before.status === next.status) return next;
    for (const rule of ON_ENTER) {
      if (rule.status === next.status) rule.apply(next, { today });
    }
    return next;
  }

  // Every rule as text, for Настройки: { status, when, text }.
  const RULES = Object.freeze([
    ...ON_ENTER.map(r => Object.freeze({ status: r.status, when: 'При смяна на статуса', text: r.text })),
    Object.freeze({
      status: STATUSES.FORGOTTEN,
      when: 'Автоматично, всеки час',
      text: `Поръчка в „${STATUSES.WAITING}“ повече от ${FORGET_AFTER_DAYS} дни става „${STATUSES.FORGOTTEN}“.`
    })
  ]);

  return Object.freeze({ applyTransition, RULES, FORGET_AFTER_DAYS });
});
