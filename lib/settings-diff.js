// @ts-check
// What changed between two versions of the settings, for the admin log:
//   texts     { from, to }
//   lists     { added: [...], removed: [...], reordered: true? }
//   colours   { <status>: { from, to } }
// Only what changed is included; an empty object means nothing did.

const TEXT_KEYS = ['shopName', 'shopTagline', 'phone', 'smsTemplate'];
const LIST_KEYS = ['statuses', 'columns', 'devices'];

/** @param {string[]} before @param {string[]} after */
function listDiff(before = [], after = []) {
  const added = after.filter(x => !before.includes(x));
  const removed = before.filter(x => !after.includes(x));
  const kept = before.filter(x => after.includes(x));
  const reordered = !added.length && !removed.length && kept.join('\n') !== after.join('\n');
  if (!added.length && !removed.length && !reordered) return null;
  return { added, removed, ...(reordered ? { reordered: true } : {}) };
}

/** @param {Record<string, any>} before @param {Record<string, any>} after */
function diffSettings(before, after) {
  /** @type {Record<string, any>} */
  const changes = {};
  for (const key of TEXT_KEYS) {
    const from = before[key] ?? '';
    const to = after[key] ?? '';
    if (from !== to) changes[key] = { from, to };
  }
  const footerFrom = (before.printCustomer || {}).footer ?? '';
  const footerTo = (after.printCustomer || {}).footer ?? '';
  if (footerFrom !== footerTo) changes.printFooter = { from: footerFrom, to: footerTo };

  for (const key of LIST_KEYS) {
    const d = listDiff(before[key], after[key]);
    if (d) changes[key] = d;
  }

  const colours = {};
  const fromColours = before.statusColors || {};
  const toColours = after.statusColors || {};
  // Only statuses that exist on both sides: a new or removed status shows
  // in `statuses` already.
  for (const status of Object.keys(toColours)) {
    if (status in fromColours && fromColours[status] !== toColours[status]) {
      colours[status] = { from: fromColours[status], to: toColours[status] };
    }
  }
  if (Object.keys(colours).length) changes.statusColors = colours;
  return changes;
}

module.exports = { diffSettings, listDiff };
