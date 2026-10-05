// @ts-check
// The built-in ("system") order statuses — the single place their names are
// written. Loaded by the server (require) and by the pages (<script>, as
// window.STATUSES), so every feature agrees on them.
//
// These statuses drive behaviour, so they can't be removed in Settings
// (they can be reordered and recoloured; shops can add their own):
//   WAITING    SMS to the customer is offered; becomes FORGOTTEN after 30 days
//   COMPLETED  return date filled in; counts as handed back in reports
//   REFUSED    Капаро and both prices set to 0
//   COMPLETED, REFUSED, FORGOTTEN are "closed": not open work
// The automatic changes themselves are written in status-rules.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.STATUSES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const S = {
    FOR_SERVICE: 'за сервиз',
    IN_SERVICE: 'в сервиз',
    WAITING: 'чака клиент',
    COMPLETED: 'издаден',
    REFUSED: 'отказан',
    FORGOTTEN: 'забравен'
  };
  return Object.freeze({
    ...S,
    // Default order, as shown in the dropdowns.
    SYSTEM: Object.freeze([S.FOR_SERVICE, S.IN_SERVICE, S.WAITING, S.COMPLETED, S.REFUSED, S.FORGOTTEN]),
    CLOSED: Object.freeze([S.COMPLETED, S.REFUSED, S.FORGOTTEN]),
    // Shown in Settings next to the lock: why this status can't be removed.
    PURPOSE: Object.freeze({
      [S.FOR_SERVICE]: 'началният статус на нова поръчка',
      [S.IN_SERVICE]: 'поръчка в ремонт',
      [S.WAITING]: 'предлага SMS до клиента; след 30 дни става „забравен“',
      [S.COMPLETED]: 'попълва датата на връщане; брои се като издадена в справките',
      [S.REFUSED]: 'нулира Капаро и цените',
      [S.FORGOTTEN]: 'поставя се автоматично след 30 дни „чака клиент“'
    })
  });
});
