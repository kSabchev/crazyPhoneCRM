// Main page: wires up the remaining buttons and starts the app. Loaded last.

// ---------- Wire up ----------
document.getElementById('newTicketBtn').addEventListener('click', openNew);
// The ticket modal has the same buttons at the top and bottom; both sets
// are wired by their data-action.
const MODAL_ACTIONS = {
  'cancel': closeModal,
  'save': saveTicket,
  'delete': deleteTicket,
  'print-customer': ()=>printCopy('customer'),
  'print-service': ()=>printCopy('service')
};
document.querySelectorAll('#overlay [data-action]').forEach(btn=>{
  btn.addEventListener('click', MODAL_ACTIONS[btn.dataset.action]);
});
document.getElementById('overlay').addEventListener('click', (e)=>{ if(e.target.id==='overlay') closeModal(); });
document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('statusFilter').addEventListener('change', render);
// Choosing a status shows what the status rules will do (status-rules.js,
// the same rules the server applies on saving) — e.g. "издаден" fills in
// today's return date, "отказан" zeroes the amounts. Still editable.
const RULE_FIELDS = {
  date_returned: { id: 'f_date_returned', show: v => v || '' },
  kaparo: { id: 'f_kaparo', show: v => v ?? '' },
  service_price: { id: 'f_service_price', show: priceForInput },
  customer_price: { id: 'f_customer_price', show: priceForInput }
};
document.getElementById('f_status').addEventListener('change', (e)=>{
  const form = { status: e.target.value };
  for(const [field, { id }] of Object.entries(RULE_FIELDS)) form[field] = document.getElementById(id).value;
  const next = STATUS_RULES.applyTransition(editingTicket, form, { today: localDateString(new Date()) });
  for(const [field, { id, show }] of Object.entries(RULE_FIELDS)){
    if(next[field] !== form[field]) document.getElementById(id).value = show(next[field]);
  }
});
document.getElementById('f_phone').addEventListener('input', (e)=>{
  document.getElementById('f_phone_call').href = telHref(e.target.value);
  markPhoneField();
});

checkSession();
