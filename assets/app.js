'use strict';
const $ = id => document.getElementById(id);
const state = { offset: 0, limit: 25, refunds: [], selected: null };
const str = v => v == null || v === '' ? '—' : String(v);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; };
const line = (parent, label, value) => { parent.append(el('dt', label), el('dd', str(value))); };
function section(parent, title) { parent.append(el('h3', title)); }
function info(parent, fields) { const dl = el('dl', null, 'kv'); for (const [k,v] of fields) line(dl,k,v); parent.append(dl); }
async function api(path) { const r = await fetch('/api/' + path, { credentials:'same-origin', headers: { Accept:'application/json' }, cache:'no-store' }); let data; try { data = await r.json(); } catch { throw new Error('Invalid response from server'); } if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`); return data; }
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
