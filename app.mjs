import {validateInvestmentPlan,projectInvestment,recordContribution,undoContribution} from './investments.mjs';
import {LOAN_KINDS, amortize, compareLoan, loanDates, dueDate} from './loans.mjs';
import {defaultForecast, validateForecast, projectYear, pendingPayments, cashPlan, postDueExpenses} from './planning.mjs';
import {BRACKETS, CATEGORIES, ASSET_TYPES, cents, calculateTax, totals, validateState, toCSV, csvCell, accountBalances, portfolio} from './core.mjs';
import {calculatePayroll, YOUTH_CAP} from './payroll.mjs';
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('pt-PT', {style:'currency',currency:'EUR'}).format(value / 100);
const percent = value => new Intl.NumberFormat('en-GB', {maximumFractionDigits:2}).format(value) + '%';
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const KEY = 'conta-v1';
const emptyState = () => validateState({version:1,demo:false,transactions:[],tax:{taxable:null,joint:false}});
function sampleState() {
  const transactions = [];
  const now = new Date();
  for(let offset=5; offset>=0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth()-offset, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const entries = [['Monthly salary','Salary','income',285000,1],['Rent','Housing','expense',85000,2],['Weekly groceries','Groceries','expense',15320-offset*650,6],['Metro pass','Transport','expense',4000,7],['Electricity & internet','Utilities','expense',10400+offset*210,8],['Dinner with friends','Dining','expense',4850+offset*230,11],['A good book','Leisure','expense',1890,14],['Weekend groceries','Groceries','expense',7825,16]];
    for(const [description, category, type, amount, day] of entries) transactions.push({id:crypto.randomUUID(),description,category,type,amount,date:`${month}-${String(day).padStart(2,'0')}`});
  }
  const sample=validateState({version:1,demo:true,transactions,tax:{taxable:3600000,joint:false}});
  sample.accounts=[{id:'demo-bank',name:'Everyday account',bank:'Sample bank',kind:'Current',opening:100000},{id:'demo-savings',name:'A little breathing room',bank:'Sample bank',kind:'Savings',opening:450000}];
  sample.transactions=sample.transactions.map(t=>({...t,accountId:'demo-bank'}));
  sample.holdings=[{id:'demo-etf',name:'Global equity fund · sample',symbol:'DEMO',broker:'Sample broker',kind:'ETF',units:40,cost:400000,price:112.5,updated:today()}];
  return sample;
}
let state;
let storageBlocked = false;
try { const raw = localStorage.getItem(KEY); state = raw ? validateState(JSON.parse(raw)) : sampleState(); }
catch { state = emptyState(); storageBlocked = true; }
let toastTimer;
function toast(message, persistent=false) {
  clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').hidden=false;
  if(!persistent) toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);
}
function save(next) {
  try {
    const validated=validateState(next);
    if(storageBlocked) throw new Error('Existing saved data could not be read. Export a backup before resetting this workspace.');
    localStorage.setItem(KEY,JSON.stringify(validated)); state=validated; return true;
  } catch(error) { toast('Could not save: ' + error.message, true); return false; }
}
function resetState(next) {
  try { const validated=validateState(next);localStorage.setItem(KEY,JSON.stringify(validated)); state=validated; storageBlocked=false; render(); toast(next.demo?'Sample workspace loaded.':'Your workspace is ready.'); }
  catch { toast('Browser storage is unavailable. Enable site storage to save your finances.',true); }
}
function route() {
  const page=['overview','transactions','accounts','portfolio','planning','loans','tax','settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('.page').forEach(node=>node.hidden=node.id!==page);
  document.querySelectorAll('nav a').forEach(node=>{node.classList.toggle('active',node.dataset.page===page); if(node.dataset.page===page) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');});
  document.title=`${{overview:'Overview',transactions:'Transactions',accounts:'Accounts',portfolio:'Portfolio',planning:'Planning',loans:'Loans',tax:'IRS calculator',settings:'Your data'}[page]} · Conta`;
}
const icons={Salary:'↙','Other income':'↙',Housing:'⌂',Groceries:'▧',Transport:'↔',Dining:'♧',Shopping:'◇',Health:'＋',Leisure:'♫',Utilities:'ϟ',Other:'·'};
function sorted(transactions) {return [...transactions].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));}
function filtered() {const query=$('#search').value.toLowerCase(); const month=$('#transaction-month').value;const type=$('#type-filter').value;return sorted(state.transactions.filter(t=>(!month||t.date.startsWith(month))&&(type==='all'||t.type===type)&&`${t.description} ${t.category}`.toLowerCase().includes(query)));}
function dateLabel(value) {return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value+'T12:00:00'));}
function renderOverview() {
  const month=$('#overview-month').value || today().slice(0,7);
  renderCashSummary('#overview-cash',month);
  const entries=state.transactions.filter(t=>t.date.startsWith(month));const total=totals(entries);
  for(const key of ['balance','income','expense']) $('#'+key).textContent=money(total[key]);
  for(const type of ['income','expense']) {const n=entries.filter(t=>t.type===type).length;$('#'+type+'-count').textContent=`${n} ${type} transaction${n===1?'':'s'}`;}
  const [year, mon]=month.split('-').map(Number);
  const months=Array.from({length:6},(_,i)=>{const d=new Date(year,mon-6+i,1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;return {...totals(state.transactions.filter(t=>t.date.startsWith(key))),label:d.toLocaleDateString('en-GB',{month:'short'}),key};});
  const max=Math.max(10000,...months.flatMap(m=>[m.income,m.expense]));const ceiling=Math.ceil(max/10000)*10000;
  const chart=$('#cash-chart');
  chart.setAttribute('aria-label',months.map(m=>`${m.key}: income ${money(m.income)}, expenses ${money(m.expense)}`).join('; '));
  chart.innerHTML=`<div class="y-labels">${[1,.75,.5,.25,0].map(v=>`<span>${Math.round(ceiling*v/100).toLocaleString('en-GB')}</span>`).join('')}</div><div class="chart-plot">${months.map((m,i)=>`<div class="chart-group ${i===5?'current':''}" title="${m.key}: income ${money(m.income)}; expenses ${money(m.expense)}"><div class="chart-bar" style="height:${m.income/ceiling*100}%"></div><div class="chart-bar out" style="height:${m.expense/ceiling*100}%"></div><span class="chart-label">${m.label}</span></div>`).join('')}</div>`;
  const categories=new Map();for(const t of entries.filter(t=>t.type==='expense')) categories.set(t.category,(categories.get(t.category)||0)+t.amount);
  let spending=[...categories].sort((a,b)=>b[1]-a[1]);
  if(spending.length>4) spending=[...spending.slice(0,3),['Other categories',spending.slice(3).reduce((sum,t)=>sum+t[1],0)]];
  const colors=['#345f43','#96ae72','#cfdaa7','#e3bb95'];let angle=0;
  const gradient=spending.map(([,amount],i)=>{const start=angle;angle+=amount/total.expense*360;return `${colors[i]} ${start}deg ${angle}deg`;}).join(',');
  $('#spending').innerHTML=total.expense?`<div class="spending-ring" style="background:conic-gradient(${gradient})"><div class="ring-center"><span>Total spent</span><strong>${money(total.expense)}</strong></div></div><div class="spending-legend">${spending.map(([name,amount],i)=>`<div class="spending-row"><i style="background:${colors[i]}"></i><span>${name}</span><strong>${money(amount)}</strong></div>`).join('')}</div>`:'<p class="empty">A fresh start.<br>Your spending will appear here.</p>';
  $('#recent-list').innerHTML=sorted(entries).slice(0,4).map(t=>`<div class="recent-item"><span class="category-icon" aria-hidden="true">${icons[t.category]}</span><div><h3>${escape(t.description)}</h3><p>${escape(t.category)} · ${dateLabel(t.date)}</p></div><strong class="amount ${t.type}">${t.type==='income'?'+':'−'}${money(t.amount)}</strong></div>`).join('')||'<p class="empty">Your month starts here.<br>Add your first transaction.</p>';
}
function renderTransactions() {
  const entries=filtered();const total=totals(entries);
  $('#transaction-summary').textContent=`${entries.length} transaction${entries.length===1?'':'s'} · Income ${money(total.income)} · Expenses ${money(total.expense)} · Balance ${money(total.balance)}`;
  $('#transaction-rows').innerHTML=entries.map(t=>`<tr><td>${escape(t.description)}</td><td><span class="pill">${escape(t.category)}</span></td><td>${escape(accountName(t.accountId))}</td><td>${dateLabel(t.date)}</td><td class="right amount ${t.type}">${t.type==='income'?'+':'−'}${money(t.amount)}</td><td><button class="icon-button" data-edit="${escape(t.id)}" aria-label="Edit ${escape(t.description)}">Edit</button><button class="icon-button" data-delete="${escape(t.id)}" aria-label="Delete ${escape(t.description)}">×</button></td></tr>`).join('');
  $('#no-transactions').hidden=entries.length>0;
}
function renderTax() {
  $('#taxable-income').value=state.tax.taxable===null?'':(state.tax.taxable/100).toFixed(2);$('#taxation').value=state.tax.joint?'joint':'individual';
  const result=state.tax.taxable===null?null:calculateTax(state.tax.taxable,state.tax.joint);
  $('#tax-result').innerHTML=result?`<div class="tax-total">${money(result.total)}</div><p class="tax-result-caption">Annual estimate · ${state.tax.joint?'Joint':'Individual'} taxation</p><div class="tax-breakdown"><div><span>General IRS</span><strong>${money(result.general)}</strong></div><div><span>Solidarity surcharge</span><strong>${money(result.solidarity)}</strong></div><div><span>Effective rate on taxable income</span><strong>${percent(result.effective)}</strong></div><div><span>Marginal bracket rate</span><strong>${percent(result.rate)}</strong></div><div><span>Taxable income per quotient</span><strong>${money(state.tax.taxable/result.divisor)}</strong></div></div><p class="tax-result-note">${result.index===0?'Your income falls in the first band.':`The completed band up to ${money(result.lower*100)} uses its published average rate; only the remaining ${money((result.income-result.lower)*100)} uses ${percent(result.rate)}.`} ${state.tax.joint?'The result is multiplied by two for joint taxation.':''} Solidarity adds 2.5% on taxable income per quotient between €80,000 and €250,000, and 5% above €250,000.</p>`:'<p class="empty">A clearer estimate starts with your numbers.<br>Enter your annual taxable income to see your bracket.</p>';
  $('#bracket-rows').innerHTML=BRACKETS.map(([upper,rate,average],i)=>`<tr class="${result&&result.index===i?'current':''}"><td>${String(i+1).padStart(2,'0')}${result&&result.index===i?' · Your bracket':''}</td><td>${i===0?'Up to '+money(upper*100):upper===Infinity?'Over '+money(BRACKETS[i-1][0]*100):'Over '+money(BRACKETS[i-1][0]*100)+' to '+money(upper*100)}</td><td class="right">${percent(rate)}</td><td class="right">${average===null?'—':average.toFixed(3)+'%'}</td><td class="right">${result?money(result.slices[i].amount):'—'}</td><td class="right">${result?money(result.slices[i].tax):'—'}</td></tr>`).join('');
  if(result) $('#tax-result').insertAdjacentHTML('beforeend',`<p class="tax-result-note">Each band is shown separately below. The statutory average-rate calculation differs from the sum of the displayed band amounts by ${money(result.general-result.slices.reduce((sum,b)=>sum+b.tax,0))} due to published-rate rounding. ${state.tax.joint?'Band amounts include both household quotients.':''}</p>`);
}
function render() {$('#demo-banner').hidden=!state.demo;renderOverview();renderTransactions();renderTax();renderWealth();renderPayroll();renderPlanning();renderLoans();renderInvestments();route();}
const form=$('#transaction-form');const dialog=$('#transaction-dialog');
function openTransaction(id) {
  form.reset();$('#transaction-error').textContent='';const t=state.transactions.find(t=>t.id===id);
  $('#transaction-account').innerHTML='<option value="">Unassigned</option>'+accountOptions();
  $('#dialog-title').textContent=t?'Edit transaction':'Add a transaction';
  for(const [key,value] of Object.entries(t||{id:'',date:today(),category:'Other'})) if(form.elements.namedItem(key)) form.elements.namedItem(key).value=key==='amount'?(value/100).toFixed(2):value;
  $('#repeat-label').hidden=!!t;form.elements.repeat.disabled=!!t||form.elements.type.value!=='expense';
  dialog.showModal();
}
$('#category-select').innerHTML=CATEGORIES.map(c=>`<option>${c}</option>`).join('');
document.querySelectorAll('.add-transaction').forEach(button=>button.addEventListener('click',()=>openTransaction()));
document.querySelectorAll('.close-dialog').forEach(button=>button.addEventListener('click',()=>dialog.close()));
form.elements.type.addEventListener('change',()=>{form.elements.repeat.disabled=!!form.elements.id.value||form.elements.type.value!=='expense';});
form.addEventListener('submit',event=>{
  event.preventDefault();try {
    const data=Object.fromEntries(new FormData(form));const t={...state.transactions.find(old=>old.id===data.id),...data,id:data.id||crypto.randomUUID(),description:data.description.trim(),amount:cents(data.amount),accountId:data.accountId||null};
    if(!t.description) throw new Error('Please add a description.');
    if(data.id&&!state.transactions.some(old=>old.id===data.id)) throw new Error('This transaction was removed in another tab. Close this form and add it again if needed.');
    if((t.recurringId||t.loanId)&&t.type!=='expense')throw new Error('A posted monthly expense must remain an expense.');
    let recurring=state.recurring;
    if(!data.id&&data.repeat&&t.type==='expense'){
      t.recurringId=crypto.randomUUID();t.occurrence=t.date.slice(0,7);
      recurring=[...recurring,{id:t.recurringId,description:t.description,amount:t.amount,category:t.category,accountId:t.accountId,start:t.date,end:'',day:Number(t.date.slice(8)),enabled:true,posted:[t.occurrence]}];
    }
    const transactions=data.id?state.transactions.map(old=>old.id===data.id?t:old):[...state.transactions,t];
    if(save({...state,transactions,recurring})) {dialog.close();render();toast('Transaction saved'+(state.demo?' in the sample workspace.':'.'));} else $('#transaction-error').textContent='Could not save. Check browser storage; your previous data is unchanged.';
  } catch(error) {$('#transaction-error').textContent=error.message;}
});
$('#transaction-rows').addEventListener('click',event=>{
  const edit=event.target.closest('[data-edit]');if(edit) return openTransaction(edit.dataset.edit);
  const remove=event.target.closest('[data-delete]');if(!remove) return;
  const t=state.transactions.find(t=>t.id===remove.dataset.delete);
  if(t&&confirm(`Delete “${t.description}” (${money(t.amount)})?`)&&save({...state,transactions:state.transactions.filter(item=>item.id!==t.id)})) {render();toast('Transaction deleted.');}
});
$('#tax-form').addEventListener('submit',event=>{event.preventDefault();try {if(save({...state,tax:{taxable:cents($('#taxable-income').value),joint:$('#taxation').value==='joint'}})) {renderTax();toast('Your estimate is updated.');}}catch(error){toast(error.message);}});
function download(filename,content,type) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export-csv').addEventListener('click',()=>{download(`conta-transactions-${today()}.csv`,toCSV(filtered()),'text/csv;charset=utf-8');toast('Exported the filtered transactions.');});
$('#backup').addEventListener('click',()=>{
  try {
    const content=storageBlocked?localStorage.getItem(KEY):JSON.stringify(state,null,2);
    if(content===null) throw new Error('No saved data is available to back up.');
    download(`conta-${storageBlocked?'recovery':'backup'}-${today()}.json`,content,'application/json');
  } catch(error){toast('Could not back up: '+error.message,true);}
});
$('#restore').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try {if(file.size>20_000_000) throw new Error('Backup must be smaller than 20 MB.');const next=validateState(JSON.parse(await file.text()));if(confirm(`Replace this workspace with ${next.transactions.length} transactions from “${file.name}”? Download a backup first if you want to keep existing data.`)) resetState(next);}
  catch(error){toast('Could not import: '+error.message,true);}finally{event.target.value='';}
});
$('#start-fresh').addEventListener('click',()=>{if(confirm('Remove the sample workspace and start your own finances? This also removes any entries you added to the sample.'))resetState(emptyState());});
$('#load-demo').addEventListener('click',()=>{if(confirm('Replace your current workspace with sample data? Download a backup first to keep your entries.'))resetState(sampleState());});
$('#clear-data').addEventListener('click',()=>{if(confirm('Permanently clear this workspace, including all transactions and tax settings? Download a backup first.'))resetState(emptyState());});
$('#overview-month').value=today().slice(0,7);$('#transaction-month').value=today().slice(0,7);
$('#overview-month').addEventListener('change',renderOverview);
for(const id of ['search','transaction-month','type-filter']) $('#'+id).addEventListener('input',renderTransactions);
$('#all-months').addEventListener('click',()=>{$('#transaction-month').value='';renderTransactions();});
window.addEventListener('hashchange',route);
// Reload changes from another tab rather than allowing an old tab to overwrite them.
window.addEventListener('storage',event=>{if(event.key!==KEY&&event.key!==null)return;try{state=event.newValue?validateState(JSON.parse(event.newValue)):emptyState();storageBlocked=false;render();toast('Workspace updated in another tab.');}catch{storageBlocked=true;toast('Saved data could not be read. Export a backup before resetting this workspace.',true);}});
function accountName(id) {return state.accounts.find(a=>a.id===id)?.name||'Unassigned';}
function accountOptions() {return state.accounts.map(a=>`<option value="${escape(a.id)}">${escape(a.name)}</option>`).join('');}
function renderWealth() {
  const balances=accountBalances(state,today()),investments=portfolio(state.holdings);
  const cash=[...balances.values()].reduce((sum,value)=>sum+value,0);
  $('#total-cash').textContent=money(cash);$('#account-investments').textContent=money(investments.value);$('#net-worth').textContent=money(cash+investments.value);
  const unassigned=state.transactions.filter(t=>!t.accountId).length;
  $('#unassigned-note').textContent=unassigned?`${unassigned} transaction${unassigned===1?' is':'s are'} unassigned. Edit these transactions to link a bank account; they do not affect account balances or tracked assets.`:'Balances include assigned transactions and investment contributions through today. Future outflows are reserved in Planning.';
  $('#account-cards').innerHTML=state.accounts.map(a=>`<article class="panel account-card"><div class="panel-heading"><span class="category-icon" aria-hidden="true">▤</span><span class="pill">${escape(a.kind)}</span></div><h2>${escape(a.name)}</h2><p class="muted">${escape(a.bank)} · EUR</p><div class="stat-number">${money(balances.get(a.id))}</div><div class="panel-heading"><small class="muted">Opening balance ${money(a.opening)}</small><div><button class="icon-button" data-account-edit="${escape(a.id)}">Edit</button><button class="icon-button" data-account-delete="${escape(a.id)}">Delete</button></div></div></article>`).join('')||'<article class="panel"><p class="empty">Add your bank account to start tracking balances.<br>No bank login or credentials needed.</p></article>';
  $('#add-transfer').disabled=state.accounts.length<2;
  $('#transfer-empty').hidden=state.transfers.length>0;
  $('#transfer-rows').innerHTML=sorted(state.transfers).map(t=>`<tr><td>${dateLabel(t.date)}</td><td>${escape(accountName(t.from))}</td><td>${escape(accountName(t.to))}</td><td class="right">${money(t.amount)}</td><td><button class="icon-button" data-transfer-delete="${escape(t.id)}" aria-label="Delete transfer on ${escape(t.date)}">Delete</button></td></tr>`).join('');
  $('#portfolio-value').textContent=money(investments.value);$('#portfolio-cost').textContent=money(investments.cost);$('#portfolio-gain').textContent=(investments.gain>0?'+':'')+money(investments.gain);
  $('#portfolio-gain').className='stat-number '+(investments.gain<0?'negative':'positive');
  $('#portfolio-return').textContent=investments.returnPct===null?'Add cost basis to calculate a return':percent(investments.returnPct)+' on remaining cost basis';
  $('#portfolio-count').textContent=`${state.holdings.length} holding${state.holdings.length===1?'':'s'} · Manual price updates`;
  $('#holdings-empty').hidden=state.holdings.length>0;
  $('#holding-rows').innerHTML=investments.positions.map(h=>`<tr><td><strong>${escape(h.symbol||h.name)}</strong><small class="cell-note">${escape(h.name)}<br>${escape(h.broker)} · ${escape(h.kind)}</small></td><td>${h.valuation==='balance'?'—':h.units.toLocaleString('en-GB',{maximumFractionDigits:8})}</td><td>${h.valuation==='balance'?'Statement total':h.price.toLocaleString('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:6})+' €'}</td><td>${money(h.value)}</td><td class="${h.gain<0?'negative':'positive'}">${money(h.gain)}<small class="cell-note">${h.returnPct===null?'No cost basis':percent(h.returnPct)}</small></td><td>${dateLabel(h.updated)}${Date.now()-Date.parse(h.updated+'T23:59:59')>7*86400000?'<small class="cell-note">Update price</small>':''}</td><td><button class="icon-button" data-holding-edit="${escape(h.id)}" aria-label="Edit ${escape(h.symbol||h.name)}">Edit</button><button class="icon-button" data-holding-delete="${escape(h.id)}" aria-label="Delete ${escape(h.symbol||h.name)}">Delete</button></td></tr>`).join('');
  const colors=['#345f43','#96ae72','#cfdaa7','#e3bb95','#9baeb1','#bbb39a'];
  const allocations=ASSET_TYPES.map(kind=>({kind,value:investments.positions.filter(h=>h.kind===kind).reduce((sum,h)=>sum+h.value,0)})).filter(a=>a.value>0);
  $('#allocation').innerHTML=allocations.map((a,i)=>`<div class="allocation-row"><div><span>${a.kind}</span><strong>${percent(a.value/investments.value*100)}</strong></div><div class="allocation-track"><div style="width:${a.value/investments.value*100}%;background:${colors[i]}"></div></div><small>${money(a.value)}</small></div>`).join('')||'<p class="empty">Your asset mix will appear here.</p>';
  const history=[...state.snapshots].sort((a,b)=>a.date.localeCompare(b.date));
  $('#snapshot-rows').innerHTML=[...history].reverse().map(s=>`<tr><td>${dateLabel(s.date)}</td><td>${money(s.cash)}</td><td>${money(s.investments)}</td><td>${money(s.cash+s.investments)}</td><td><button class="icon-button" data-snapshot-delete="${s.date}">Delete</button></td></tr>`).join('');
  if(history.length<2) $('#wealth-chart').innerHTML=`<div class="empty snapshot-empty"><span class="little-spark" aria-hidden="true">✳</span><p>${history.length?'Your first snapshot is saved. Save on another day to see your progress.':'Start your timeline. Save today’s cash and portfolio values.'}</p><strong>Today: ${money(cash+investments.value)}</strong></div>`;
  else {
    const values=history.map(s=>s.cash+s.investments),low=Math.min(...values),high=Math.max(...values),span=Math.max(100,high-low);
    const points=history.map((s,i)=>[55+i/(history.length-1)*470,20+(high-values[i])/span*130]);
    $('#wealth-chart').innerHTML=`<svg class="wealth-svg" viewBox="0 0 560 195" role="img" aria-label="Tracked assets from ${history[0].date} to ${history.at(-1).date}, ending at ${money(values.at(-1))}"><line x1="55" x2="530" y1="20" y2="20" stroke="#e6eadf"/><line x1="55" x2="530" y1="150" y2="150" stroke="#e6eadf"/><text x="0" y="24">${Math.round(high/100).toLocaleString('en-GB')} €</text><text x="0" y="154">${Math.round(low/100).toLocaleString('en-GB')} €</text><polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#345f43" stroke-width="3"/>${points.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="4" fill="#345f43"><title>${history[i].date}: ${money(values[i])}</title></circle>`).join('')}<text x="55" y="184">${history[0].date}</text><text x="460" y="184">${history.at(-1).date}</text></svg>`;
  }
}
function openRecord(formId,values) {
  const f=$('#'+formId);f.reset();f.querySelector('.error').textContent='';
  for(const [key,value] of Object.entries(values)) if(f.elements.namedItem(key)) f.elements.namedItem(key).value=value;
  f.closest('dialog').showModal();
}
function commitRecord(f,next) {
  validateState(next);
  if(!save(next)) throw new Error('Could not save. Check browser storage; your previous data is unchanged.');
  f.closest('dialog').close();render();toast('Saved'+(state.demo?' in the sample workspace.':'.'));
}
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$('#asset-kind').innerHTML=ASSET_TYPES.map(type=>`<option>${type}</option>`).join('');
$('#add-account').addEventListener('click',()=>openRecord('account-form',{id:'',opening:'0.00'}));
$('#account-form').addEventListener('submit',event=>{
  event.preventDefault();const f=event.currentTarget;
  try {const v=Object.fromEntries(new FormData(f));const opening=cents(v.opening.replace(/^-/,'').trim())*(v.opening.startsWith('-')?-1:1);
    const account={...v,id:v.id||crypto.randomUUID(),name:v.name.trim(),bank:v.bank.trim(),opening};
    if(v.id&&!state.accounts.some(a=>a.id===v.id))throw new Error('This account was removed in another tab.');
    commitRecord(f,{...state,accounts:v.id?state.accounts.map(a=>a.id===v.id?account:a):[...state.accounts,account]});
  }catch(error){f.querySelector('.error').textContent=error.message;}
});
$('#account-cards').addEventListener('click',event=>{
  const edit=event.target.closest('[data-account-edit]');if(edit){const a=state.accounts.find(a=>a.id===edit.dataset.accountEdit);return openRecord('account-form',{...a,opening:(a.opening/100).toFixed(2)});}
  const remove=event.target.closest('[data-account-delete]');if(!remove)return;const id=remove.dataset.accountDelete;
  if(state.transactions.some(t=>t.accountId===id)||state.transfers.some(t=>t.from===id||t.to===id)||state.recurring.some(r=>r.accountId===id)||state.loans.some(l=>l.accountId===id)||state.investmentPlans.some(p=>p.accountId===id)||state.contributions.some(c=>c.accountId===id))return toast('Reassign this account’s transactions, investments, loans and monthly expenses, and remove its transfers before deleting it.');
  if(confirm('Delete this account and its opening balance?')&&save({...state,accounts:state.accounts.filter(a=>a.id!==id)}))render();
});
$('#add-transfer').addEventListener('click',()=>{
  const f=$('#transfer-form');f.elements.from.innerHTML=accountOptions();f.elements.to.innerHTML=accountOptions();
  openRecord('transfer-form',{date:today(),from:state.accounts[0]?.id,to:state.accounts[1]?.id});
});
$('#transfer-form').addEventListener('submit',event=>{
  event.preventDefault();const f=event.currentTarget;try{const v=Object.fromEntries(new FormData(f));
    if(v.from===v.to)throw new Error('Choose two different accounts.');
    commitRecord(f,{...state,transfers:[...state.transfers,{...v,id:crypto.randomUUID(),amount:cents(v.amount)}]});
  }catch(error){f.querySelector('.error').textContent=error.message;}
});
$('#transfer-rows').addEventListener('click',event=>{const button=event.target.closest('[data-transfer-delete]');if(button&&confirm('Delete this transfer and reverse its effect on both balances?')&&save({...state,transfers:state.transfers.filter(t=>t.id!==button.dataset.transferDelete)}))render();});
$('#add-holding').addEventListener('click',()=>openHolding());
$('#holding-form').addEventListener('submit',event=>{
  event.preventDefault();const f=event.currentTarget;try{const v=Object.fromEntries(new FormData(f));
    const holding={...v,id:v.id||crypto.randomUUID(),name:v.name.trim(),symbol:v.symbol.trim(),broker:v.broker.trim(),valuation:v.valuation,units:v.valuation==='balance'?1:Number(v.units),price:Number(v.price),cost:cents(v.cost)};
    if(v.updated>today())throw new Error('Price date cannot be in the future.');
    if(v.id&&!state.holdings.some(h=>h.id===v.id))throw new Error('This holding was removed in another tab.');
    commitRecord(f,{...state,holdings:v.id?state.holdings.map(h=>h.id===v.id?holding:h):[...state.holdings,holding]});
  }catch(error){f.querySelector('.error').textContent=error.message;}
});
$('#holding-rows').addEventListener('click',event=>{
  const edit=event.target.closest('[data-holding-edit]');if(edit){const h=state.holdings.find(h=>h.id===edit.dataset.holdingEdit);return openHolding({...h,cost:(h.cost/100).toFixed(2)});}
  const remove=event.target.closest('[data-holding-delete]');if(remove&&(state.investmentPlans.some(p=>p.holdingId===remove.dataset.holdingDelete)||state.contributions.some(c=>c.holdingId===remove.dataset.holdingDelete)))return toast('Remove the contribution plan and undo its recorded contributions before deleting this holding.');if(remove&&confirm('Remove this holding? Saved valuation snapshots stay unchanged; cash balances are not adjusted.')&&save({...state,holdings:state.holdings.filter(h=>h.id!==remove.dataset.holdingDelete)}))render();
});
$('#save-snapshot').addEventListener('click',()=>{
  if(state.snapshots.some(s=>s.date===today())&&!confirm('Replace today’s saved valuation with the current values?'))return;
  const p=portfolio(state.holdings);const cash=[...accountBalances(state,today()).values()].reduce((s,v)=>s+v,0);
  if(save({...state,snapshots:[...state.snapshots.filter(s=>s.date!==today()),{date:today(),cash,investments:p.value,cost:p.cost}]})){renderWealth();toast('Today’s valuation is saved.');}
});
$('#snapshot-rows').addEventListener('click',event=>{const b=event.target.closest('[data-snapshot-delete]');if(b&&confirm('Delete this historical valuation?')&&save({...state,snapshots:state.snapshots.filter(s=>s.date!==b.dataset.snapshotDelete)}))renderWealth();});
$('#export-holdings').addEventListener('click',()=>{
  const rows=[['Name','Ticker','Broker','Asset class','Units','Cost basis EUR','Unit price EUR','Value EUR','Unrealised gain EUR','Price date'],...portfolio(state.holdings).positions.map(h=>[h.name,h.symbol,h.broker,h.kind,h.units,(h.cost/100).toFixed(2),h.price,(h.value/100).toFixed(2),(h.gain/100).toFixed(2),h.updated])];
  download(`conta-holdings-${today()}.csv`,'\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
});
const payrollForm=$('#payroll-form');
function toggleYouth() {
  const on=payrollForm.elements.youth.checked;$('#youth-fields').hidden=!on;
  for(const name of ['age','careerYear','eligible','employerApplied'])payrollForm.elements[name].disabled=!on;
  payrollForm.elements.age.required=on;payrollForm.elements.eligible.required=on;
}
function renderPayroll() {
  for(const [key,value] of Object.entries(state.payroll)) {
    const input=payrollForm.elements.namedItem(key);
    if(typeof value==='boolean')input.checked=value;
    else input.value=['gross','mealDaily'].includes(key)?(value/100).toFixed(2):key==='age'&&value===0?'':value;
  }
  toggleYouth();
  const p=state.payroll;
  let r;try{r=calculatePayroll(p);}catch(error){$('#payroll-result').textContent=error.message;return;}
  const row=(label,value)=>`<div><span>${label}</span><strong>${value}</strong></div>`;
  const hypothetical=p.age>0&&p.age<=35?calculatePayroll({...p,youth:true,eligible:true,employerApplied:true}):null;
  $('#payroll-result').innerHTML=`
    <div class="tax-tag">MONTHLY NET VALUE · ${p.month}</div><div class="tax-total">${money(r.net)}</div>
    ${p.month.slice(0,4)==='2026'?'':`<div class="scope-note"><strong>2026 tables applied to ${p.month.slice(0,4)}.</strong><p>Withholding tables, meal limits and IAS are the published 2026 values and do not update automatically. Check this year's official tables before relying on this figure.</p></div>`}
    <div class="net-bar"><i style="width:${r.net/(r.net+r.irs+r.ss||1)*100}%;background:#345f43"></i><i style="width:${r.irs/(r.net+r.irs+r.ss||1)*100}%;background:#b9c991"></i><i style="width:${r.ss/(r.net+r.irs+r.ss||1)*100}%;background:#e3bb95"></i></div>
    <div class="tax-breakdown">
      ${row('To your bank account',money(r.bankNet))}${row('To your meal card',money(r.mealCard))}
      ${row('Base salary',money(r.gross))}${r.extraGross?row('Gross duodécimos',money(r.extraGross)):''}
      ${row(`Meal allowance · ${p.mealDays} paid days`,money(r.meal))}
      ${row('Taxable meal allowance excess',money(r.mealTaxable))}
      ${row('IRS withholding',money(r.irs))}${row('Employee Social Security · 11%',money(r.ss))}
      ${row('Effective IRS rate on regular taxable pay',percent(r.effective))}
      ${row('IRS Jovem regular-payment exemption',money(r.exemption))}
    </div>
    ${!p.youth&&hypothetical?`<div class="scope-note"><strong>First-year benefit preview: ${money(hypothetical.net)} net value</strong><p>This scenario assumes IRS Jovem eligibility and employer application. Enable the benefit and confirm your circumstances to apply it to the main result.</p></div>`:''}
    ${p.youth&&!p.employerApplied?`<div class="scope-note"><strong>With employer application: ${money(hypothetical.net)}</strong><p>The main result uses ordinary withholding because your employer is not applying IRS Jovem. Request it from your employer to reduce monthly withholding; claim eligibility in your annual return.</p></div>`:''}
    <div class="pay-comparison"><h3>12 or 14 payments?</h3><div><span>14 payments · ordinary month</span><strong>${money(r.regularNet)}</strong></div><div><span>Each separate extra salary · no meals</span><strong>${money(r.bonusNet)}</strong></div><div><span>12 payments · with both duodécimos</span><strong>${money(r.twelveNet)}</strong></div><small>Monthly values include the entered meal days. Annual base salary stays ${money(r.annualGross)} in both schedules.</small></div>
    <details class="calculation-details"><summary>Show the withholding calculation</summary><p>Table ${p.family==='married-one'?'III':p.family==='single'&&p.dependants>0?'II':'I'}, band ${r.index+1}: regular taxable pay ${money(r.taxable)} × ${percent(r.rate)} − ${money(r.deduction)} parcela a abater − ${money(r.dependentDeduction)} for dependants.</p><p>Daily meal exemption: ${money(r.mealLimit)} (${p.mealMethod==='card'?'card':'cash'}). Only the excess enters IRS and SS. Allowances use their own withholding calculation, without meals.</p><p>${p.youth?`The full-income effective rate applies only to the non-exempt share. Regular-payment IRS Jovem exemption is capped at ${money(YOUTH_CAP/14)}; it does not reduce SS. `:''}Withholding is rounded down to whole euros before allowance apportionment. The employer’s contribution is not deducted from your pay.</p></details>
    <div class="annual-projection"><span>Full-year planning estimate · same salary throughout</span><strong>${money(r.annualNet)}</strong><small>Salary ${money(r.annualGross)} + meals ${money(r.annualMeal)}<br>IRS withheld ${money(r.annualWithheld)} · SS ${money(r.annualSS)}</small><small>Uses ${p.annualMealDays} meal days spread evenly over 12 months. Actual payslips can differ by payment timing and rounding. This is not your final annual IRS liability.</small></div>`;
}
payrollForm.elements.youth.addEventListener('change',toggleYouth);
payrollForm.addEventListener('submit',event=>{
  event.preventDefault();$('#payroll-error').textContent='';try{
    const v=Object.fromEntries(new FormData(payrollForm));
    const payroll={gross:cents(v.gross),mealDaily:cents(v.mealDaily),mealDays:Number(v.mealDays),mealMethod:v.mealMethod,annualMealDays:Number(v.annualMealDays),month:v.month,family:v.family,dependants:Number(v.dependants),payments:Number(v.payments),youth:!!v.youth,age:Number(v.age||0),careerYear:Number(v.careerYear||1),eligible:!!v.eligible,employerApplied:!!v.employerApplied};
    calculatePayroll(payroll);
    if(save({...state,payroll})){renderPayroll();renderPlanning();toast('Take-home estimate updated.');}else $('#payroll-error').textContent='Could not save your salary settings. Check browser storage.';
  }catch(error){$('#payroll-error').textContent=error.message;}
});
const monthLabel=month=>new Date(month+'-01T12:00:00').toLocaleDateString('en-GB',{month:'short',year:'numeric'});
const eurInput=value=>(value/100).toFixed(2);
function renderPlanning(){
  const p=state.payroll;
  $('#forecast-start').value=state.forecast.start;$('#forecast-end').value=state.forecast.end;$('#forecast-payday').value=state.forecast.payDay;
  $('#forecast-profile').textContent=`${p.payments} payments · ${p.youth&&p.employerApplied?'IRS Jovem applied by employer':'Ordinary withholding'} · ${money(p.mealDaily)} per meal day · ${p.mealMethod==='card'?'Meal card':'Cash meals'}. Tax settings apply to all months below.`;
  renderForecastInputs(state.forecast);
  $('#recurring-list').innerHTML=state.recurring.map(r=>`<div class="commitment-row"><div><strong>${escape(r.description)}</strong><small>${escape(r.category)} · ${escape(accountName(r.accountId))} · Day ${r.day} · From ${dateLabel(r.start)}${r.end?' to '+dateLabel(r.end):''} · ${r.enabled?'Active':'Paused'}</small></div><strong>${money(r.amount)}<small>per month</small></strong><div><button class="icon-button" data-recurring-edit="${escape(r.id)}">Edit</button><button class="icon-button" data-recurring-toggle="${escape(r.id)}">${r.enabled?'Pause':'Resume'}</button><button class="icon-button" data-recurring-delete="${escape(r.id)}">Delete</button></div></div>`).join('')||'<p class="empty">Add a monthly expense to see your commitments ahead.</p>';
  const due=pendingPayments(state,today()).filter(p=>p.kind!=='investment').length;
  $('#recurring-due').textContent=`${due} payment${due===1?'':'s'} ready to record`;
  $('#post-recurring').disabled=!due;
  renderForecastResults();renderPaymentPlan();
}
function renderForecastInputs(forecast){
  const disabled=state.payroll.payments===12?'disabled':'';
  $('#forecast-inputs').innerHTML=forecast.rows.map(r=>`<tr data-month="${r.month}"><th scope="row">${monthLabel(r.month)}</th>${['gross','mealDays','holiday','christmas'].map(k=>`<td><input type="number" data-field="${k}" aria-label="${k} ${r.month}" value="${k==='mealDays'?r[k]:eurInput(r[k])}" min="0" max="${k==='mealDays'?31:1000000000}" step="${k==='mealDays'?1:'.01'}" ${['holiday','christmas'].includes(k)?disabled:'required'}></td>`).join('')}</tr>`).join('');
}
function renderForecastResults(){
  try{
    const result=projectYear(state),t=result.totals;
    $('#forecast-summary').innerHTML=[['Expected bank deposits',t.bank],['Meal-card value',t.mealCard],['Bank remainder',t.remaining]].map(([label,value])=>`<div><span>${label}</span><strong>${money(value)}</strong><small>${dateLabel(state.forecast.start)} – ${dateLabel(state.forecast.end)}</small></div>`).join('');
    $('#forecast-results').innerHTML=result.rows.map(r=>`<tr><th scope="row">${dateLabel(r.payDate)}</th>${['bank','mealCard','irs','ss','recurring','loans','other','investments','remaining'].map(k=>`<td class="${k==='remaining'?(r[k]<0?'negative':'positive'):''}">${money(r[k])}</td>`).join('')}</tr>`).join('');
    $('#forecast-error').textContent='';
  }catch(error){$('#forecast-error').textContent=error.message;$('#forecast-summary').innerHTML='';$('#forecast-results').innerHTML='';}
}
function renderCashSummary(target,month){
  const plan=cashPlan(state,month,today());
  $(target).innerHTML=[['Recorded cash',plan.cash],['Reserved payments',plan.reserved],['Available cash',plan.available]].map(([label,value])=>`<div><span>${label}</span><strong class="${value<0?'negative':''}">${money(value)}</strong></div>`).join('');
}
function renderPaymentPlan(){
  const month=$('#budget-month').value||today().slice(0,7),plan=cashPlan(state,month,today());
  renderCashSummary('#planning-cash',month);
  const salary=projectYear(state).rows.find(r=>r.month===month);
  $('#next-payday').textContent=salary&&salary.bank?`Expected salary: ${money(salary.bank)} on ${dateLabel(salary.payDate)}. Record the deposit in Transactions when received; it is not added to available cash automatically.`:'No salary payday in this month’s saved plan.';
  $('#payment-list').innerHTML=plan.pending.map(p=>`<div class="commitment-row payment-row"><div><strong>${escape(p.description)}</strong><small>${p.kind==='loan'?'Loan instalment':p.kind==='investment'?'Investment contribution':'Monthly expense'} · ${dateLabel(p.date)} · ${escape(accountName(p.accountId))}${p.date<today()?' · Overdue':''}</small></div><strong>${money(p.amount)}</strong><div><button class="button secondary" data-payment-kind="${p.kind}" data-payment-source="${escape(p.sourceId)}" data-payment-month="${p.month}" ${p.date>today()?'disabled':''}>${p.kind==='investment'?'Record contribution':'Record paid'}</button></div></div>`).join('')||'<p class="empty">No unpaid commitments through this month.</p>';
}
$('#budget-month').value=today().slice(0,7);
$('#budget-month').addEventListener('change',()=>{if($('#budget-month').value&&$('#budget-month').checkValidity())renderPaymentPlan();});
$('#payment-list').addEventListener('click',event=>{
  const b=event.target.closest('[data-payment-kind]');if(!b)return;
  if(b.dataset.paymentKind==='investment')return openContribution(state.investmentPlans.find(p=>p.id===b.dataset.paymentSource),b.dataset.paymentMonth);
  try{
    const next=postDueExpenses(state,today(),()=>crypto.randomUUID(),{kind:b.dataset.paymentKind,sourceId:b.dataset.paymentSource,month:b.dataset.paymentMonth});
    if(next.transactions.length>state.transactions.length&&save(next)){render();toast('Payment recorded.');}
  }catch(error){toast(error.message,true);}
});
for(const id of ['forecast-start','forecast-end'])$('#'+id).addEventListener('change',()=>{
  const start=$('#forecast-start').value,end=$('#forecast-end').value;
  if(!start||!end||end<start||!$('#forecast-start').checkValidity()||!$('#forecast-end').checkValidity())return;
  const draft=[...$('#forecast-inputs').rows].map(tr=>{const row={month:tr.dataset.month};for(const input of tr.querySelectorAll('input'))row[input.dataset.field]=input.dataset.field==='mealDays'?Number(input.value):Math.round(Number(input.value)*100);return row;});
  const fresh=defaultForecast({...state.payroll,month:start.slice(0,7)});
  fresh.rows=fresh.rows.filter(r=>r.month<=end.slice(0,7)).map(r=>draft.find(old=>old.month===r.month)||state.forecast.rows.find(old=>old.month===r.month)||r);
  renderForecastInputs(fresh);
});
$('#reset-forecast').addEventListener('click',()=>{
  if(confirm('Replace this salary plan with your saved salary settings? Monthly expenses and loans stay unchanged.')&&save({...state,forecast:defaultForecast(state.payroll)}))render();
});
$('#forecast-form').addEventListener('submit',event=>{
  event.preventDefault();try{
    const rows=[...$('#forecast-inputs').rows].map(tr=>{const row={month:tr.dataset.month};for(const input of tr.querySelectorAll('input'))row[input.dataset.field]=input.dataset.field==='mealDays'?Number(input.value):cents(input.value||'0');return row;});
    const forecast={start:$('#forecast-start').value,end:$('#forecast-end').value,payDay:Number($('#forecast-payday').value),rows};validateForecast(forecast);projectYear(state,forecast);
    if(save({...state,forecast})){render();toast('Expected salary plan saved.');}
  }catch(error){$('#forecast-error').textContent=error.message;}
});
function openRecurring(r){
  const f=$('#recurring-form');f.elements.category.innerHTML=CATEGORIES.map(c=>`<option>${c}</option>`).join('');f.elements.accountId.innerHTML='<option value="">Unassigned</option>'+accountOptions();
  openRecord('recurring-form',r?{...r,amount:eurInput(r.amount),accountId:r.accountId||''}:{id:'',start:today(),end:'',day:Number(today().slice(8)),category:'Other'});
  f.elements.enabled.checked=r?r.enabled:true;
}
$('#add-recurring').addEventListener('click',()=>openRecurring());
$('#recurring-form').addEventListener('submit',event=>{
  event.preventDefault();const f=event.currentTarget;try{
    const v=Object.fromEntries(new FormData(f)),old=state.recurring.find(r=>r.id===v.id);
    if(v.id&&!old)throw new Error('This monthly expense was removed in another tab.');
    const rule={...v,id:v.id||crypto.randomUUID(),description:v.description.trim(),amount:cents(v.amount),accountId:v.accountId||null,day:Number(v.day),enabled:f.elements.enabled.checked,posted:old?.posted||[]};
    commitRecord(f,{...state,recurring:old?state.recurring.map(r=>r.id===v.id?rule:r):[...state.recurring,rule]});
  }catch(error){f.querySelector('.error').textContent=error.message;}
});
$('#recurring-list').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.recurringEdit)return openRecurring(state.recurring.find(r=>r.id===b.dataset.recurringEdit));
  if(b.dataset.recurringToggle&&save({...state,recurring:state.recurring.map(r=>r.id===b.dataset.recurringToggle?{...r,enabled:!r.enabled}:r)}))render();
  if(b.dataset.recurringDelete&&confirm('Delete this monthly expense rule? Already recorded transactions stay unchanged.')&&save({...state,recurring:state.recurring.filter(r=>r.id!==b.dataset.recurringDelete)}))render();
});
$('#post-recurring').addEventListener('click',()=>{
  try{const next=postDueExpenses(state,today(),()=>crypto.randomUUID()),count=next.transactions.length-state.transactions.length;
    if(count&&save(next)){render();toast(`${count} due payment${count===1?'':'s'} recorded.`);}
  }catch(error){toast(error.message,true);}
});
let loanComparison=null;
function renderLoans(){
  const selected=$('#selected-loan').value;
  $('#selected-loan').innerHTML=state.loans.map(l=>`<option value="${escape(l.id)}">${escape(l.name)}</option>`).join('');
  if(state.loans.some(l=>l.id===selected))$('#selected-loan').value=selected;
  $('#loan-simulator').hidden=!state.loans.length;
  $('#loan-cards').innerHTML=state.loans.map(l=>`<article class="panel account-card"><div class="panel-heading"><span class="pill">${LOAN_KINDS[l.kind]}</span><span class="muted">${l.tracked?'In monthly plan':'Simulation only'}</span></div><h2>${escape(l.name)}</h2><div class="stat-number">${money(l.balance)}</div><small class="muted">Principal at start of schedule · ${l.posted.length} payment(s) recorded</small><p class="muted">${dateLabel(l.start)} – ${dateLabel(l.end)} · ${l.months} payments on day ${l.paymentDay} · ${escape(accountName(l.accountId))}<br>TAN ${percent(l.tan)} · TAEG ${l.taeg===null?'not entered':percent(l.taeg)}</p><div class="button-row"><button class="button secondary" data-loan-explore="${escape(l.id)}">Explore</button><button class="icon-button" data-loan-edit="${escape(l.id)}">Edit</button><button class="icon-button" data-loan-delete="${escape(l.id)}">Delete</button></div></article>`).join('')||'<article class="panel"><p class="empty">Add your car, home or personal loan.<br>Start with the remaining balance and term from your lender.</p></article>';
  updateLoanSimulation();
}
function scenarioValues(){
  const f=$('#scenario-form'),v=Object.fromEntries(new FormData(f));
  return {lump:v.mode==='recurring'?0:cents(v.lump||'0'),recurring:v.mode==='once'?0:cents(v.recurring||'0'),after:Number(v.after),interval:Number(v.interval||1),feeRate:v.feeRate===''?null:Number(v.feeRate),feeTax:Number(v.feeTax)};
}
function toggleScenario(){
  const f=$('#scenario-form'),mode=f.elements.mode.value;
  $('#lump-field').hidden=mode==='recurring';f.elements.lump.disabled=mode==='recurring';
  $('#recurring-fields').hidden=mode==='once';f.elements.recurring.disabled=mode==='once';f.elements.interval.disabled=mode==='once';
}
function updateLoanSimulation(){
  const loan=state.loans.find(l=>l.id===$('#selected-loan').value);loanComparison=null;
  if(!loan)return;
  toggleScenario();$('#scenario-form').elements.after.max=loan.months-1;
  $('#loan-terms').textContent=`${money(loan.balance)} principal · ${loan.months} months from ${monthLabel(loan.firstMonth)} · ${loan.rateType} TAN ${percent(loan.tan)} · TAEG ${loan.taeg===null?'not entered':percent(loan.taeg)} · ${money(loan.monthlyCosts)} monthly costs · interest duty ${percent(loan.interestTax)}.`;
  try{
    const s=scenarioValues(),{baseline,shorter,lower}=compareLoan(loan,s);loanComparison={loan,baseline,shorter};
    const row=(label,value)=>`<div><span>${label}</span><strong>${value}</strong></div>`;
    $('#loan-result').innerHTML=`<p class="eyebrow">YOUR EARLIER FINISH</p><div class="tax-total">${shorter.monthsSaved} months sooner</div><p class="tax-result-caption">${shorter.months===0?'Paid off before the first instalment':`Debt-free ${monthLabel(shorter.payoffMonth)}`} · originally ${monthLabel(baseline.payoffMonth)}</p><div class="tax-breakdown">${row('Regular instalment kept',money(baseline.originalPayment))}${row('Term remaining',`${shorter.months} vs ${baseline.months} months`)}${row('Interest saved',money(shorter.interestSaved))}${row('Extra principal repaid',money(shorter.extra))}${row('Repayment fees + stamp duty',money(shorter.fee+shorter.feeTax))}${row('Net savings after fees',money(shorter.savings))}</div><p class="tax-result-note">Net savings compare all remaining cash outflows, including entered interest tax and monthly costs. The regular instalment excludes those costs and extra repayments. Recurring extras stop at payoff and are capped at the balance left.</p><details class="calculation-details"><summary>Compare with reducing the instalment</summary><p>With the same extra-payment instructions, recalculating the instalment after each overpayment gives a ${lower.months}-month term and ${money(lower.savings)} net savings. Keeping the instalment saves ${money(shorter.savings-lower.savings)} more in this scenario.</p></details>`;
    const plot=result=>[[0,loan.balance],...result.rows.map(r=>[r.period,r.balance])].map(([x,y])=>`${45+x/baseline.months*610},${20+(1-y/loan.balance)*180}`).join(' ');
    $('#loan-chart').innerHTML=`<div class="panel-heading"><h2>Your balance, falling faster</h2><span class="muted">Grey: original · Green: extra payments</span></div><svg viewBox="0 0 700 235" role="img" aria-label="Original loan paid in ${baseline.months} months, extra-payment scenario in ${shorter.months}." class="loan-svg"><line x1="45" x2="655" y1="200" y2="200" stroke="#d9dfd0"/><polyline points="${plot(baseline)}" fill="none" stroke="#b2bbad" stroke-width="3"/><polyline points="${plot(shorter)}" fill="none" stroke="#345f43" stroke-width="3"/><text x="45" y="13">${money(loan.balance)}</text><text x="45" y="226">Start</text><text x="565" y="226">Month ${baseline.months}</text></svg>`;
    $('#loan-schedule').innerHTML=shorter.rows.map(r=>`<tr><td>${r.period||'Before first'}</td><td>${monthLabel(r.month)}</td>${[r.payment,r.interest,r.interestTax+r.costs,r.extra,r.fee+r.feeTax,r.total,r.balance].map(v=>`<td>${money(v)}</td>`).join('')}</tr>`).join('');
    $('#scenario-error').textContent='';$('#export-loan').disabled=false;
  }catch(error){$('#scenario-error').textContent=error.message;$('#loan-result').innerHTML='<p class="empty">Adjust the scenario to see your earlier payoff.</p>';$('#loan-chart').innerHTML='';$('#loan-schedule').innerHTML='';$('#export-loan').disabled=true;}
}
function updateLoanDates(){
  const f=$('#loan-form');
  try{const term=loanDates(f.elements.start.value,f.elements.end.value,Number(f.elements.paymentDay.value));$('#loan-date-summary').textContent=`${term.months} payments, starting ${dateLabel(dueDate(term.firstMonth,Number(f.elements.paymentDay.value)))}. Enter principal outstanding before this first payment.`;}
  catch(error){$('#loan-date-summary').textContent=error.message;}
}
function openLoan(l){
  $('#loan-form').elements.accountId.innerHTML='<option value="">Unassigned</option>'+accountOptions();
  openRecord('loan-form',l?{...l,balance:eurInput(l.balance),monthlyCosts:eurInput(l.monthlyCosts),taeg:l.taeg??'',accountId:l.accountId||''}:{id:'',start:today(),end:'',paymentDay:Number(today().slice(8)),monthlyCosts:0,interestTax:0,kind:'mortgage',rateType:'variable'});
  $('#loan-form').elements.tracked.checked=l?l.tracked:true;updateLoanDates();
}
for(const name of ['start','end','paymentDay'])$('#loan-form').elements[name].addEventListener('input',updateLoanDates);
$('#add-loan').addEventListener('click',()=>openLoan());
$('#loan-form').elements.kind.addEventListener('change',()=>{$('#loan-form').elements.interestTax.value=$('#loan-form').elements.kind.value==='mortgage'?0:4;});
$('#loan-form').addEventListener('submit',event=>{
  event.preventDefault();const f=event.currentTarget;try{
    const v=Object.fromEntries(new FormData(f));
    const old=state.loans.find(l=>l.id===v.id);
    const loan={...v,...loanDates(v.start,v.end,Number(v.paymentDay)),id:v.id||crypto.randomUUID(),name:v.name.trim(),balance:cents(v.balance),paymentDay:Number(v.paymentDay),accountId:v.accountId||null,posted:old?.posted||[],tan:Number(v.tan),taeg:v.taeg===''?null:Number(v.taeg),monthlyCosts:cents(v.monthlyCosts||'0'),interestTax:Number(v.interestTax),tracked:f.elements.tracked.checked};
    if(v.id&&!state.loans.some(l=>l.id===v.id))throw new Error('This loan was removed in another tab.');
    amortize(loan);
    commitRecord(f,{...state,loans:v.id?state.loans.map(l=>l.id===v.id?loan:l):[...state.loans,loan]});
    $('#selected-loan').value=loan.id;updateLoanSimulation();
  }catch(error){f.querySelector('.error').textContent=error.message;}
});
$('#loan-cards').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.loanEdit)return openLoan(state.loans.find(l=>l.id===b.dataset.loanEdit));
  if(b.dataset.loanExplore){$('#selected-loan').value=b.dataset.loanExplore;updateLoanSimulation();$('#loan-simulator').scrollIntoView({block:'start'});}
  if(b.dataset.loanDelete&&confirm('Delete this loan? Recorded transactions stay unchanged.')&&save({...state,loans:state.loans.filter(l=>l.id!==b.dataset.loanDelete)}))render();
});
$('#selected-loan').addEventListener('change',()=>{$('#scenario-form').reset();updateLoanSimulation();});
$('#scenario-form').addEventListener('input',updateLoanSimulation);
$('#scenario-form').addEventListener('submit',event=>{event.preventDefault();updateLoanSimulation();});
$('#export-loan').addEventListener('click',()=>{
  if(!loanComparison)return;
  const rows=[['Period','Month','Opening EUR','Regular payment EUR','Principal EUR','Interest EUR','Interest tax EUR','Monthly costs EUR','Extra principal EUR','Fee EUR','Fee duty EUR','Total cash EUR','Balance EUR'],...loanComparison.shorter.rows.map(r=>[r.period,r.month,...['opening','payment','principal','interest','interestTax','costs','extra','fee','feeTax','total','balance'].map(k=>eurInput(r[k]))])];
  download(`conta-loan-schedule-${today()}.csv`,'\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
});

function openHolding(values={id:'',updated:today(),kind:'ETF',valuation:'units',units:0,cost:'0.00'}){
  openRecord('holding-form',values);toggleHoldingValuation();
}
function toggleHoldingValuation(){
  const f=$('#holding-form'),balance=f.elements.valuation.value==='balance';
  $('#holding-units-label').hidden=balance;f.elements.units.disabled=balance;
  $('#holding-price-label').textContent=balance?'Current total statement value (€)':'Current unit price (€)';
}
$('#holding-form').elements.valuation.addEventListener('change',toggleHoldingValuation);
$('#add-ppr').addEventListener('click',()=>openHolding({id:'',name:'Seguro PPR+ Ações',broker:'Santander Totta Seguros',kind:'PPR / Insurance',valuation:'balance',units:1,cost:'0.00',updated:today()}));
function holdingOptions(){return state.holdings.map(h=>`<option value="${escape(h.id)}">${escape(h.name)}</option>`).join('');}
function renderInvestments(){
  $('#add-investment-plan').disabled=!state.holdings.length;$('#add-contribution').disabled=!state.holdings.length;
  $('#investment-plans').innerHTML=state.investmentPlans.map(p=>{
    const h=state.holdings.find(h=>h.id===p.holdingId);
    return `<div class="commitment-row"><div><strong>${escape(h.name)}</strong><small>${dateLabel(p.start)} – ${dateLabel(p.end)} · Day ${p.day} · ${escape(accountName(p.accountId))} · ${p.enabled?'Active':'Paused'} · Assumed ${percent(p.annualRate)} yearly</small></div><strong>${money(p.amount)}<small>per month</small></strong><div><button class="icon-button" data-investment-edit="${escape(p.id)}">Edit</button><button class="icon-button" data-investment-delete="${escape(p.id)}">Delete plan</button></div></div>`;
  }).join('')||'<p class="empty">Add a holding, then set a monthly contribution and your assumed growth rate.</p>';
  $('#investment-projection').innerHTML=state.investmentPlans.map(p=>{
    try{
      const h=state.holdings.find(h=>h.id===p.holdingId),projection=projectInvestment(p),actual=Math.round(h.units*h.price*100),comparison=projectInvestment(p,h.updated);
      const contributed=state.contributions.filter(c=>c.holdingId===h.id&&c.date>=p.start&&c.date<=h.updated).reduce((sum,c)=>sum+c.amount,0);
      const points=projection.rows.filter((r,i)=>i%12===0||i===projection.rows.length-1),max=Math.max(1,...points.map(r=>r.value));
      const poly=points.map((r,i)=>`${40+i/Math.max(1,points.length-1)*620},${180-r.value/max*160}`).join(' ');
      return `<section class="spaced"><h3>${escape(h.name)}</h3><div class="plan-summary spaced">${[['Projected end value',projection.value],['Planned contributions',projection.contributed],['Projected growth',projection.growth]].map(([label,value])=>`<div><span>${label}</span><strong>${money(value)}</strong></div>`).join('')}</div><svg class="loan-svg" viewBox="0 0 700 220" role="img" aria-label="Projected investment value from ${escape(p.start)} to ${escape(p.end)}: ${money(projection.value)}"><polyline points="${poly}" fill="none" stroke="#345f43" stroke-width="3"/><text x="40" y="205">${escape(p.start)}</text><text x="555" y="205">${escape(p.end)}</text></svg><p class="scope-note">Initial value: ${money(p.initialValue)}. Actual value at ${dateLabel(h.updated)}: <strong>${money(actual)}</strong>. ${h.updated>=p.start&&h.updated<=p.end?`Planned value at that date: ${money(comparison.value)} · Difference: ${money(actual-comparison.value)}. Recorded contributions since plan start: ${money(contributed)} versus planned ${money(comparison.contributed)}.`:'Update the holding’s value within the plan dates to compare progress.'} Current gain/loss versus cost basis: ${money(actual-h.cost)}. <button class="text-button" data-investment-holding="${escape(h.id)}">Update actual value</button></p></section>`;
    }catch(error){return `<p class="error">${escape(error.message)}</p>`;}
  }).join('');
  $('#contribution-rows').innerHTML=sorted(state.contributions).map(c=>`<tr><td>${dateLabel(c.date)}</td><td>${escape(state.holdings.find(h=>h.id===c.holdingId)?.name||'Investment')}</td><td>${escape(accountName(c.accountId))}</td><td>${money(c.amount)}</td><td>${c.units||'Statement value'}</td><td><button class="icon-button" data-contribution-undo="${escape(c.id)}">Undo</button></td></tr>`).join('');
}
function openInvestmentPlan(p){
  const f=$('#investment-plan-form');f.elements.holdingId.innerHTML=holdingOptions();f.elements.accountId.innerHTML='<option value="">Unassigned</option>'+accountOptions();
  const h=state.holdings.find(h=>h.id===p?.holdingId)||state.holdings[0];
  openRecord('investment-plan-form',p?{...p,amount:eurInput(p.amount),initialValue:eurInput(p.initialValue),accountId:p.accountId||''}:{id:'',holdingId:h.id,start:today(),end:`${Math.min(2100,Number(today().slice(0,4))+20)}-12-31`,day:Number(today().slice(8)),initialValue:eurInput(Math.round(h.units*h.price*100)),annualRate:0});
  f.elements.enabled.checked=p?p.enabled:true;f.elements.holdingId.disabled=!!p;
}
$('#add-investment-plan').addEventListener('click',()=>openInvestmentPlan());
$('#investment-plan-form').elements.holdingId.addEventListener('change',event=>{const h=state.holdings.find(h=>h.id===event.target.value);$('#investment-plan-form').elements.initialValue.value=eurInput(Math.round(h.units*h.price*100));});
$('#investment-plan-form').addEventListener('submit',event=>{
  event.preventDefault();const f=event.currentTarget;
  try{
    const v=Object.fromEntries(new FormData(f)),old=state.investmentPlans.find(p=>p.id===v.id);
    if(v.id&&!old)throw new Error('This plan was removed in another tab.');
    const plan=validateInvestmentPlan({...v,id:v.id||crypto.randomUUID(),holdingId:f.elements.holdingId.value,accountId:v.accountId||null,amount:cents(v.amount),initialValue:cents(v.initialValue),annualRate:Number(v.annualRate),day:Number(v.day),enabled:f.elements.enabled.checked,posted:old?.posted||[]});
    projectInvestment(plan);
    commitRecord(f,{...state,investmentPlans:old?state.investmentPlans.map(p=>p.id===old.id?plan:p):[...state.investmentPlans,plan]});
  }catch(error){f.querySelector('.error').textContent=error.message;}
});
$('#investment-plans').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.investmentEdit)return openInvestmentPlan(state.investmentPlans.find(p=>p.id===b.dataset.investmentEdit));
  if(b.dataset.investmentDelete&&confirm('Delete this contribution plan? Recorded contributions and holdings remain unchanged.')&&save({...state,investmentPlans:state.investmentPlans.filter(p=>p.id!==b.dataset.investmentDelete)}))render();
});
$('#investment-projection').addEventListener('click',event=>{const b=event.target.closest('[data-investment-holding]');if(b){const h=state.holdings.find(h=>h.id===b.dataset.investmentHolding);openHolding({...h,cost:eurInput(h.cost)});}});
function toggleContribution(){
  const f=$('#contribution-form'),h=state.holdings.find(h=>h.id===f.elements.holdingId.value),balance=h?.valuation==='balance';
  $('#contribution-units-label').hidden=balance;f.elements.units.disabled=balance;
  $('#contribution-price-label').textContent=balance?'Total statement value after contribution (€)':'Unit price on payment date (€)';
  f.elements.price.value=h?.price??'';
}
function openContribution(plan=null,month=null){
  const f=$('#contribution-form');f.elements.holdingId.innerHTML=holdingOptions();f.elements.accountId.innerHTML='<option value="">Unassigned</option>'+accountOptions();
  openRecord('contribution-form',plan?{planId:plan.id,occurrence:month,holdingId:plan.holdingId,accountId:plan.accountId||'',amount:eurInput(plan.amount),date:dueDate(month,plan.day)}:{planId:'',occurrence:'',holdingId:state.holdings[0].id,date:today()});
  f.elements.holdingId.disabled=!!plan;f.elements.date.max=today();toggleContribution();
  if(state.holdings.find(h=>h.id===f.elements.holdingId.value)?.valuation==='balance')f.elements.price.value='';
}
$('#add-contribution').addEventListener('click',()=>openContribution());
$('#contribution-form').elements.holdingId.addEventListener('change',toggleContribution);
$('#contribution-form').addEventListener('submit',event=>{
  event.preventDefault();const f=event.currentTarget;
  try{
    const v=Object.fromEntries(new FormData(f)),holdingId=f.elements.holdingId.value;
    if(v.date>today())throw new Error('Record a contribution only after it is paid.');
    const entry={id:crypto.randomUUID(),holdingId,accountId:v.accountId||null,date:v.date,amount:cents(v.amount),units:Number(v.units||0),price:Number(v.price),...(v.planId?{planId:v.planId,occurrence:v.occurrence}:{})};
    commitRecord(f,recordContribution(state,entry));
  }catch(error){f.querySelector('.error').textContent=error.message;}
});
$('#contribution-rows').addEventListener('click',event=>{
  const b=event.target.closest('[data-contribution-undo]');if(!b)return;
  if(confirm('Undo this contribution, restoring cash, cost basis and units? The latest price or statement value is kept; update it separately if needed.'))try{if(save(undoContribution(state,b.dataset.contributionUndo)))render();}catch(error){toast(error.message,true);}
});

render();
if(storageBlocked)toast('Saved data is unreadable or storage is unavailable. Existing storage has not been overwritten. Check Your data before continuing.',true);
