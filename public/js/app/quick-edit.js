// Main page: editing one cell from the table (Парола, Коментар, prices…).

// ---------- Quick editor (Парола, Коментар, Извършен ремонт, prices) ----------
// Clicking one of these cells edits just that field in a small window,
// without opening the whole order. Saves only that field, so it can't
// overwrite anything else a colleague changed meanwhile.
//   kind 'text'  — multi-line (Ctrl+Enter saves)
//   kind 'line'  — single line (Enter saves)
//   kind 'price' — amount in €, empty = no price (Enter saves)
const QUICK_EDIT_FIELDS = {
  comment: { kind: 'text', title: 'Коментар', column: 'comment', placeholder: 'Допълнителни бележки...', error: 'Коментарът не можа да бъде запазен.' },
  repairPerformed: { kind: 'text', title: 'Извършен ремонт', column: 'repair_performed', placeholder: 'Какво беше извършено при ремонта...', error: 'Извършеният ремонт не можа да бъде запазен.' },
  phonePassword: { kind: 'line', title: 'Парола', column: 'phone_password', placeholder: 'напр. 1234 или Г-образен шаблон', error: 'Паролата не можа да бъде запазена.' },
  servicePrice: { kind: 'price', title: 'Изкупна цена (€)', column: 'service_price', placeholder: '0,00 — празно = без цена', error: 'Изкупната цена не можа да бъде запазена.' },
  customerPrice: { kind: 'price', title: 'Продажна цена (€)', column: 'customer_price', placeholder: '0,00 — празно = без цена', error: 'Продажната цена не можа да бъде запазена.' }
};
let quickEdit = null; // { id, field }

const quickEditInputFor = cfg => document.getElementById(cfg.kind === 'text' ? 'quickEditInput' : 'quickEditLine');

function openQuickEdit(e, id, field){
  e.stopPropagation();
  const t = tickets.find(x=>x.id===id);
  const cfg = QUICK_EDIT_FIELDS[field];
  if(!t || !cfg) return;
  quickEdit = { id, field };
  document.getElementById('quickEditTitle').textContent = cfg.title;
  document.getElementById('quickEditSub').textContent = `Поръчка #${t.ticket_no} — ${t.customer_name}, ${t.phone_model}`;
  document.getElementById('quickEditHint').textContent = cfg.kind === 'text'
    ? 'Ctrl+Enter запазва, Esc затваря' : 'Enter запазва, Esc затваря';

  const area = document.getElementById('quickEditInput');
  const line = document.getElementById('quickEditLine');
  area.style.display = cfg.kind === 'text' ? '' : 'none';
  line.style.display = cfg.kind === 'text' ? 'none' : '';
  const input = quickEditInputFor(cfg);
  // Prices: a plain text field with a numeric keyboard on phones — no
  // up/down arrows, no mouse-wheel changes, and "25,50" works as typed.
  line.inputMode = cfg.kind === 'price' ? 'decimal' : 'text';
  line.classList.toggle('price-input', cfg.kind === 'price');
  input.placeholder = cfg.placeholder;
  const current = t[cfg.column];
  input.value = cfg.kind === 'price' ? priceForInput(current) : (current === null || current === undefined ? '' : current);
  document.getElementById('quickEditOverlay').classList.add('open');
  input.focus();
  if(cfg.kind === 'price') input.select();
  else input.setSelectionRange(input.value.length, input.value.length);
}

function closeQuickEdit(){
  document.getElementById('quickEditOverlay').classList.remove('open');
  quickEdit = null;
}

async function saveQuickEdit(){
  if(!quickEdit) return;
  const { id, field } = quickEdit;
  const cfg = QUICK_EDIT_FIELDS[field];
  const input = quickEditInputFor(cfg);
  if(cfg.kind === 'price' && !PRICE_INPUT.test(input.value)){
    alert(`${cfg.title.replace(' (€)', '')}: невалидна сума — въведете число, напр. 25,50, или оставете празно.`);
    return;
  }
  const res = await fetch(`/api/tickets/${id}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ [field]: input.value.trim() })
  });
  if(res.status === 401){ closeQuickEdit(); showLogin(); return; }
  if(!res.ok){
    const data = await res.json().catch(()=>({}));
    alert(data.error || QUICK_EDIT_FIELDS[field].error);
    return;
  }
  closeQuickEdit();
  loadTickets();
}

document.getElementById('quickEditSaveBtn').addEventListener('click', saveQuickEdit);
document.getElementById('quickEditCancelBtn').addEventListener('click', closeQuickEdit);
document.getElementById('quickEditOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'quickEditOverlay') closeQuickEdit();
});
document.getElementById('quickEditInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') closeQuickEdit();
  if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); saveQuickEdit(); }
});
document.getElementById('quickEditLine').addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') closeQuickEdit();
  if(e.key === 'Enter'){ e.preventDefault(); saveQuickEdit(); }
});

document.getElementById('activityOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'activityOverlay') document.getElementById('activityOverlay').classList.remove('open');
});
