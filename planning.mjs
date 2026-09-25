import {calculatePayroll} from './payroll.mjs';
import {addMonth,amortize,validateLoan,validDate,validMonth,dueDate} from './loans.mjs';
import {accountTotals} from './core.mjs';
export {dueDate};
export function dueOccurrences(rule,through) {
  if(!rule.enabled)return [];
  const end=rule.end&&rule.end<through?rule.end:through,rows=[];
  for(let month=rule.start.slice(0,7);month<=end.slice(0,7);month=addMonth(month,1)) {
    const date=dueDate(month,rule.day);
    if(date>=rule.start&&date<=end&&!rule.posted.includes(month))rows.push({month,date});
  }
  return rows;
}
export function pendingPayments(state,through) {
  const payments=state.recurring.flatMap(r=>dueOccurrences(r,through).map(o=>({...o,kind:'recurring',sourceId:r.id,description:r.description,category:r.category,amount:r.amount,accountId:r.accountId})));
  for(const input of state.loans){
    const l=validateLoan(input);
    if(!l.tracked)continue;
    for(const row of amortize(l).rows){
      const date=dueDate(row.month,l.paymentDay);
      if(row.period>0&&date<=through&&!l.posted.includes(row.month))payments.push({kind:'loan',sourceId:l.id,month:row.month,date,description:l.name,category:l.kind==='mortgage'?'Housing':l.kind==='car'?'Transport':'Other',amount:row.total,principal:row.principal,accountId:l.accountId});
    }
  }
  for(const p of state.investmentPlans||[])for(const o of dueOccurrences(p,through))payments.push({...o,kind:'investment',sourceId:p.id,description:state.holdings.find(h=>h.id===p.holdingId)?.name||'Investment contribution',amount:p.amount,accountId:p.accountId});
  return payments.sort((a,b)=>a.date.localeCompare(b.date)||a.description.localeCompare(b.description));
}
export function postDueExpenses(state,through,idFactory,selection=null) {
  const due=pendingPayments(state,through).filter(p=>p.kind!=='investment').filter(p=>!selection||(p.kind===selection.kind&&p.sourceId===selection.sourceId&&p.month===selection.month));
  const transactions=[...state.transactions,...due.map(p=>({id:idFactory(),date:p.date,description:p.description,category:p.category,type:'expense',amount:p.amount,accountId:p.accountId,[p.kind==='loan'?'loanId':'recurringId']:p.sourceId,occurrence:p.month,...(p.kind==='loan'?{loanPrincipal:p.principal}:{})}))];
  const update=(items,kind)=>items.map(r=>({...r,posted:[...(r.posted||[]),...due.filter(p=>p.kind===kind&&p.sourceId===r.id).map(p=>p.month)]}));
  return {...state,transactions,recurring:update(state.recurring,'recurring'),loans:update(state.loans,'loan')};
}
export function postSalary(state,month,through,idFactory) {
  if(state.forecast.posted.includes(month))return state;
  const row=projectYear(state).rows.find(r=>r.month===month);
  if(!row)throw new Error('No salary is planned for this month.');
  if(row.payDate>through)throw new Error('Salary can be recorded on or after its payday.');
  if(row.bank&&!state.payroll.bankAccountId)throw new Error('Choose a salary bank account first.');
  if(row.mealCard&&!state.payroll.mealAccountId)throw new Error('Choose a meal-card account first.');
  const transactions=[
    ...(row.bank?[{id:idFactory(),date:row.payDate,description:'Salary',category:'Salary',type:'income',amount:row.bank,accountId:state.payroll.bankAccountId,salaryPart:'bank',occurrence:month}]:[]),
    ...(row.mealCard?[{id:idFactory(),date:row.payDate,description:'Meal allowance',category:'Salary',type:'income',amount:row.mealCard,accountId:state.payroll.mealAccountId,salaryPart:'meal',occurrence:month}]:[]),
  ];
  if(!transactions.length)throw new Error('This month has no salary to record.');
  return {...state,transactions:[...state.transactions,...transactions],forecast:{...state.forecast,posted:[...state.forecast.posted,month]}};
}
export function scheduledTransactions(state) {
  const salary=projectYear(state).rows.flatMap(row=>state.forecast.posted.includes(row.month)?[]:[
    ...(row.bank?[{id:`scheduled-salary-bank-${row.month}`,date:row.payDate,description:'Salary',category:'Salary',type:'income',amount:row.bank,accountId:state.payroll.bankAccountId,kind:'salary',scheduled:true}]:[]),
    ...(row.mealCard?[{id:`scheduled-salary-meal-${row.month}`,date:row.payDate,description:'Meal allowance',category:'Salary',type:'income',amount:row.mealCard,accountId:state.payroll.mealAccountId,kind:'salary',scheduled:true}]:[]),
  ]);
  const end=state.loans.reduce((latest,loan)=>loan.tracked&&loan.end>latest?loan.end:latest,state.forecast.end);
  // Investment plans stay out: recorded contributions are not transactions, so
  // counting them here would make money out drop once one is recorded.
  const payments=pendingPayments(state,end).filter(p=>p.kind!=='investment').map(p=>({id:`scheduled-${p.kind}-${p.sourceId}-${p.month}`,date:p.date,description:p.description,category:p.category,type:'expense',amount:p.amount,accountId:p.accountId,kind:p.kind,scheduled:true}));
  return [...salary,...payments].sort((a,b)=>a.date.localeCompare(b.date)||a.description.localeCompare(b.description));
}
export function cashPlan(state,month,asOf) {
  const end=dueDate(month,31),through=asOf<end?asOf:end;
  const {cash}=accountTotals(state,through);
  const pending=pendingPayments(state,end);
  // Recorded future outflows are reserved until their transaction date. Linked
  // unassigned payments still reserve cash until assigned to a real account.
  const recorded=state.transactions.filter(t=>t.type==='expense'&&t.date<=end&&((t.accountId&&t.date>through)||(!t.accountId&&(t.loanId||t.recurringId))));
  const contributions=(state.contributions||[]).filter(c=>c.date<=end&&(!c.accountId||c.date>through));
  const reserved=contributions.reduce((sum,c)=>sum+c.amount,0)+pending.reduce((sum,p)=>sum+p.amount,0)+recorded.reduce((sum,t)=>sum+t.amount,0);
  const available=cash-reserved,buffer=state.cashBuffer||0;
  return {cash,reserved,available,buffer,safeToSpend:available-buffer,pending,through,end};
}
// A plan covers one calendar year, from the payroll month to that December.
const daysInMonth=month=>new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
// What the selected month promises: salary in, and the outflows already
// committed to it. `other` is discretionary recorded spending, so it belongs to
// the overview ring rather than to a commitment total.
export function expectedMonth(state,month) {
  const projection=projectYear(state),row=projection.rows.find(r=>r.month===month);
  const movements=scheduledTransactions(state).filter(t=>t.date.startsWith(month));
  if(!row){
    const next=projection.rows.find(r=>r.month>month&&(r.bank||r.mealCard));
    return {inPlan:false,movements,...(next?{nextPayDate:next.payDate}:{})};
  }
  const committed=row.recurring+row.loans+row.investments;
  return {inPlan:true,payDate:row.payDate,bank:row.bank,mealCard:row.mealCard,committed,left:row.bank-committed,movements};
}
export function defaultForecast(payroll) {
  const rows=[],december=`${payroll.month.slice(0,4)}-12`;
  for(let month=payroll.month;month<=december;month=addMonth(month,1))rows.push({month,gross:payroll.gross,mealDays:Math.min(payroll.mealDays,daysInMonth(month)),holiday:0,christmas:month===december?payroll.gross:0});
  return {start:`${payroll.month}-01`,end:`${december}-31`,payDay:25,posted:[],rows};
}
export function validateForecast(input) {
  if(!input)throw new Error('Invalid salary plan.');
  const f={...input,start:typeof input.start==='string'&&input.start.length===7?`${input.start}-01`:input.start,end:input.end===undefined?'2026-12-31':input.end,payDay:input.payDay===undefined?25:input.payDay,posted:input.posted===undefined?[]:input.posted};
  if(!validDate(f.start)||!validDate(f.end)||f.start.slice(0,4)!==f.end.slice(0,4)||f.start<'2026-01-01'||f.end<f.start||!Number.isInteger(f.payDay)||f.payDay<1||f.payDay>31||!Array.isArray(f.rows)||f.rows.length!==Number(f.end.slice(5,7))-Number(f.start.slice(5,7))+1)throw new Error('Choose start/end dates inside one calendar year, 2026 or later, and a payday from 1 to 31.');
  for(const [i,row]of f.rows.entries())if(!row||row.month!==addMonth(f.start.slice(0,7),i)||!['gross','holiday','christmas'].every(k=>Number.isSafeInteger(row[k])&&row[k]>=0&&row[k]<=100_000_000_000)||!Number.isInteger(row.mealDays)||row.mealDays<0||row.mealDays>daysInMonth(row.month))throw new Error('Check the month, salary, meal days and allowances in your plan.');
  if(!Array.isArray(f.posted)||f.posted.length>1200||!f.posted.every(validMonth)||new Set(f.posted).size!==f.posted.length)throw new Error('Invalid salary posting history.');
  return {start:f.start,end:f.end,payDay:f.payDay,posted:[...f.posted],rows:f.rows.map(({month,gross,mealDays,holiday,christmas})=>({month,gross,mealDays,holiday,christmas}))};
}
export function projectYear(state,forecast=state.forecast) {
  forecast=validateForecast(forecast);
  const pending=pendingPayments(state,forecast.end);
  const rows=forecast.rows.map(row=>{
    const p={...state.payroll,month:row.month,gross:row.gross,mealDays:row.mealDays};
    const pay=calculatePayroll(p),payDate=dueDate(row.month,forecast.payDay),inRange=payDate>=forecast.start&&payDate<=forecast.end;
    const bonuses=p.payments===14?[row.holiday,row.christmas].map(gross=>calculatePayroll({...p,gross,mealDays:0,payments:14})):[];
    const actual=state.transactions.filter(t=>t.type==='expense'&&t.date.startsWith(row.month)&&t.date>=forecast.start&&t.date<=forecast.end);
    const unposted=pending.filter(t=>t.month===row.month&&t.date>=forecast.start);
    const recurring=actual.filter(t=>t.recurringId).reduce((sum,t)=>sum+t.amount,0)+unposted.filter(t=>t.kind==='recurring').reduce((sum,t)=>sum+t.amount,0);
    const loans=actual.filter(t=>t.loanId).reduce((sum,t)=>sum+t.amount,0)+unposted.filter(t=>t.kind==='loan').reduce((sum,t)=>sum+t.amount,0);
    const investments=(state.contributions||[]).filter(c=>c.date.startsWith(row.month)&&c.date>=forecast.start&&c.date<=forecast.end).reduce((sum,c)=>sum+c.amount,0)+unposted.filter(t=>t.kind==='investment').reduce((sum,t)=>sum+t.amount,0);
    const other=actual.filter(t=>!t.loanId&&!t.recurringId).reduce((sum,t)=>sum+t.amount,0);
    const bonus=(key)=>bonuses.reduce((sum,r)=>sum+r[key],0);
    const bank=inRange?pay.bankNet+bonus('bankNet'):0,mealCard=inRange?pay.mealCard:0;
    return {...row,payDate,bank,mealCard,net:bank+mealCard,irs:inRange?pay.irs+bonus('irs'):0,ss:inRange?pay.ss+bonus('ss'):0,recurring,loans,other,investments,remaining:bank-recurring-loans-other-investments};
  });
  const totals=rows.reduce((sum,r)=>{for(const k of Object.keys(sum))sum[k]+=r[k];return sum;},{bank:0,mealCard:0,net:0,irs:0,ss:0,recurring:0,loans:0,other:0,investments:0,remaining:0});
  return {rows,totals};
}
