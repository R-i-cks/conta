import {addMonth,dueDate,validDate,validMonth} from './loans.mjs';
const moneyOK=v=>Number.isSafeInteger(v)&&v>=0&&v<=100_000_000_000;
export function validateInvestmentPlan(p){
  if(!p||typeof p.id!=='string'||!p.id||p.id.length>100||typeof p.holdingId!=='string'||!p.holdingId||p.holdingId.length>100||!(p.accountId===null||typeof p.accountId==='string'&&p.accountId.length>0&&p.accountId.length<=100)||!moneyOK(p.amount)||!validDate(p.start)||!validDate(p.end)||p.end<p.start||!Number.isInteger(p.day)||p.day<1||p.day>31||typeof p.enabled!=='boolean'||!moneyOK(p.initialValue)||!Number.isFinite(p.annualRate)||p.annualRate<=-100||p.annualRate>100||!Array.isArray(p.posted)||p.posted.length>2600||!p.posted.every(validMonth)||new Set(p.posted).size!==p.posted.length)throw new Error('Check the investment, contribution, dates, annual rate and payment history.');
  return Object.fromEntries(['id','holdingId','accountId','amount','start','end','day','enabled','initialValue','annualRate','posted'].map(k=>[k,p[k]]));
}
export function projectInvestment(input,through=input.end){
  const p=validateInvestmentPlan(input);
  if(!validDate(through))throw new Error('Invalid projection date.');
  const end=through<p.end?through:p.end;
  let value=p.initialValue,contributed=0,last=p.start;
  const rows=[];
  if(end<p.start)return {value,contributed,growth:0,rows};
  const grow=date=>{value*=Math.pow(1+p.annualRate/100,(Date.parse(date)-Date.parse(last))/(86400000*365.25));last=date;};
  for(let month=p.start.slice(0,7);month<=end.slice(0,7);month=addMonth(month,1)){
    const date=dueDate(month,p.day),monthEnd=dueDate(month,31),cutoff=monthEnd<end?monthEnd:end;
    if(p.enabled&&date>=p.start&&date<=cutoff){grow(date);value+=p.amount;contributed+=p.amount;}
    grow(cutoff);
    if(!Number.isSafeInteger(Math.round(value))||!Number.isSafeInteger(contributed))throw new Error('Projection exceeds the supported amount; shorten the period or lower the rate.');
    rows.push({date:cutoff,value:Math.round(value),contributed,growth:Math.round(value)-p.initialValue-contributed});
  }
  return {value:Math.round(value),contributed,growth:Math.round(value)-p.initialValue-contributed,rows};
}
export function recordContribution(state,entry){
  const h=state.holdings.find(h=>h.id===entry.holdingId);
  if(!h)throw new Error('Choose an existing investment.');
  if(!moneyOK(entry.amount)||!entry.amount||!validDate(entry.date)||!Number.isFinite(entry.units)||entry.units<0||(h.valuation!=='balance'&&entry.units===0))throw new Error('Enter the amount, date and actual units received.');
  const plan=entry.planId?state.investmentPlans.find(p=>p.id===entry.planId):null;
  if(entry.planId&&(!plan||plan.holdingId!==h.id||plan.posted.includes(entry.occurrence)||!validMonth(entry.occurrence)))throw new Error('This contribution is already recorded or its plan changed.');
  if(!Number.isFinite(entry.price)||entry.price<0||entry.price>1e9)throw new Error('Enter the current unit price or statement value.');
  const holding={...h,units:h.valuation==='balance'?1:Math.round((h.units+entry.units)*1e8)/1e8,cost:h.cost+entry.amount,...(entry.date>=h.updated?{price:entry.price,updated:entry.date}:{})};
  const {price,...record}=entry;
  return {...state,holdings:state.holdings.map(old=>old.id===h.id?holding:old),contributions:[...state.contributions,record],investmentPlans:state.investmentPlans.map(p=>p.id===entry.planId?{...p,posted:[...p.posted,entry.occurrence]}:p)};
}
export function undoContribution(state,id){
  const c=state.contributions.find(c=>c.id===id);
  if(!c)throw new Error('Contribution no longer exists.');
  const h=state.holdings.find(h=>h.id===c.holdingId);
  if(!h||h.cost<c.amount||(h.valuation!=='balance'&&h.units<c.units))throw new Error('The holding was adjusted since this contribution. Reconcile its units and cost before undoing.');
  return {...state,contributions:state.contributions.filter(c=>c.id!==id),holdings:state.holdings.map(old=>old.id===h.id?{...h,cost:h.cost-c.amount,units:h.valuation==='balance'?1:Math.round((h.units-c.units)*1e8)/1e8}:old),investmentPlans:state.investmentPlans.map(p=>p.id===c.planId?{...p,posted:p.posted.filter(month=>month!==c.occurrence)}:p)};
}
