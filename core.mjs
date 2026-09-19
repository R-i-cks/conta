import {validateInvestmentPlan} from './investments.mjs';
import {validateLoan, validMonth, validDate} from './loans.mjs';
import {defaultForecast, validateForecast} from './planning.mjs';
import {defaultPayroll, validatePayroll} from './payroll.mjs';
// Mainland Portugal, income year 2026. Verified 2026-09-18.
// CIRS articles 68, 68-A and 69; official sources linked in the UI and README.
export const BRACKETS = [
  [8342, 12.5, 12.5], [12587, 15.7, 13.579], [17838, 21.2, 15.823],
  [23089, 24.1, 17.705], [29397, 31.1, 20.579], [43090, 34.9, 25.130],
  [46566, 43.1, 26.472], [86634, 44.6, 34.856], [Infinity, 48, null],
];
export const CATEGORIES = ['Salary', 'Other income', 'Housing', 'Groceries', 'Transport', 'Dining', 'Shopping', 'Health', 'Leisure', 'Utilities', 'Other'];
export function cents(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a positive amount with at most two decimal places.');
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || result > 100_000_000_000) throw new Error('Amount is too large.');
  return result;
}
export function calculateTax(taxableCents, joint = false) {
  if (!Number.isSafeInteger(taxableCents) || taxableCents < 0 || taxableCents > 100_000_000_000) throw new Error('Invalid taxable income.');
  const divisor = joint ? 2 : 1;
  const income = taxableCents / 100 / divisor;
  const index = BRACKETS.findIndex(([limit]) => income <= limit);
  const [upper, rate] = BRACKETS[index];
  const lower = index ? BRACKETS[index - 1][0] : 0;
  // Article 68(2): previous completed bracket at published average rate,
  // plus the excess at the current marginal rate. Preserve precision until the end.
  const base = index ? lower * BRACKETS[index - 1][2] / 100 : 0;
  const general = Math.round((base + (income - lower) * rate / 100) * divisor * 100);
  const solidarity = Math.round((Math.max(0, Math.min(income, 250000) - 80000) * .025 + Math.max(0, income - 250000) * .05) * divisor * 100);
  const slices=BRACKETS.map(([limit,bandRate],i)=>{
    const start=i?BRACKETS[i-1][0]:0;
    const amount=Math.max(0,Math.min(income,limit)-start);
    return {amount:Math.round(amount*100*divisor),rate:bandRate,tax:Math.round(amount*bandRate*divisor)};
  });
  return {general, solidarity, slices, total: general + solidarity, rate, index, lower, upper, income, divisor, effective: taxableCents ? (general + solidarity) / taxableCents * 100 : 0};
}
export function validateState(data) {
  if (!data || ![1,2,3,4].includes(data.version) || typeof data.demo !== 'boolean' || !Array.isArray(data.transactions) || data.transactions.length > 50000) throw new Error('This is not a valid Conta backup.');
  const legacy=data.version===1;
  const accounts=legacy?[]:data.accounts;
  const transfers=legacy?[]:data.transfers;
  const holdings=legacy?[]:data.holdings;
  const snapshots=legacy?[]:data.snapshots;
  for(const list of [accounts,transfers,holdings,snapshots]) if(!Array.isArray(list)||list.length>50000) throw new Error('Invalid workspace records.');
  const accountIds=new Set();
  for(const a of accounts) {
    if(!a||!validText(a.id,100)||accountIds.has(a.id)||!validText(a.name,80)||!validText(a.bank,80)||!['Current','Savings','Brokerage cash','Cash'].includes(a.kind)||!validMoney(a.opening,true)) throw new Error('Invalid bank account.');
    accountIds.add(a.id);
  }
  const ids = new Set();
  for (const t of data.transactions) {
    if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 100 || ids.has(t.id) || typeof t.description !== 'string' || !t.description.trim() || t.description.length > 120 || !['income', 'expense'].includes(t.type) || !CATEGORIES.includes(t.category) || !Number.isSafeInteger(t.amount) || t.amount <= 0 || t.amount > 100_000_000_000 || typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || t.date < '1900-01-01' || t.date > '2100-12-31' || new Date(t.date + 'T12:00:00Z').toISOString().slice(0, 10) !== t.date) throw new Error('Backup contains an invalid transaction. Nothing was imported.');
    ids.add(t.id);
    if(!legacy && t.accountId!==null && !accountIds.has(t.accountId)) throw new Error('Transaction refers to a missing account.');
  }
  if (!data.tax || typeof data.tax.joint !== 'boolean' || !(data.tax.taxable === null || Number.isSafeInteger(data.tax.taxable) && data.tax.taxable >= 0 && data.tax.taxable <= 100_000_000_000)) throw new Error('Backup has invalid tax settings.');
  const transferIds=new Set();
  for(const t of transfers) {
    if(!t||!validText(t.id,100)||transferIds.has(t.id)||!accountIds.has(t.from)||!accountIds.has(t.to)||t.from===t.to||!validMoney(t.amount)||t.amount===0||!validDate(t.date)) throw new Error('Invalid account transfer.');
    transferIds.add(t.id);
  }
  const holdingIds=new Set();
  for(const h of holdings) {
    if(!h||!validText(h.id,100)||holdingIds.has(h.id)||!validText(h.name,100)||!(typeof h.symbol==='string'&&h.symbol.length<=20)||!validText(h.broker,80)||!ASSET_TYPES.includes(h.kind)||!Number.isFinite(h.units)||h.units<0||h.units>1e9||!validMoney(h.cost)||!Number.isFinite(h.price)||h.price<0||h.price>1e9||!validMoney(Math.round(h.units*h.price*100))||!validDate(h.updated)||!(h.valuation===undefined||['units','balance'].includes(h.valuation))||(h.valuation==='balance'&&h.units!==1)) throw new Error('Invalid investment holding.');
    holdingIds.add(h.id);
  }
  const snapshotDates=new Set();
  for(const s of snapshots) {
    if(!s||!validDate(s.date)||snapshotDates.has(s.date)||!validMoney(s.cash,true)||!validMoney(s.investments)||!validMoney(s.cost)) throw new Error('Invalid portfolio snapshot.');
    snapshotDates.add(s.date);
  }
  const payroll=legacy?defaultPayroll():validatePayroll(data.payroll);
  const recurring=data.version<3?[]:data.recurring,rawLoans=data.version<3?[]:data.loans;
  const loans=Array.isArray(rawLoans)?rawLoans.map(validateLoan):rawLoans;
  if(!Array.isArray(recurring)||!Array.isArray(loans)||recurring.length>1000||loans.length>1000)throw new Error('Invalid planning records.');
  const ruleIds=new Set(),loanIds=new Set(),occurrences=new Set();
  for(const r of recurring){
    if(!r||!validText(r.id,100)||ruleIds.has(r.id)||!validText(r.description,120)||!CATEGORIES.includes(r.category)||!validMoney(r.amount)||!r.amount||!(r.accountId===null||accountIds.has(r.accountId))||!validDate(r.start)||!(r.end===''||validDate(r.end)&&r.end>=r.start)||!Number.isInteger(r.day)||r.day<1||r.day>31||typeof r.enabled!=='boolean'||!Array.isArray(r.posted)||r.posted.length>2600||!r.posted.every(validMonth)||new Set(r.posted).size!==r.posted.length)throw new Error('Invalid recurring expense.');
    ruleIds.add(r.id);
  }
  for(const l of loans){if(l.accountId!==null&&!accountIds.has(l.accountId))throw new Error('Loan refers to a missing account.');if(loanIds.has(l.id))throw new Error('Duplicate loan.');loanIds.add(l.id);}
  for(const t of data.transactions)if(data.version>=3&&(t.recurringId!==undefined||t.loanId!==undefined||t.occurrence!==undefined)){
    const kind=t.loanId!==undefined?'loan':'recurring',id=kind==='loan'?t.loanId:t.recurringId;
    const key=JSON.stringify([kind,id,t.occurrence]);
    if(!validText(id,100)||!validMonth(t.occurrence)||t.type!=='expense'||occurrences.has(key)||(t.loanId!==undefined&&t.recurringId!==undefined))throw new Error('Invalid or duplicate payment occurrence.');
    const source=(kind==='loan'?loans:recurring).find(r=>r.id===id);
    if(source&&!source.posted.includes(t.occurrence))throw new Error('Payment is missing from its posting history.');
    occurrences.add(key);
  }
  const investmentPlans=data.version<4?[]:data.investmentPlans,contributions=data.version<4?[]:data.contributions;
  if(!Array.isArray(investmentPlans)||investmentPlans.length>1000||!Array.isArray(contributions)||contributions.length>50000)throw new Error('Invalid investment records.');
  const planIds=new Set(),plannedHoldings=new Set(),contributionIds=new Set(),contributionOccurrences=new Set();
  for(const p of investmentPlans){
    validateInvestmentPlan(p);
    if(planIds.has(p.id)||plannedHoldings.has(p.holdingId)||!holdingIds.has(p.holdingId)||(p.accountId!==null&&!accountIds.has(p.accountId)))throw new Error('Choose an existing investment/account and one recurring plan per holding.');
    planIds.add(p.id);plannedHoldings.add(p.holdingId);
  }
  for(const c of contributions){
    if(!c||!validText(c.id,100)||contributionIds.has(c.id)||!holdingIds.has(c.holdingId)||(c.accountId!==null&&!accountIds.has(c.accountId))||!validMoney(c.amount)||!c.amount||!validDate(c.date)||!Number.isFinite(c.units)||c.units<0||c.units>1e9)throw new Error('Invalid investment contribution.');
    contributionIds.add(c.id);
    if(c.planId!==undefined||c.occurrence!==undefined){
      const key=JSON.stringify([c.planId,c.occurrence]),plan=investmentPlans.find(p=>p.id===c.planId);
      if(!validText(c.planId,100)||!validMonth(c.occurrence)||contributionOccurrences.has(key)||(plan&&(plan.holdingId!==c.holdingId||!plan.posted.includes(c.occurrence))))throw new Error('Invalid or duplicate investment contribution.');
      contributionOccurrences.add(key);
    }
  }
  return {version:4,demo:data.demo,
    investmentPlans:investmentPlans.map(validateInvestmentPlan),contributions:contributions.map(({id,holdingId,accountId,date,amount,units,planId,occurrence})=>({id,holdingId,accountId,date,amount,units,...(planId?{planId,occurrence}:{})})),
    recurring:recurring.map(({id,description,category,amount,accountId,start,end,day,enabled,posted})=>({id,description,category,amount,accountId,start,end,day,enabled,posted:[...posted]})),
    loans:loans.map(validateLoan),forecast:data.version<3?defaultForecast(payroll):validateForecast(data.forecast),
    transactions:data.transactions.map(({id,description,type,category,amount,date,accountId,recurringId,loanId,occurrence})=>({id,description,type,category,amount,date,accountId:legacy?null:accountId,...(data.version>=3&&recurringId?{recurringId,occurrence}:{}),...(data.version>=3&&loanId?{loanId,occurrence}:{})})),
    accounts:accounts.map(({id,name,bank,kind,opening})=>({id,name,bank,kind,opening})),
    transfers:transfers.map(({id,from,to,amount,date})=>({id,from,to,amount,date})),
    holdings:holdings.map(({id,name,symbol,broker,kind,units,cost,price,updated,valuation})=>({id,name,symbol,broker,kind,units,cost,price,updated,valuation:valuation||'units'})),
    snapshots:snapshots.map(({date,cash,investments,cost})=>({date,cash,investments,cost})),
    payroll,tax:{taxable:data.tax.taxable,joint:data.tax.joint}};
}
export const ASSET_TYPES=['ETF','Stock','Bond','Fund','PPR / Insurance','Deposit','Managed portfolio','Crypto','Other'];
function validText(value,max) {return typeof value==='string'&&value.trim().length>0&&value.length<=max;}
function validMoney(value,signed=false) {return Number.isSafeInteger(value)&&value>=(signed?-100_000_000_000:0)&&value<=100_000_000_000;}
export {validDate};
export function accountBalances(state,through='2100-12-31') {
  const balances=new Map(state.accounts.map(a=>[a.id,a.opening]));
  for(const t of state.transactions) if(t.accountId&&t.date<=through) balances.set(t.accountId,balances.get(t.accountId)+(t.type==='income'?t.amount:-t.amount));
  for(const t of state.transfers) {if(t.date>through)continue;balances.set(t.from,balances.get(t.from)-t.amount);balances.set(t.to,balances.get(t.to)+t.amount);}
  for(const c of state.contributions||[])if(c.accountId&&c.date<=through)balances.set(c.accountId,balances.get(c.accountId)-c.amount);
  return balances;
}
export function portfolio(holdings) {
  const positions=holdings.map(h=>{const value=Math.round(h.units*h.price*100);return {...h,value,gain:value-h.cost,returnPct:h.cost?(value-h.cost)/h.cost*100:null};});
  const value=positions.reduce((sum,h)=>sum+h.value,0),cost=positions.reduce((sum,h)=>sum+h.cost,0);
  return {positions,value,cost,gain:value-cost,returnPct:cost?(value-cost)/cost*100:null};
}
export function monthlyOutflows(state,month) {
  const entries=state.transactions.filter(t=>t.type==='expense'&&t.date.startsWith(month));
  const sum=list=>list.reduce((total,item)=>total+item.amount,0);
  const loans=sum(entries.filter(t=>t.loanId)),bills=sum(entries.filter(t=>!t.loanId&&t.recurringId));
  const invested=sum((state.contributions||[]).filter(c=>c.date.startsWith(month)));
  const categories=new Map();
  for(const t of entries) if(!t.loanId&&!t.recurringId) categories.set(t.category,(categories.get(t.category)||0)+t.amount);
  let rest=[...categories].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  if(rest.length>4) rest=[...rest.slice(0,3),['Other categories',rest.slice(3).reduce((total,[,amount])=>total+amount,0)]];
  const groups=[['Loan instalments',loans],['Monthly bills',bills],['Investments',invested],...rest]
    .filter(([,amount])=>amount>0).map(([label,amount])=>({label,amount}));
  const total=groups.reduce((sum,g)=>sum+g.amount,0);
  return {groups:groups.map(g=>({...g,share:total?g.amount/total*100:0})),total,spent:sum(entries),invested};
}
export function termLabel(months) {
  const years=Math.floor(months/12),rest=months%12,parts=[];
  if(years)parts.push(`${years} year${years===1?'':'s'}`);
  if(rest||!years)parts.push(`${rest} month${rest===1?'':'s'}`);
  return parts.join(' ');
}
export function dateLabel(value) {
  return new Intl.DateTimeFormat('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value+'T12:00:00'));
}
export function monthLabel(month) {
  return new Date(month+'-01T12:00:00').toLocaleDateString('en-GB',{month:'short',year:'numeric'});
}
export function totals(transactions) {
  return transactions.reduce((a, t) => { a[t.type] += t.amount; a.balance += t.type === 'income' ? t.amount : -t.amount; return a; }, {income: 0, expense: 0, balance: 0});
}
// Quotes doubled; a leading =, +, - or @ is neutralised so spreadsheets do not
// read the cell as a formula. Every CSV export must go through this.
export const csvCell = value => '"' + String(value).replace(/^[\s]*[=+\-@]/, "'$&").replaceAll('"', '""') + '"';
export function toCSV(transactions) {
  return '\uFEFF' + [['Date', 'Description', 'Type', 'Category', 'Amount (EUR)'], ...transactions.map(t => [t.date, t.description, t.type, t.category, (t.amount / 100).toFixed(2)])].map(row => row.map(csvCell).join(',')).join('\r\n');
}
