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
  assert.equal(migrated.version,5);
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
  const s={...validateState(backup),holdings:[h]};assert.deepEqual(validateState(s).holdings,[{...h,valuation:'units',autoPrice:false}]);
  assert.equal(validateState({...s,holdings:[{...h,autoPrice:true}]}).holdings[0].autoPrice,true);
  assert.throws(()=>validateState({...s,holdings:[{...h,symbol:'',autoPrice:true}]}));
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
  const p={...defaultPayroll(),gross:130000,age:24,youth:true,eligible:true,employerApplied:true};
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
  const p={...defaultPayroll(),gross:130000,age:24,youth:true,eligible:true,employerApplied:true,mealMethod:'cash'};
  const r=calculatePayroll(p);
  assert.equal(r.mealTaxable,(960-615)*22);assert.equal(r.ss,15135);
  assert.equal(r.irs,0);assert.equal(r.mealCard,0);assert.equal(r.bankNet,r.net);
  assert.equal(calculatePayroll({...p,mealMethod:'card',mealDaily:1046}).mealTaxable,0);
  assert.equal(calculatePayroll({...p,mealMethod:'card',mealDaily:1047}).mealTaxable,22);
  assert.throws(()=>calculatePayroll({...p,mealDays:32}));
});
test('duodécimos preserve annual salary, tax allowances separately and never multiply meal days by 14',()=>{
  const p={...defaultPayroll(),gross:130000,age:24,youth:true,eligible:true,employerApplied:true};
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
import {defaultForecast,projectYear,dueDate,dueOccurrences,postDueExpenses,postSalary,scheduledTransactions} from './planning.mjs';
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
  const s=validateState(backup);s.payroll={...defaultPayroll(),gross:130000,age:24,youth:true,eligible:true,employerApplied:true};s.forecast=defaultForecast(s.payroll);
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
test('salary posts once to its bank and meal-card destinations without making card funds spendable',()=>{
  const s=cashWorkspace();
  s.accounts.push({id:'meal',name:'Meal card',bank:'Issuer',kind:'Meal card',opening:0});
  s.payroll={...defaultPayroll(),bankAccountId:'cash',mealAccountId:'meal'};
  s.forecast=defaultForecast(s.payroll);
  const row=projectYear(s).rows[0];let id=0;
  const posted=validateState(postSalary(s,'2026-09','2026-09-25',()=>`salary-${++id}`));
  assert.deepEqual(posted.transactions.map(t=>[t.salaryPart,t.amount,t.accountId]),[['bank',row.bank,'cash'],['meal',row.mealCard,'meal']]);
  assert.deepEqual(posted.forecast.posted,['2026-09']);
  assert.equal(accountBalances(posted).get('cash'),200000+row.bank);
  assert.equal(accountBalances(posted).get('meal'),row.mealCard);
  assert.equal(cashPlan(posted,'2026-09','2026-09-25').cash,200000+row.bank);
  assert.equal(postSalary(posted,'2026-09','2026-09-25',()=> 'duplicate'),posted);
  assert.throws(()=>postSalary({...s,payroll:{...s.payroll,mealAccountId:null}},'2026-09','2026-09-25',()=> 'missing'),/meal-card account/);
  assert.throws(()=>postSalary(s,'2026-10','2026-09-25',()=> 'early'),/payday/);
  assert.throws(()=>validateState({...s,payroll:{...s.payroll,bankAccountId:'meal'}}),/cash account/);
  assert.throws(()=>validateState({...posted,transactions:posted.transactions.map(t=>t.salaryPart==='meal'?{...t,accountId:'cash'}:t)}),/wrong account type/);
});
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
const ppr={id:'ppr',name:'Growth PPR',symbol:'',kind:'PPR / Insurance',broker:'Test insurer',valuation:'balance',units:1,price:1000,cost:100000,updated:'2026-09-01'};
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
test('version 3 migrates all money and posting history into version 5',()=>{
  const old={...cashWorkspace(),version:3,loans:[loan],holdings:[ppr],recurring:[recurring]};
  delete old.investmentPlans;delete old.contributions;
  old.forecast={start:'2026-09',rows:old.forecast.rows};
  const migrated=validateState(old);
  assert.equal(migrated.version,5);assert.deepEqual(migrated.recurring,old.recurring);
  assert.deepEqual(migrated.transactions,old.transactions);assert.deepEqual(migrated.contributions,[]);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(migrated))),migrated);
  assert.equal(validateState({...migrated,version:4}).version,5);
  assert.throws(()=>validateState({...migrated,version:6}),/valid Conta backup/);
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

// The overview ring answers "where did the money go", so commitments must not
// hide inside Housing/Transport and contributions must not vanish entirely.
import {monthlyOutflows} from './core.mjs';
const outflowState=()=>({...cashWorkspace(),
  transactions:[
    {id:'t1',description:'Rent',category:'Housing',type:'expense',amount:50000,date:'2026-09-01',accountId:'cash',recurringId:'rent',occurrence:'2026-09'},
    {id:'t2',description:'Home loan',category:'Housing',type:'expense',amount:40000,date:'2026-09-05',accountId:'cash',loanId:'loan',occurrence:'2026-09'},
    {id:'t3',description:'Groceries',category:'Groceries',type:'expense',amount:12000,date:'2026-09-06',accountId:'cash'},
    {id:'t4',description:'Dinner',category:'Dining',type:'expense',amount:3000,date:'2026-09-07',accountId:'cash'},
    {id:'t5',description:'Salary',category:'Salary',type:'income',amount:200000,date:'2026-09-25',accountId:'cash'},
    {id:'t6',description:'August groceries',category:'Groceries',type:'expense',amount:9900,date:'2026-08-06',accountId:'cash'}],
  contributions:[{id:'c1',holdingId:'ppr',accountId:'cash',date:'2026-09-20',amount:10000,units:0}]});
test('monthly outflows split commitments from discretionary spending and count contributions',()=>{
  const out=monthlyOutflows(outflowState(),'2026-09');
  assert.deepEqual(out.groups.map(g=>g.label),['Loan instalments','Monthly bills','Investments','Groceries','Dining']);
  assert.deepEqual(out.groups.map(g=>g.amount),[40000,50000,10000,12000,3000]);
  assert.equal(out.total,115000,'income and other months are excluded');
  assert.equal(out.spent,105000);assert.equal(out.invested,10000,'contributions are not expenses but still leave the account');
  assert.equal(Math.round(out.groups.reduce((sum,g)=>sum+g.share,0)),100);
  assert.equal(monthlyOutflows(outflowState(),'2026-10').total,0);
});
test('loose categories collapse to the top three plus a remainder',()=>{
  const s=outflowState();
  s.transactions=['Groceries','Dining','Transport','Leisure','Health'].map((category,i)=>
    ({id:`x${i}`,description:category,category,type:'expense',amount:(5-i)*1000,date:'2026-09-10',accountId:'cash'}));
  s.contributions=[];
  const out=monthlyOutflows(s,'2026-09');
  assert.deepEqual(out.groups.map(g=>g.label),['Groceries','Dining','Transport','Other categories']);
  assert.equal(out.groups.at(-1).amount,3000,'Leisure and Health are pooled');
  assert.equal(out.total,15000);
});
test('variable loans quote index plus spread; fixed phases drop both',()=>{
  const v=validateLoan({...loan,indexRate:2.104,spread:0.9});
  assert.equal(v.tan,3.004,'TAN is the sum, not a separately entered number');
  assert.deepEqual(validateLoan(v),v,'round-trips through a backup unchanged');
  assert.equal(validateLoan(loan).spread,null,'older backups have neither part');
  const fixed=validateLoan({...loan,rateType:'fixed',indexRate:2,spread:1});
  assert.equal(fixed.spread,null);assert.equal(fixed.indexRate,null);assert.equal(fixed.tan,loan.tan);
  assert.equal(amortize(v).rows[0].interest,Math.round(v.balance*3.004/1200),'the schedule runs on the derived TAN');
  for(const bad of [{spread:11},{spread:-1},{indexRate:60},{indexRate:-6,spread:0}])
    assert.throws(()=>validateLoan({...loan,indexRate:1,spread:1,...bad}));
});

// The annual calculator can start from the salary settings instead of a number
// typed from nowhere. CIRS 25 verified 19 September 2026.
import {annualTaxableEstimate, SPECIFIC_DEDUCTION, IAS} from './payroll.mjs';
test('annual taxable estimate applies CIRS 25 and the IRS Jovem annual cap',()=>{
  const base={...defaultPayroll(),gross:150000};
  assert.equal(SPECIFIC_DEDUCTION,Math.round(8.54*IAS),'CIRS 25(1)(a): 8,54 × IAS');
  const plain=annualTaxableEstimate(base);
  assert.equal(plain.gross,2100000);assert.equal(plain.deduction,SPECIFIC_DEDUCTION);
  assert.equal(plain.exemption,0);assert.equal(plain.taxable,2100000-SPECIFIC_DEDUCTION);
  // CIRS 25(2): contributions replace the fixed deduction once they exceed it.
  assert.equal(annualTaxableEstimate({...base,gross:500000}).deduction,Math.round(500000*14*.11));
  // Only the excess over the daily meal limit is category A income.
  assert.equal(annualTaxableEstimate({...base,mealDaily:1200}).gross,2100000+(1200-1046)*242);
  const youth={...base,youth:true,age:28,eligible:true};
  assert.equal(annualTaxableEstimate({...youth,careerYear:1}).taxable,0,'first year exempts the lot');
  assert.equal(annualTaxableEstimate({...youth,careerYear:5}).exemption,1050000,'years 5-7 exempt half');
  assert.equal(annualTaxableEstimate({...youth,careerYear:1,gross:400000}).exemption,YOUTH_CAP,'the cap binds');
  assert.throws(()=>annualTaxableEstimate({...base,youth:true,eligible:false}),/eligibility/);
});

// Dates the app renders itself are dd/mm/yyyy; month-only labels keep their names.
import {dateLabel, monthLabel, termLabel} from './core.mjs';
import {expectedMonth} from './planning.mjs';
test('dates render dd/mm/yyyy without drifting a day',()=>{
  assert.equal(dateLabel('2026-09-19'),'19/09/2026');
  assert.equal(dateLabel('2026-01-01'),'01/01/2026');
  assert.equal(dateLabel('2026-12-31'),'31/12/2026');
  assert.equal(dateLabel('2028-02-29'),'29/02/2028','leap day survives the noon anchor');
  assert.equal(monthLabel('2026-09'),'Sept 2026');
});
test('the expected month is salary in, commitments out, and nothing discretionary',()=>{
  const s=outflowState();
  s.payroll={...defaultPayroll(),gross:150000};
  s.forecast=defaultForecast(s.payroll);
  s.recurring=[{id:'rent',description:'Rent',category:'Housing',amount:50000,accountId:'cash',start:'2026-09-01',end:'',day:1,enabled:true,posted:['2026-09']}];
  s.transactions=s.transactions.map(t=>t.id==='t1'?{...t,recurringId:'rent',amount:50000,date:'2026-09-01'}:t);
  const row=projectYear(s).rows.find(r=>r.month==='2026-09');
  const e=expectedMonth(s,'2026-09');
  assert.equal(e.inPlan,true);
  assert.equal(e.bank,row.bank);assert.equal(e.mealCard,row.mealCard);
  assert.equal(e.committed,row.recurring+row.loans+row.investments);
  assert.equal(e.left,row.bank-e.committed);
  assert.deepEqual(e.movements.map(m=>[m.kind,m.type]),[['salary','income'],['salary','income']]);
  assert.ok(row.other>0,'the month has discretionary spending');
  assert.notEqual(e.left,row.remaining,'which the commitment figure leaves out');
  assert.deepEqual(expectedMonth(s,'2030-04'),{inPlan:false,movements:[]},'months outside the plan have no row');
});
test('the overview exposes scheduled salary and loan movements until they are recorded',()=>{
  const s=cashWorkspace();
  s.payroll={...defaultPayroll(),month:'2026-10'};s.forecast=defaultForecast(s.payroll);
  s.loans=[validateLoan({...loan,accountId:'cash'})];
  const september=expectedMonth(s,'2026-09');
  assert.equal(september.inPlan,false);assert.equal(september.nextPayDate,'2026-10-25');
  assert.deepEqual(september.movements.map(m=>[m.kind,m.date]),[['loan','2026-09-01']]);
  assert.deepEqual(expectedMonth(s,'2026-10').movements.map(m=>m.kind),['loan','salary','salary']);
  assert.ok(scheduledTransactions(s).some(t=>t.kind==='salary'&&t.scheduled));
  assert.ok(scheduledTransactions(s).some(t=>t.kind==='loan'&&t.scheduled));
  s.loans[0].posted=['2026-09'];
  assert.deepEqual(expectedMonth(s,'2026-09').movements,[]);
});
test('scheduled bills project money out until recorded; investment plans stay out',()=>{
  const s=cashWorkspace();
  s.payroll={...defaultPayroll(),month:'2026-10'};s.forecast=defaultForecast(s.payroll);
  s.recurring=[{id:'rent',description:'Rent',category:'Housing',amount:50000,accountId:'cash',start:'2026-09-01',end:'',day:1,enabled:true,posted:['2026-09']}];
  s.investmentPlans=[{id:'etf',kind:'investment',holdingId:'h',accountId:'cash',amount:10000,start:'2026-09-01',end:'2026-12-31',day:5,enabled:true,posted:[]}];
  const rent=scheduledTransactions(s).filter(t=>t.kind==='recurring');
  assert.deepEqual(rent.map(t=>[t.date,t.type,t.amount]),[['2026-10-01','expense',50000],['2026-11-01','expense',50000],['2026-12-01','expense',50000]],'posted September is not scheduled again');
  assert.ok(scheduledTransactions(s).every(t=>t.kind!=='investment'));
  assert.equal(new Set(scheduledTransactions(s).map(t=>t.id)).size,scheduledTransactions(s).length,'ids stay unique');
});
test('CSV export keeps ISO dates so every spreadsheet locale reads them the same',()=>{
  assert.ok(toCSV([{...transaction,date:'2026-09-24'}]).includes('"2026-09-24"'));
});
test('loan terms read as years and months',()=>{
  assert.equal(termLabel(0),'0 months');
  assert.equal(termLabel(1),'1 month');
  assert.equal(termLabel(7),'7 months');
  assert.equal(termLabel(12),'1 year');
  assert.equal(termLabel(13),'1 year 1 month');
  assert.equal(termLabel(29),'2 years 5 months');
  assert.equal(termLabel(240),'20 years','a round term drops the months');
});

import {loanOutstanding,netWorth,trackedLoanDebt} from './core.mjs';
test('recorded loan principal changes debt; future plans, edits, deletion and rebasing do not invent repayments',()=>{
  let s=cashWorkspace();
  s.loans=[validateLoan({...loan,balance:20000,months:2,tan:0,monthlyCosts:1000,accountId:'cash'})];
  assert.equal(trackedLoanDebt(s,'2026-09-30'),20000);
  assert.equal(netWorth(s,'2026-09-30').total,180000);
  s=validateState(postDueExpenses(s,'2026-09-01',()=> 'instalment'));
  assert.equal(s.transactions[0].loanPrincipal,10000);
  assert.equal(loanOutstanding(s,s.loans[0],'2026-08-31'),20000);
  assert.equal(trackedLoanDebt(s,'2026-09-30'),10000);
  assert.equal(netWorth(s,'2026-09-30').total,179000,'interest and costs reduce wealth, principal repayment does not');
  assert.equal(trackedLoanDebt(s,'2027-09-30'),10000,'time alone does not pay the second instalment');
  s=validateState({...s,loans:[{...s.loans[0],tan:5}],transactions:[{...s.transactions[0],amount:11500}]});
  assert.equal(trackedLoanDebt(s),10000,'saved principal survives amount and rate edits');
  assert.equal(trackedLoanDebt({...s,transactions:[]}),20000,'deleting the payment restores debt');
  const rebased=validateState({...s,loans:[{...s.loans[0],balance:12345,start:'2026-10-01',end:'2026-11-30',posted:['2026-09']}]});
  assert.equal(trackedLoanDebt(rebased),12345,'older posted instalments do not reduce lender rebased balance');
  const movedDate=validateState({...rebased,transactions:[{...rebased.transactions[0],date:'2026-10-02'}]});
  assert.equal(trackedLoanDebt(movedDate),12345,'an old occurrence with a later edited date cannot repay the rebased loan twice');
});
test('optional finance fields roundtrip, preserve old asset snapshots and reject bad import identities',()=>{
  const base={...cashWorkspace(),snapshots:[{date:'2026-09-01',cash:200000,investments:0,cost:0}]};
  delete base.expenseShortcuts;
  const s=validateState({...base,accounts:[{...base.accounts[0],reconciledAt:'2026-09-24'}],cashBuffer:25000,merchantRules:[{merchant:'  Super   Market ',category:'Groceries'}]});
  assert.deepEqual(s.expenseShortcuts.map(x=>x.category),['Fuel','Groceries','Office','Tech']);
  assert.equal(s.expenseShortcuts[0].accountId,'cash');
  assert.equal(cashPlan(s,'2026-09','2026-09-24').safeToSpend,175000);
  assert.equal(s.snapshots[0].debts,undefined,'old snapshots keep their total-assets meaning');
  assert.deepEqual(s.merchantRules,[{merchant:'super market',category:'Groceries'}]);
  const newer=validateState({...s,snapshots:[...s.snapshots,{date:'2026-09-24',cash:200000,investments:0,cost:0,debts:10000}]});
  assert.equal(newer.snapshots[1].debts,10000);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(newer))),newer);
  assert.equal(validateState({...s,expenseShortcuts:[]}).expenseShortcuts.length,0);
  for(const change of [{cashBuffer:-1},{cashBuffer:1.5},{merchantRules:[{merchant:'x',category:'Bad'}]},{merchantRules:[{merchant:'Shop',category:'Groceries'},{merchant:' shop ',category:'Fuel'}]},{expenseShortcuts:[{...s.expenseShortcuts[0],accountId:'missing'}]},{accounts:[{...s.accounts[0],reconciledAt:'2026-02-30'}]}])assert.throws(()=>validateState({...s,...change}));
  const imported={id:'bank-item',date:'2026-09-24',description:'Shop',type:'expense',category:'Groceries',amount:1000,accountId:'cash',importSource:'statement',importKey:'row-1'};
  assert.deepEqual(validateState({...s,transactions:[imported]}).transactions,[imported]);
  assert.throws(()=>validateState({...s,transactions:[imported,{...imported,id:'duplicate'}]}),/duplicate imported/);
  const withSecondAccount={...s,accounts:[...s.accounts,{id:'other',name:'Second',bank:'Bank',kind:'Current',opening:0}]};
  assert.equal(validateState({...withSecondAccount,transactions:[imported,{...imported,id:'same-statement-other-account',accountId:'other'}]}).transactions.length,2);
  assert.throws(()=>validateState({...s,transactions:[{...imported,importKey:undefined}]}),/imported transaction/);
});
