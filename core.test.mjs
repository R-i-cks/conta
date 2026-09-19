import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BRACKETS, cents, calculateTax, totals, validateState, toCSV, accountBalances, portfolio} from './core.mjs';
import {defaultPayroll, calculatePayroll, PAYROLL_TABLE, SINGLE_EARNER_TABLE, YOUTH_CAP} from './payroll.mjs';

test('2026 statutory brackets and rates match the published AT table', () => {
  assert.deepEqual(BRACKETS.map(b=>b[0]), [8342,12587,17838,23089,29397,43090,46566,86634,Infinity]);
  assert.deepEqual(BRACKETS.map(b=>b[1]), [12.5,15.7,21.2,24.1,31.1,34.9,43.1,44.6,48]);
});
test('general tax uses the previous band’s published average plus the marginal excess', () => {
  assert.equal(calculateTax(0).total, 0);
  assert.equal(calculateTax(cents('8000')).general, cents('1000'));
  assert.equal(calculateTax(cents('8342')).general, cents('1042.75'));
  assert.equal(calculateTax(cents('10000')).general, cents('1303.06'));
  assert.equal(calculateTax(cents('36000')).general, Math.round((29397 * .20579 + 6603 * .349) * 100));
  // The whole income must never be taxed at the highest applicable rate.
  assert.ok(calculateTax(cents('36000')).effective < 34.9);
});
test('every bracket boundary and the cents on either side select the right marginal rate', () => {
  for (let i=0;i<BRACKETS.length-1;i++) {
    const boundary=BRACKETS[i][0]*100;
    assert.equal(calculateTax(boundary-1).index,i);
    assert.equal(calculateTax(boundary).index,i);
    assert.equal(calculateTax(boundary+1).index,i+1);
  }
});
test('solidarity thresholds, both rates and joint household quotient', () => {
  assert.equal(calculateTax(cents('80000')).solidarity,0);
  assert.equal(calculateTax(cents('100000')).solidarity,cents('500'));
  assert.equal(calculateTax(cents('250000')).solidarity,cents('4250'));
  assert.equal(calculateTax(cents('300000')).solidarity,cents('6750'));
  assert.equal(calculateTax(cents('160000'),true).solidarity,0);
  assert.equal(calculateTax(cents('200000'),true).solidarity,cents('1000'));
  assert.equal(calculateTax(cents('600000'),true).solidarity,cents('13500'));
  assert.ok(Math.abs(calculateTax(cents('72000'),true).total - 2*calculateTax(cents('36000')).total)<=1);
  assert.ok(calculateTax(cents('72000'),true).total<calculateTax(cents('72000')).total);
});
test('money inputs preserve cents and reject invalid values', () => {
  assert.equal(cents('10.01'),1001);
  assert.equal(cents('0.29'),29);
  for (const value of ['-1','1.001','1e3','','Infinity','NaN','1000000001']) assert.throws(()=>cents(value));
  for (const value of [-1,NaN,Infinity,12.5,100_000_000_001]) assert.throws(()=>calculateTax(value));
});
const transaction={id:'one',date:'2026-09-01',description:'Salary',type:'income',category:'Salary',amount:200000};
const backup={version:1,demo:false,transactions:[transaction],tax:{taxable:3600000,joint:false}};
test('backup roundtrip and cents-based totals', () => {
  const migrated=validateState(JSON.parse(JSON.stringify(backup)));
  assert.equal(migrated.version,4);
  assert.deepEqual(migrated.transactions,[{...transaction,accountId:null}]);
  assert.deepEqual(migrated.tax,backup.tax);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(migrated))),migrated);
  assert.deepEqual(totals([transaction,{...transaction,type:'expense',amount:12345}]),{income:200000,expense:12345,balance:187655});
});
test('accounts, assignments and transfers conserve cash and do not count transfers as spending',()=>{
  const s=validateState(backup);
  s.accounts=[{id:'a',name:'Daily',bank:'Bank',kind:'Current',opening:100000},{id:'b',name:'Savings',bank:'Bank',kind:'Savings',opening:0}];
  s.transactions[0].accountId='a';
  s.transfers=[{id:'transfer',from:'a',to:'b',amount:50000,date:'2026-09-01'}];
  assert.deepEqual([...accountBalances(validateState(s))],[['a',250000],['b',50000]]);
  assert.equal(totals(s.transactions).expense,0);
  assert.throws(()=>validateState({...s,accounts:[]}));
  assert.throws(()=>validateState({...s,transfers:[{...s.transfers[0],to:'a'}]}));
});
test('portfolio supports fractional units, zero prices, gains, losses and validates imports',()=>{
  const h={id:'h',name:'Fund',symbol:'ETF',broker:'Broker',kind:'ETF',units:2.5,price:120,cost:25000,updated:'2026-09-01'};
  const result=portfolio([h]);
  assert.equal(result.value,30000);assert.equal(result.gain,5000);assert.equal(result.returnPct,20);
  assert.equal(portfolio([{...h,price:0}]).gain,-25000);
  assert.equal(portfolio([{...h,cost:0}]).returnPct,null);
  const s={...validateState(backup),holdings:[h]};assert.deepEqual(validateState(s).holdings,[{...h,valuation:'units'}]);
  for(const patch of [{units:-1},{price:NaN},{cost:1.1},{kind:'Unknown'},{units:1e9,price:1e9}])assert.throws(()=>validateState({...s,holdings:[{...h,...patch}]}));
});
test('monthly employee withholding uses correct tables and abatements, not a flat top rate',()=>{
  const p={...defaultPayroll(),gross:130000,mealDays:0,annualMealDays:0};
  const r=calculatePayroll(p);
  assert.equal(r.irs,11900);assert.equal(r.ss,14300);assert.equal(r.net,103800);
  assert.equal(r.rate,24.1);assert.equal(r.deduction,19333);
  assert.equal(calculatePayroll({...p,gross:92000}).irs,0);
  assert.equal(calculatePayroll({...p,family:'married-one',gross:99100}).irs,0);
  assert.ok(calculatePayroll({...p,dependants:1}).irs<r.irs);
  assert.ok(calculatePayroll({...p,dependants:3}).irs<calculatePayroll({...p,dependants:2}).irs);
  for(const family of ['single','married-one'])for(const [i,[limit]] of (family==='single'?PAYROLL_TABLE:SINGLE_EARNER_TABLE).entries()) {
    if(!Number.isFinite(limit))continue;
    assert.equal(calculatePayroll({...p,family,gross:limit*100}).index,i);
    assert.equal(calculatePayroll({...p,family,gross:limit*100+1}).index,i+1);
  }
});
test('first-year IRS Jovem at age 24 exempts IRS while preserving employee SS and meal-card value',()=>{
  const p={...defaultPayroll(),youth:true,eligible:true,employerApplied:true};
  const r=calculatePayroll(p);
  assert.equal(r.irs,0);assert.equal(r.ss,14300);assert.equal(r.meal,21120);
  assert.equal(r.net,136820);assert.equal(r.bankNet,115700);assert.equal(r.mealCard,21120);
  assert.equal(r.bonusNet,115700);assert.equal(r.annualGross,1820000);
  assert.throws(()=>calculatePayroll({...p,eligible:false}));
  assert.throws(()=>calculatePayroll({...p,age:36}));
  assert.equal(calculatePayroll({...p,employerApplied:false}).irs,11900);
  const high=calculatePayroll({...p,gross:400000,mealDays:0});
  assert.equal(high.exemption,Math.round(YOUTH_CAP/14));assert.ok(high.irs>0);
  assert.ok(calculatePayroll({...p,careerYear:2,mealDays:0}).irs>0);
});
test('meal cash excess is subject to SS and IRS; card allowance under limit stays exempt',()=>{
  const p={...defaultPayroll(),youth:true,eligible:true,employerApplied:true,mealMethod:'cash'};
  const r=calculatePayroll(p);
  assert.equal(r.mealTaxable,(960-615)*22);assert.equal(r.ss,15135);
  assert.equal(r.irs,0);assert.equal(r.mealCard,0);assert.equal(r.bankNet,r.net);
  assert.equal(calculatePayroll({...p,mealMethod:'card',mealDaily:1046}).mealTaxable,0);
  assert.equal(calculatePayroll({...p,mealMethod:'card',mealDaily:1047}).mealTaxable,22);
  assert.throws(()=>calculatePayroll({...p,mealDays:32}));
});
test('duodécimos preserve annual salary, tax allowances separately and never multiply meal days by 14',()=>{
  const p={...defaultPayroll(),youth:true,eligible:true,employerApplied:true};
  const a=calculatePayroll(p),b=calculatePayroll({...p,payments:12});
  assert.equal(a.annualGross,b.annualGross);assert.equal(a.annualNet,b.annualNet);
  assert.equal(a.annualMeal,960*242);assert.equal(a.meal,b.meal);
  assert.equal(b.extraGross,21666);assert.equal(b.ss,16683);assert.equal(b.net,156103);
  assert.equal(b.net,a.twelveNet);
  assert.equal(calculatePayroll({...p,youth:false,payments:12}).irs,11900+2*Math.round(11900/12));
});
test('invalid backup data is rejected before restoring', () => {
  for(const change of [{amount:0},{amount:-1},{amount:NaN},{amount:1.1},{date:'2026-02-30'},{date:'2026-13-01'},{description:' '},{category:'invalid'},{type:'transfer'},{id:''}]) assert.throws(()=>validateState({...backup,transactions:[{...transaction,...change}]}));
  assert.throws(()=>validateState({...backup,transactions:[transaction,transaction]}));
  assert.throws(()=>validateState({...backup,tax:{taxable:-100,joint:false}}));
  assert.throws(()=>validateState({...backup,version:2}));
  assert.throws(()=>validateState({}));
});
test('CSV escapes quotes, line breaks and spreadsheet formula injection', () => {
  const csv=toCSV([{...transaction,description:'=SUM(1,2)'},{...transaction,description:'A "quote", and\na line'}]);
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"A ""quote"", and\na line"'));
  assert.ok(csv.includes('"2000.00"'));
});

