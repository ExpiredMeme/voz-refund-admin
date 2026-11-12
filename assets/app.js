'use strict';
const $ = id => document.getElementById(id);
const state = { offset: 0, limit: 25, refunds: [], selected: null };
const str = v => v == null || v === '' ? '—' : String(v);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; };
const line = (parent, label, value) => { parent.append(el('dt', label), el('dd', str(value))); };
function section(parent, title) { parent.append(el('h3', title)); }
function info(parent, fields) { const dl = el('dl', null, 'kv'); for (const [k,v] of fields) line(dl,k,v); parent.append(dl); }
async function api(path) { const r = await fetch('/api/' + path, { credentials:'same-origin', headers: { Accept:'application/json' }, cache:'no-store' }); let data; try { data = await r.json(); } catch { throw new Error('Invalid response from server'); } if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`); return data; }
async function apiPost(path, payload) {
  const r = await fetch('/api/' + path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let data;
  try { data = await r.json(); } catch { throw new Error('Invalid response from server'); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
function actionButton(label, action, payloadBuilder, className = 'outline') {
  const button = el('button', label, className); button.type = 'button';
  button.addEventListener('click', async () => {
    const id = state.selected;
    if (!id || button.disabled) return;
    const payload = payloadBuilder();
    if (payload === null) return;
    const controls = $('admin-actions');
    const buttons = controls.querySelectorAll('button');
    buttons.forEach(b => b.disabled = true);
    setError('detail-error', '');
    try {
      await apiPost('refunds/' + encodeURIComponent(id) + '/' + action, payload);
      await loadList();
      await selectRefund(id);
    } catch (e) {
      setError('detail-error', e.message);
      buttons.forEach(b => b.disabled = false);
    }
  });
  return button;
}
function addAdminActions(root, refund) {
  section(root, 'Administrator actions');
  const panel = el('div', null, 'admin-actions'); panel.id = 'admin-actions';
  const help = el('p', 'Actions are recorded in the audit history. Approval does not issue a PayPal refund or revoke a licence.', 'muted');
  panel.append(help);
  if (refund.status === 'pending') {
    panel.append(actionButton('Start review', 'review', () => ({})));
  }
  if (['pending', 'under_review', 'approved', 'rejected'].includes(refund.status)) {
    const noteLabel = el('label', 'Internal administrator note'); noteLabel.htmlFor = 'admin-note';
    const note = el('textarea'); note.id = 'admin-note'; note.maxLength = 2000;
    note.placeholder = 'Enter investigation notes (up to 2,000 characters)'; note.rows = 3;
    panel.append(noteLabel, note);
    panel.append(actionButton('Save note', 'notes', () => {
      const value = note.value.trim();
      if (!value) { setError('detail-error', 'Enter a note first.'); return null; }
      return { note: value };
    }));
  }
  if (['pending', 'under_review'].includes(refund.status)) {
    const reject = actionButton('Reject request', 'reject', () => {
      const reason = window.prompt('Enter a rejection reason (required):');
      if (reason === null) return null;
      if (!reason.trim() || reason.trim().length > 2000) { setError('detail-error', 'Enter a rejection reason of 1–2,000 characters.'); return null; }
      if (!window.confirm('Reject this refund request? This records a decision but does not move money.')) return null;
      return { reason: reason.trim() };
    }, 'outline danger');
    panel.append(reject);
    const approve = actionButton('Approve (no payment)', 'approve', () => {
      if (!refund.order_id || !refund.license_id || !refund.paypal_transaction_id) {
        setError('detail-error', 'Approval requires a verified linked order, licence and PayPal transaction.');
        return null;
      }
      const verification_note = window.prompt('Describe how you independently verified ownership (at least 20 characters):');
      if (verification_note === null) return null;
      if (verification_note.trim().length < 20 || verification_note.trim().length > 2000) {
        setError('detail-error', 'Verification note must contain 20–2,000 characters.'); return null;
      }
      if (!window.confirm('Record administrative approval only? No PayPal refund will be sent and no licence will be revoked.')) return null;
      return { verification_note: verification_note.trim() };
    }, 'outline');
    panel.append(approve);
  }
  if (['refund_processing', 'refunded', 'failed'].includes(refund.status)) {
    panel.append(el('p', 'This request is locked for payment reconciliation.', 'muted'));
  }
  root.append(panel);
}
function setError(id, message) { const e = $(id); e.hidden = !message; e.textContent = message || ''; }
async function loadList() {
  setError('list-error',''); $('requests').replaceChildren(el('p','Loading requests…','muted'));
  try {
    const status = $('status').value;
    const query = new URLSearchParams({limit:String(state.limit),offset:String(state.offset)});
    if (status) query.set('status',status);
    const data = await api('refunds?' + query);
    state.refunds = data.refunds || [];
    $('count').textContent = state.refunds.length;
    $('pending').textContent = state.refunds.filter(r=>r.status==='pending').length;
    $('unmatched').textContent = state.refunds.filter(r=>!r.license_id).length;
    $('page').textContent = `Page ${Math.floor(state.offset/state.limit)+1}`;
    $('prev').disabled = state.offset === 0;
    $('next').disabled = state.refunds.length < state.limit;
    const container = $('requests'); container.replaceChildren();
    if (!state.refunds.length) container.append(el('p','No requests found.','muted'));
    for (const refund of state.refunds) {
      const b = el('button',null,'request'); b.type='button';
      if (refund.id === state.selected) b.classList.add('active');
      const top = el('div',null,'request-top'); top.append(el('span',refund.customer_email,'request-email'),el('span',refund.status,'badge'));
      b.append(top,el('div',refund.created_at+' · '+refund.id.slice(0,8),'request-meta'),el('div',refund.reason,'request-reason'));
      b.addEventListener('click',()=>selectRefund(refund.id)); container.append(b);
    }
  } catch(e) { $('requests').replaceChildren(); setError('list-error',e.message); }
}
async function selectRefund(id) {
  state.selected=id; document.querySelectorAll('.request').forEach(b=>b.classList.remove('active'));
  $('detail-content').replaceChildren(el('p','Loading request…','muted')); setError('detail-error','');
  try {
    const data = await api('refunds/'+encodeURIComponent(id));
    if (state.selected!==id) return;
    const r=data.refund; const root=el('div',null,'detail-content');
    section(root,'Request');
    info(root,[['Reference',r.id],['Customer email',r.customer_email],['PayPal transaction',r.paypal_transaction_id],['Status',r.status],['Created',r.created_at],['Updated',r.updated_at],['Linked order ID',r.order_id],['Linked licence ID',r.license_id],['PayPal refund ID',r.paypal_refund_id],['Admin notes',r.admin_notes]]);
    addAdminActions(root, r);
    section(root,'Customer reason'); root.append(el('div',r.reason,'reason-box'));
    section(root,`Possible purchase matches (${(data.possible_matches||[]).length})`);
    if (!data.possible_matches?.length) root.append(el('p','No matching completed purchases found.','muted'));
    for (const m of data.possible_matches||[]) {
      const card=el('div',null,'match'); card.append(el('div',m.ownership_verified?'Ownership verified':'UNVERIFIED CANDIDATE — investigate before linking','flag'));
      info(card,[['Environment',m.environment],['PayPal order',m.paypal_order_id],['Capture ID',m.paypal_capture_id],['Order status',m.order_status],['Purchase email',m.fulfilment_email],['Licence email',m.licence_email],['Licence ID',m.license_id],['Licence status',m.licence_status],['Activations',m.activation_count],['Amount',m.amount+' '+m.currency],['Email matches',m.email_matches?'Yes':'No'],['Transaction matches',m.transaction_matches?'Yes':'No']]); root.append(card);
    }
    section(root,`Audit history (${(data.events||[]).length})`);
    if (!data.events?.length) root.append(el('p','No audit events recorded.','muted'));
    for (const event of data.events||[]) { const card=el('div',null,'event'); card.append(el('strong',event.event_type+' · '+str(event.new_status)),el('div',str(event.details)),el('time',str(event.created_at)+' · '+str(event.actor))); root.append(card); }
    $('detail-content').replaceChildren(root);
    document.querySelectorAll('.request').forEach(b=>{if(b.textContent.includes(r.id.slice(0,8))) b.classList.add('active');});
  } catch(e) { $('detail-content').replaceChildren(); setError('detail-error',e.message); }
}
$('refresh').addEventListener('click',loadList);
$('status').addEventListener('change',()=>{state.offset=0;loadList();});
$('prev').addEventListener('click',()=>{state.offset=Math.max(0,state.offset-state.limit);loadList();});
$('next').addEventListener('click',()=>{state.offset+=state.limit;loadList();});
loadList();
