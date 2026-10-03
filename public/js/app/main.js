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
// Marking a ticket "издаден" fills in today's return date (if none is set
// yet), so it's visible and can still be changed before saving.
document.getElementById('f_status').addEventListener('change', (e)=>{
  const returned = document.getElementById('f_date_returned');
  if(e.target.value === COMPLETED_STATUS && !returned.value){
    returned.value = localDateString(new Date());
  }
  // Moving to "отказан" sets Капаро and both prices to 0 (the server does
  // the same); shown here straight away, and still editable before saving.
  if(e.target.value === STATUSES.REFUSED && (!editingTicket || editingTicket.status !== STATUSES.REFUSED)){
    for(const id of ['f_kaparo', 'f_service_price', 'f_customer_price']) document.getElementById(id).value = '0';
  }
});
document.getElementById('f_phone').addEventListener('input', (e)=>{
  document.getElementById('f_phone_call').href = telHref(e.target.value);
  markPhoneField();
});

checkSession();