// Loans and plans are in cents; schedules must conserve every cent of principal.
import {amortize,compareLoan,defaultScenario,monthlyPayment,suggestedPenalty,validateLoan} from './loans.mjs';
import {defaultForecast,projectYear,dueDate,dueOccurrences,postDueExpenses} from './planning.mjs';
const loan={id:'loan',name:'Home',kind:'mortgage',rateType:'variable',balance:10000000,months:240,tan:3,taeg:4.2,monthlyCosts:1000,firstMonth:'2026-09',tracked:true,interestTax:0};
const scenario=defaultScenario();
test('amortisation has known annuity payments, correct first interest and exact principal conservation',()=>{
  assert.equal(monthlyPayment(10000000,3,240),55460);
  const r=amortize(loan);assert.equal(r.rows[0].interest,25000);assert.equal(r.rows[0].principal,30460);
  assert.equal(r.principal,loan.balance);assert.equal(r.rows.at(-1).balance,0);assert.equal(r.months,240);
  assert.equal(r.total,r.principal+r.interest+r.costs);
  assert.equal(amortize({...loan,taeg:99}).total,r.total,'TAEG must never drive interest');
  const z=amortize({...loan,balance:100001,months:12,tan:0,monthlyCosts:0});
  assert.equal(z.total,100001);assert.equal(z.interest,0);assert.equal(z.rows.at(-1).balance,0);
});
test('one-off, recurring and combined extra repayments shorten the term, cap final extra and subtract fees',()=>{
  const once=compareLoan(loan,{...scenario,lump:1000000});
  assert.equal(once.shorter.rows[0].fee,5000);assert.equal(once.shorter.rows[0].feeTax,200);
  assert.ok(once.shorter.months<240);assert.equal(once.shorter.firstPayment,55460);
  assert.ok(once.lower.firstPayment<55460);assert.ok(once.shorter.savings>once.lower.savings);
  const repeat=compareLoan(loan,{...scenario,recurring:20000});
  const both=compareLoan(loan,{...scenario,lump:1000000,recurring:20000});
  assert.ok(both.shorter.months<once.shorter.months);assert.ok(both.shorter.months<repeat.shorter.months);
  for(const r of [once.shorter,repeat.shorter,both.shorter]){
    assert.equal(r.principal+r.extra,loan.balance);assert.equal(r.rows.at(-1).balance,0);
    assert.equal(r.savings,amortize(loan).total-r.total);
    assert.ok(r.rows.every(row=>row.balance>=0&&row.extra<=row.opening-row.principal));
  }
  const delayed=amortize(loan,{...scenario,lump:50000,after:3,recurring:10000,interval:3});
  assert.equal(delayed.rows[2].extra,50000);assert.equal(delayed.rows[3].extra,10000);assert.equal(delayed.rows[4].extra,0);assert.equal(delayed.rows[6].extra,10000);
  const all=amortize(loan,{...scenario,lump:loan.balance});assert.equal(all.months,0);assert.equal(all.interest,0);assert.equal(all.costs,0);
  assert.throws(()=>amortize(loan,{...scenario,lump:loan.balance+1}));
  assert.throws(()=>amortize(loan,{...scenario,lump:loan.balance,after:2}));
  assert.throws(()=>amortize(loan,{...scenario,after:240}));
});
test('Portuguese commission maxima, consumer one-year transition, interest cap and waivers',()=>{
  const car={...loan,kind:'car',rateType:'fixed',months:24,interestTax:4};
  assert.equal(suggestedPenalty(car,13),.5);assert.equal(suggestedPenalty(car,12),.25);
  assert.equal(suggestedPenalty({...loan,rateType:'fixed'},240),2);
  assert.equal(amortize(car,{...scenario,lump:100000}).fee,500);
  assert.equal(amortize(car,{...scenario,lump:100000,after:12,feeRate:.5}).fee,250);
  assert.equal(amortize({...car,rateType:'variable'},{...scenario,lump:100000,feeRate:2}).fee,0);
  assert.equal(amortize({...car,tan:0},{...scenario,lump:100000}).fee,0);
  assert.equal(amortize(loan,{...scenario,lump:100000,feeRate:0}).fee,0);
  assert.equal(amortize(loan,{...scenario,lump:100000,feeRate:2}).fee,500);
  assert.equal(amortize(car).rows[0].interestTax,1000);
  const zero=compareLoan({...loan,tan:0,monthlyCosts:0},{...scenario,lump:100000});
  assert.equal(zero.shorter.savings,-520,'Early repayment can cost more than it saves');
  for(const patch of [{months:0},{balance:-1},{tan:NaN},{tracked:'yes'},{taeg:-1}])assert.throws(()=>validateLoan({...loan,...patch}));
});
const recurring={id:'rent',description:'Rent',category:'Housing',amount:50000,accountId:null,start:'2026-01-31',end:'2026-04-30',day:31,enabled:true,posted:[]};
test('monthly expenses clamp short months, honour start/end/pause and post only once, even after deletion',()=>{
  assert.equal(dueDate('2026-02',31),'2026-02-28');assert.equal(dueDate('2028-02',31),'2028-02-29');
  assert.deepEqual(dueOccurrences(recurring,'2026-03-30').map(r=>r.date),['2026-01-31','2026-02-28']);
  assert.equal(dueOccurrences({...recurring,enabled:false},'2026-12-31').length,0);
  assert.equal(dueOccurrences({...recurring,start:'2026-02-10',day:1},'2026-02-28').length,0);
  const s={...validateState(backup),recurring:[recurring]};let id=0;
  const posted=validateState(postDueExpenses(s,'2026-05-01',()=>String(++id)));
  assert.equal(posted.transactions.length,s.transactions.length+4);
  assert.deepEqual(postDueExpenses(posted,'2026-05-01',()=>String(++id)),posted);
  const removed={...posted,transactions:[]};assert.equal(postDueExpenses(removed,'2026-05-01',()=>String(++id)).transactions.length,0);
  assert.throws(()=>validateState({...posted,transactions:[...posted.transactions,{...posted.transactions.at(-1),id:'duplicate'}]}));
});
test('year-end forecast separates cash/card, allowances and commitments for both salary schedules',()=>{
  const s=validateState(backup);s.payroll={...defaultPayroll(),youth:true,eligible:true,employerApplied:true};s.forecast=defaultForecast(s.payroll);
  s.recurring=[{...recurring,start:'2026-09-01',end:'',day:1}];s.loans=[{...loan,kind:'car',balance:120000,months:12,tan:0,monthlyCosts:0}];
  const result=projectYear(s);assert.equal(result.rows.length,4);
  assert.equal(result.rows[0].bank,115700);assert.equal(result.rows[0].mealCard,21120);assert.equal(result.rows[0].ss,14300);
  assert.equal(result.rows[0].loans,10000);assert.equal(result.rows[0].remaining,55700);
  assert.equal(result.rows[3].bank,231400);assert.equal(result.totals.bank,578500);
  s.payroll.payments=12;assert.equal(projectYear(s).rows[3].bank,134983,'December must not double-count duodécimos');
  s.forecast.rows[0].gross=140000;assert.equal(projectYear(s).rows[0].bank,145367);
  s.loans[0].tracked=false;assert.equal(projectYear(s).rows[0].loans,0);
  const posted=postDueExpenses(s,'2026-09-18',()=> 'new');assert.equal(projectYear(posted).rows[0].recurring,50000);
  posted.recurring=[];assert.equal(projectYear(posted).rows[0].recurring,50000,'Deleting rule keeps the actual commitment');
});
test('v2 migration and v3 backup roundtrip preserve records and reject corrupt plans',()=>{
  const old={...validateState(backup),version:2};delete old.loans;delete old.forecast;delete old.recurring;
  const s=validateState(old);assert.deepEqual(s.transactions,old.transactions);assert.deepEqual(s.loans,[]);
  s.loans=[validateLoan(loan)];s.recurring=[recurring];assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);
  assert.throws(()=>validateState({...s,loans:[loan,loan]}));
  assert.throws(()=>validateState({...s,recurring:[{...recurring,accountId:'missing'}]}));
  assert.throws(()=>validateState({...s,forecast:{...s.forecast,rows:[]}}));
  assert.throws(()=>validateState({...s,forecast:{...s.forecast,rows:s.forecast.rows.map(r=>({...r,mealDays:99}))}}));
});

