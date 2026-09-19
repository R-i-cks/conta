// Constant-TAN, monthly amortising loans. Rates/fee references: Banco de Portugal,
// verified 2026-09-18. TAEG is quoted information, never the amortisation rate.
export const LOAN_KINDS={mortgage:'Home loan · Habitação',car:'Car loan · Automóvel',personal:'Personal loan · Pessoal'};
export function validMonth(value) {return typeof value==='string'&&/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value);}
export function addMonth(month,offset) {
  const [year,m]=month.split('-').map(Number),d=new Date(Date.UTC(year,m-1+offset,1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}
const moneyOK=value=>Number.isSafeInteger(value)&&value>=0&&value<=100_000_000_000;
export function validDate(value) {return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&value<='2100-12-31'&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export function dueDate(month,day) {
  const [year,m]=month.split('-').map(Number),last=new Date(Date.UTC(year,m,0)).getUTCDate();
  return `${month}-${String(Math.min(day,last)).padStart(2,'0')}`;
}
export function loanDates(start,end,paymentDay) {
  if(!validDate(start)||!validDate(end)||end<start||!Number.isInteger(paymentDay)||paymentDay<1||paymentDay>31)throw new Error('Enter valid start/end dates and a payment day from 1 to 31.');
  let firstMonth=start.slice(0,7),lastMonth=end.slice(0,7);
  if(dueDate(firstMonth,paymentDay)<start)firstMonth=addMonth(firstMonth,1);
  if(dueDate(lastMonth,paymentDay)>end)lastMonth=addMonth(lastMonth,-1);
  const months=(Number(lastMonth.slice(0,4))-Number(firstMonth.slice(0,4)))*12+Number(lastMonth.slice(5))-Number(firstMonth.slice(5))+1;
  if(months<1||months>600)throw new Error('The date range must include between 1 and 600 monthly payments.');
  return {firstMonth,months};
}
export function validateLoan(input) {
  if(!input)throw new Error('Invalid loan.');
  let l={...input};
  // Old backups used a first month and a remaining payment count.
  if(l.start===undefined&&l.end===undefined){
    if(!validMonth(l.firstMonth)||!Number.isInteger(l.months)||l.months<1||l.months>600)throw new Error('Invalid legacy loan term.');
    l.start=`${l.firstMonth}-01`;l.end=dueDate(addMonth(l.firstMonth,l.months-1),31);
  }
  l.paymentDay=l.paymentDay===undefined?1:l.paymentDay;
  l.accountId=l.accountId===undefined?null:l.accountId;
  l.posted=l.posted===undefined?[]:l.posted;
  l={...l,...loanDates(l.start,l.end,l.paymentDay)};
  if(typeof l.id!=='string'||!l.id||l.id.length>100||typeof l.name!=='string'||!l.name.trim()||l.name.length>100||!Object.hasOwn(LOAN_KINDS,l.kind)||!['fixed','variable'].includes(l.rateType)||!moneyOK(l.balance)||l.balance===0||!Number.isFinite(l.tan)||l.tan<0||l.tan>50||!(l.taeg===null||Number.isFinite(l.taeg)&&l.taeg>=0&&l.taeg<=100)||!moneyOK(l.monthlyCosts)||typeof l.tracked!=='boolean'||!Number.isFinite(l.interestTax)||l.interestTax<0||l.interestTax>100||!(l.accountId===null||typeof l.accountId==='string'&&l.accountId.length>0&&l.accountId.length<=100)||!Array.isArray(l.posted)||l.posted.length>2600||!l.posted.every(validMonth)||new Set(l.posted).size!==l.posted.length)throw new Error('Check the loan amount, dates, rates, account and payment history.');
  return Object.fromEntries(['id','name','kind','rateType','balance','months','tan','taeg','monthlyCosts','firstMonth','tracked','interestTax','start','end','paymentDay','accountId','posted'].map(k=>[k,l[k]]));
}
export function monthlyPayment(balance,tan,months) {
  if(!balance)return 0;
  const r=tan/1200;
  return Math.max(1,Math.round(r?balance*r/-Math.expm1(-months*Math.log1p(r)):balance/months));
}
export function suggestedPenalty(loan,monthsRemaining) {
  if(loan.kind==='mortgage')return loan.rateType==='fixed'?2:.5;
  return loan.rateType==='variable'?0:monthsRemaining>12?.5:.25;
}
export const defaultScenario=()=>({lump:0,after:0,recurring:0,interval:1,feeRate:null,feeTax:4});
export function validateScenario(s,loan) {
  if(!s||!moneyOK(s.lump)||!moneyOK(s.recurring)||!Number.isInteger(s.after)||s.after<0||s.after>=loan.months||!Number.isInteger(s.interval)||s.interval<1||s.interval>12||!(s.feeRate===null||Number.isFinite(s.feeRate)&&s.feeRate>=0&&s.feeRate<=100)||!Number.isFinite(s.feeTax)||s.feeTax<0||s.feeTax>100)throw new Error('Check extra payments, timing and fee percentages.');
  return Object.fromEntries(Object.keys(defaultScenario()).map(k=>[k,s[k]]));
}
export function amortize(input,scenario=defaultScenario(),strategy='shorter') {
  const loan=validateLoan(input),s=validateScenario(scenario,loan);
  if(!['shorter','lower'].includes(strategy))throw new Error('Invalid repayment strategy.');
  let balance=loan.balance,payment=monthlyPayment(balance,loan.tan,loan.months);
  const originalPayment=payment,rows=[];
  function extraPayment(amount,remaining) {
    const extra=Math.min(amount,balance),rate=Math.min(s.feeRate??Infinity,suggestedPenalty(loan,remaining));
    if(!extra)return {extra:0,fee:0,feeTax:0};
    let fee=Math.round(extra*rate/100);
    if(loan.kind!=='mortgage'&&loan.rateType==='fixed') {
      // Consumer commission cannot exceed the remaining fixed-period interest.
      let b=balance,interestCap=0;const capPayment=monthlyPayment(b,loan.tan,remaining);
      for(let n=0;n<remaining&&b>0;n++){const interest=Math.round(b*loan.tan/1200);interestCap+=interest;b=Math.max(0,b-Math.min(b,capPayment-interest));}
      fee=Math.min(fee,interestCap);
    }
    if(loan.kind!=='mortgage'&&loan.rateType==='variable')fee=0;
    const feeTax=Math.round(fee*s.feeTax/100);balance-=extra;
    return {extra,fee,feeTax};
  }
  if(s.after===0&&s.lump){
    if(s.lump>balance)throw new Error('The one-off repayment exceeds the outstanding principal.');
    const extra=extraPayment(s.lump,loan.months);
    rows.push({period:0,month:loan.firstMonth,opening:loan.balance,payment:0,principal:0,interest:0,interestTax:0,costs:0,...extra,total:extra.extra+extra.fee+extra.feeTax,balance});
    if(strategy==='lower'&&balance)payment=monthlyPayment(balance,loan.tan,loan.months);
  }
  for(let m=1;m<=loan.months&&balance>0;m++) {
    const opening=balance,interest=Math.round(balance*loan.tan/1200);
    if(payment<=interest&&m<loan.months)throw new Error('The rounded payment does not reduce this balance. Check the amount, term and TAN.');
    const principal=m===loan.months?balance:Math.min(balance,payment-interest);
    const paid=principal+interest,interestTax=Math.round(interest*loan.interestTax/100);
    balance-=principal;
    const lump=m===s.after?s.lump:0;
    if(lump>balance)throw new Error(`The one-off repayment exceeds the principal left after payment ${m}.`);
    const repeating=m>s.after&&(m-s.after-1)%s.interval===0?s.recurring:0;
    const extra=extraPayment(lump+repeating,loan.months-m);
    rows.push({period:m,month:addMonth(loan.firstMonth,m-1),opening,payment:paid,principal,interest,interestTax,costs:loan.monthlyCosts,...extra,total:paid+interestTax+loan.monthlyCosts+extra.extra+extra.fee+extra.feeTax,balance});
    if(strategy==='lower'&&extra.extra&&balance)payment=monthlyPayment(balance,loan.tan,loan.months-m);
  }
  const result=rows.reduce((out,row)=>{for(const key of ['principal','interest','interestTax','costs','extra','fee','feeTax','total'])out[key]+=row[key];return out;},{principal:0,interest:0,interestTax:0,costs:0,extra:0,fee:0,feeTax:0,total:0});
  return {...result,rows,months:rows.at(-1)?.period||0,payoffMonth:rows.at(-1)?.month||loan.firstMonth,originalPayment,firstPayment:rows.find(r=>r.period>0)?.payment||0};
}
export function compareLoan(loan,scenario) {
  loan=validateLoan(loan);
  const baseline=amortize(loan),shorter=amortize(loan,scenario,'shorter'),lower=amortize(loan,scenario,'lower');
  for(const result of [shorter,lower]){result.savings=baseline.total-result.total;result.interestSaved=baseline.interest-result.interest;result.monthsSaved=baseline.months-result.months;}
  return {baseline,shorter,lower};
}