import {loanDates} from './loans.mjs';
import {cashPlan,pendingPayments,validateForecast} from './planning.mjs';
import {validateInvestmentPlan,projectInvestment,recordContribution,undoContribution} from './investments.mjs';
const cashWorkspace=()=>({...validateState({version:1,demo:false,transactions:[],tax:{taxable:null,joint:false}}),accounts:[{id:'cash',name:'Cash',bank:'Bank',kind:'Current',opening:200000}]});
test('date-based loans migrate without changing schedules and clamp payment days',()=>{
  const migrated=validateLoan(loan);
  assert.equal(migrated.months,240);assert.equal(migrated.start,'2026-09-01');assert.equal(migrated.end,'2046-08-31');
  assert.deepEqual(amortize(migrated),amortize(loan));
  assert.deepEqual(loanDates('2026-01-31','2026-03-30',31),{firstMonth:'2026-01',months:2});
  assert.deepEqual(loanDates('2028-02-29','2028-03-31',31),{firstMonth:'2028-02',months:2});
  for(const args of [['2026-02-30','2026-03-31',1],['2026-03-20','2026-03-21',1],['2026-01-01','2026-02-01',0]])assert.throws(()=>loanDates(...args));
});
test('cash reserves include loans and bills; posting deducts accounts once without double counting',()=>{
  let s=cashWorkspace();s.recurring=[{...recurring,start:'2026-09-01',end:'2026-10-31',day:20,accountId:'cash'}];
  s.loans=[validateLoan({...loan,balance:20000,months:2,tan:0,monthlyCosts:0,accountId:'cash'})];
  let id=0;
  assert.equal(cashPlan(s,'2026-09','2026-09-19').available,140000);
  const expected=projectYear(s).rows[0].remaining;
  s=validateState(postDueExpenses(s,'2026-09-20',()=>`payment-${++id}`));
  assert.equal(s.transactions.length,2);assert.equal(accountBalances(s).get('cash'),140000);
  assert.equal(cashPlan(s,'2026-09','2026-09-20').available,140000);
  assert.equal(projectYear(s).rows[0].remaining,expected);
  assert.deepEqual(postDueExpenses(s,'2026-09-20',()=>`payment-${++id}`),s);
  assert.throws(()=>validateState({...s,transactions:[...s.transactions,{...s.transactions.find(t=>t.loanId),id:'duplicate'}]}));
  assert.throws(()=>validateState({...s,accounts:[]}));
  const afterDelete={...s,loans:[]};assert.equal(projectYear(afterDelete).rows[0].loans,10000);
  const unassigned={...s,transactions:s.transactions.map(t=>({...t,accountId:null}))};
  assert.equal(cashPlan(unassigned,'2026-09','2026-09-20').available,140000,'unassigned paid commitments remain reserved');
});
test('future recorded outflows and overdue commitments reserve cash but expected salary does not',()=>{
  const s=cashWorkspace();s.recurring=[{...recurring,start:'2026-08-01',end:'2026-09-30',day:1,accountId:'cash'}];
  s.transactions=[{id:'future',description:'Future bill',category:'Other',amount:5000,type:'expense',accountId:'cash',date:'2026-09-25'},{id:'salary',description:'Salary',category:'Salary',amount:100000,type:'income',accountId:'cash',date:'2026-09-25'}];
  assert.equal(accountBalances(s,'2026-09-19').get('cash'),200000);
  assert.equal(cashPlan(s,'2026-09','2026-09-19').available,95000);
  assert.equal(cashPlan(s,'2026-09','2026-09-25').available,195000);
});
test('salary range and payday exclude out-of-range deposits and preserve legacy plans',()=>{
  const s=cashWorkspace();s.forecast=validateForecast({start:'2026-09',rows:defaultForecast(s.payroll).rows});
  assert.equal(s.forecast.start,'2026-09-01');assert.equal(s.forecast.payDay,25);
  s.forecast={...s.forecast,start:'2026-09-26',end:'2026-10-24',rows:s.forecast.rows.slice(0,2)};
  assert.deepEqual(projectYear(s).rows.map(r=>r.bank),[0,0]);
  assert.throws(()=>validateForecast({...s.forecast,payDay:32}));
  assert.throws(()=>validateForecast({...s.forecast,end:'2026-08-01'}));
});
const ppr={id:'ppr',name:'Seguro PPR+ Ações',symbol:'',kind:'PPR / Insurance',broker:'Santander Totta Seguros',valuation:'balance',units:1,price:1000,cost:100000,updated:'2026-09-01'};
const investmentPlan={id:'plan',holdingId:'ppr',accountId:'cash',amount:10000,start:'2026-09-01',end:'2027-08-31',day:20,initialValue:100000,annualRate:0,enabled:true,posted:[]};
test('investment projection conserves contributions at zero growth, supports losses and partial dates',()=>{
  const r=projectInvestment(investmentPlan);assert.equal(r.value,220000);assert.equal(r.contributed,120000);assert.equal(r.growth,0);
  assert.equal(projectInvestment(investmentPlan,'2026-09-19').value,100000);
  assert.equal(projectInvestment(investmentPlan,'2026-09-20').value,110000);
  assert.ok(projectInvestment({...investmentPlan,annualRate:-10}).value<220000);
  assert.ok(projectInvestment({...investmentPlan,annualRate:5}).value>220000);
  const onlyGrowth=projectInvestment({...investmentPlan,start:'2026-01-01',end:'2030-01-01',enabled:false,annualRate:10});
  assert.equal(onlyGrowth.value,146410,'four 365.25-day years compound the annual effective rate');
  assert.equal(projectInvestment({...investmentPlan,start:'2028-02-29',end:'2028-03-30',day:31}).contributed,10000);
  for(const patch of [{annualRate:-100},{annualRate:NaN},{amount:0},{end:'bad'},{day:32}])assert.throws(()=>validateInvestmentPlan({...investmentPlan,...patch}));
});
test('PPR contributions reserve cash, move value without spending, roundtrip and undo safely',()=>{
  let s={...cashWorkspace(),holdings:[ppr],investmentPlans:[investmentPlan]};
  assert.equal(cashPlan(s,'2026-09','2026-09-20').available,190000);
  assert.equal(projectYear(s).rows[0].investments,10000);
  assert.equal(postDueExpenses(s,'2026-09-20',()=> 'no').transactions.length,0,'bulk bills cannot guess investment units/value');
  const entry={id:'contribution',planId:'plan',occurrence:'2026-09',holdingId:'ppr',accountId:'cash',amount:10000,units:0,price:1100,date:'2026-09-20'};
  s=validateState(recordContribution(s,entry));
  assert.equal(s.holdings[0].cost,110000);assert.equal(portfolio(s.holdings).value,110000);
  assert.equal(accountBalances(s).get('cash'),190000);assert.equal(totals(s.transactions).expense,0);
  assert.equal(cashPlan(s,'2026-09','2026-09-20').available,190000);
  assert.equal(projectYear(s).rows[0].investments,10000);
  assert.equal(pendingPayments(s,'2026-09-30').length,0);
  assert.throws(()=>recordContribution(s,{...entry,id:'again'}));
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);
  assert.throws(()=>validateState({...s,contributions:[...s.contributions,{...s.contributions[0],id:'duplicate'}]}));
  assert.throws(()=>validateState({...s,investmentPlans:[{...investmentPlan,holdingId:'missing'}]}));
  s=validateState(undoContribution(s,'contribution'));
  assert.equal(accountBalances(s).get('cash'),200000);assert.equal(s.holdings[0].cost,100000);
  assert.equal(s.investmentPlans[0].posted.length,0);assert.equal(s.holdings[0].price,1100,'undo keeps latest statement value for manual reconciliation');
});
test('unit-based contributions add fractional shares and keep newer quotes',()=>{
  const s={...cashWorkspace(),holdings:[{...ppr,valuation:'units',kind:'Fund',units:2.5,price:120,updated:'2026-09-30'}]};
  const next=validateState(recordContribution(s,{id:'fraction',holdingId:'ppr',accountId:'cash',amount:10500,units:0.875,price:110,date:'2026-09-20'}));
  assert.equal(next.holdings[0].units,3.375);assert.equal(next.holdings[0].price,120);
  assert.equal(undoContribution(next,'fraction').holdings[0].units,2.5);
});
test('version 3 migrates all money and posting history into version 4',()=>{
  const old={...cashWorkspace(),version:3,loans:[loan],holdings:[ppr],recurring:[recurring]};
  delete old.investmentPlans;delete old.contributions;
  old.forecast={start:'2026-09',rows:old.forecast.rows};
  const migrated=validateState(old);
  assert.equal(migrated.version,4);assert.deepEqual(migrated.recurring,old.recurring);
  assert.deepEqual(migrated.transactions,old.transactions);assert.deepEqual(migrated.contributions,[]);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(migrated))),migrated);
});

// Calendar years after 2026 reuse the 2026 tables; only the pinning is removed.
import {validateForecast as checkForecast} from './planning.mjs';
import {csvCell} from './core.mjs';
test('salary plans work in later years, stay inside one year and clamp leap February',()=>{
  const plan=defaultForecast({...defaultPayroll(),month:'2027-10'});
  assert.deepEqual(plan.rows.map(r=>r.month),['2027-10','2027-11','2027-12']);
  assert.equal(plan.end,'2027-12-31');
  assert.equal(checkForecast(plan).payDay,25);
  assert.throws(()=>checkForecast({...plan,end:'2028-01-31'}),/one calendar year/);
  assert.throws(()=>checkForecast({...defaultForecast({...defaultPayroll(),month:'2025-10'})}),/one calendar year/);
  const leap=defaultForecast({...defaultPayroll(),month:'2028-02',mealDays:31});
  assert.equal(leap.rows[0].mealDays,29);
  assert.throws(()=>checkForecast({...leap,rows:[{...leap.rows[0],mealDays:30},...leap.rows.slice(1)]}),/meal days/);
  assert.equal(calculatePayroll({...defaultPayroll(),month:'2027-01'}).ss,calculatePayroll(defaultPayroll()).ss);
  assert.throws(()=>calculatePayroll({...defaultPayroll(),month:'2025-12'}),/Invalid monthly salary/);
});
test('every CSV export shares one escaper',()=>{
  assert.equal(csvCell('-1,5'),'"\'-1,5"');
  assert.equal(csvCell('@x'),'"\'@x"');
  assert.equal(csvCell('a"b'),'"a""b"');
});
