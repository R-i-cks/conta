// 2026 mainland employees, general Social Security regime, without disability.
// Despacho 233-A/2026 tables I–III; CIRS 12-B, 99-E, 99-F.
// Verified 19 September 2026 against the published despacho (2.a serie, N.o 3,
// suplemento, 06-01-2026): tables I and II are identical except for the parcela
// adicional a abater por dependente, 21.43 vs 34.29; table III uses 42.86.
export const IAS = 53713; // cents; Portaria 480-A/2025/1
export const YOUTH_CAP = 55 * IAS;
export const MEAL_LIMITS={cash:615,card:1046}; // CIRS 2(3)(b)(2), Portaria 51-B/2026/1.
export const PAYROLL_SOURCE = 'https://diariodarepublica.pt/dr/detalhe/despacho/233-a-2026-998488151';
export const PAYROLL_TABLE = [
  [920,0,0], [1042,12.5,[2.6,1273.85]], [1108,15.7,[1.35,1554.83]],
  [1154,15.7,94.71], [1212,21.2,158.18], [1819,24.1,193.33],
  [2119,31.1,320.66], [2499,34.9,401.19], [3305,38.36,487.66],
  [5547,39.69,531.62], [20221,44.95,823.40], [Infinity,47.17,1272.31],
];
export const SINGLE_EARNER_TABLE = [
  [991,0,0], [1042,12.5,[2.6,1372.15]], [1108,12.5,[1.35,1677.85]],
  [1119,12.5,96.17], [1432,12.72,98.64], [1962,15.7,141.32],
  [2240,19.38,213.53], [2773,22.77,289.47], [3389,25.7,370.72],
  [5965,28.81,476.12], [20265,38.43,1049.96], [Infinity,47.17,2821.13],
];
// Placeholder starting values, not anyone's pay. Saved settings override them.
export const defaultPayroll = () => ({gross:100000,month:'2026-09',family:'single',dependants:0,payments:14,
  mealDaily:960,mealDays:22,mealMethod:'card',annualMealDays:242,
  youth:false,age:30,careerYear:1,eligible:false,employerApplied:false});
export function validatePayroll(p) {
  if (!p || !Number.isSafeInteger(p.gross) || p.gross<0 || p.gross>100_000_000_000 ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month) || p.month<'2026-01' || p.month>'2100-12' || !['single','married-two','married-one'].includes(p.family) ||
    !Number.isInteger(p.dependants) || p.dependants<0 || p.dependants>20 || ![12,14].includes(p.payments) ||
    !Number.isSafeInteger(p.mealDaily) || p.mealDaily<0 || p.mealDaily>100000 || !['cash','card'].includes(p.mealMethod) ||
    !Number.isInteger(p.mealDays) || p.mealDays<0 || p.mealDays>31 || !Number.isInteger(p.annualMealDays) || p.annualMealDays<0 || p.annualMealDays>366 ||
    !Number.isInteger(p.age) || p.age<0 || p.age>100 || !Number.isInteger(p.careerYear) || p.careerYear<1 || p.careerYear>10 ||
    ['youth','eligible','employerApplied'].some(k=>typeof p[k]!=='boolean')) throw new Error('Invalid monthly salary settings.');
  return Object.fromEntries(Object.keys(defaultPayroll()).map(key=>[key,p[key]]));
}
export function youthRate(year) { return year===1 ? 1 : year<=4 ? .75 : year<=7 ? .5 : .25; }
function withholding(grossCents,p) {
  const gross=grossCents/100;
  const table=p.family==='married-one'?SINGLE_EARNER_TABLE:PAYROLL_TABLE;
  const index=table.findIndex(([limit])=>gross<=limit);
  const [limit,baseRate,abatement]=table[index];
  const rate=Math.max(0,baseRate-(p.dependants>=3?1:0));
  // Variable abatements use the published base rate even where a family reduction applies.
  const deduction=Array.isArray(abatement)?baseRate/100*abatement[0]*(abatement[1]-gross):abatement;
  const perDependant=index===0?0:p.family==='single'?34.29:p.family==='married-one'?42.86:21.43;
  const raw=Math.max(0,gross*rate/100-deduction-perDependant*p.dependants);
  const regularIRS=Math.floor(raw+1e-9)*100; // CIRS 99-E: round down to whole euros.
  // Exempt income determines the rate; do not look up a lower band on the remainder.
  const exemption=p.youth?Math.min(grossCents*youthRate(p.careerYear),YOUTH_CAP/14):0;
  const youthIRS=Math.floor((grossCents?raw*(1-exemption/grossCents):0)+1e-9)*100;
  const irs=p.youth&&p.employerApplied?youthIRS:regularIRS;
  return {irs,regularIRS,youthIRS,exemption:Math.round(exemption),
    benefit:p.youth?regularIRS-youthIRS:0,index,limit,rate,deduction:Math.round(deduction*100),
    dependentDeduction:Math.round(perDependant*p.dependants*100)};
}
export function calculatePayroll(input) {
  const p=validatePayroll(input);
  if (p.youth && (!p.eligible || p.age<1 || p.age>35)) throw new Error('Confirm IRS Jovem eligibility and an age up to 35 before applying the benefit.');
  const limit=MEAL_LIMITS[p.mealMethod],meal=p.mealDaily*p.mealDays;
  const mealTaxable=Math.max(0,p.mealDaily-limit)*p.mealDays;
  const taxable=p.gross+mealTaxable;
  const regular=withholding(taxable,p),bonus=withholding(p.gross,p);
  const ss=Math.round(taxable*.11),bonusSS=Math.round(p.gross*.11);
  const regularNet=p.gross+meal-regular.irs-ss,bonusNet=p.gross-bonus.irs-bonusSS;
  // 12 bank payments = base plus two separately taxed allowances paid in twelfths.
  const bonusGrossPart=2*Math.round(p.gross/12),bonusIRSPart=2*Math.round(bonus.irs/12);
  const extra=p.payments===12;
  const totalIRS=regular.irs+(extra?bonusIRSPart:0),totalSS=Math.round((taxable+(extra?bonusGrossPart:0))*.11);
  const net=p.gross+meal+(extra?bonusGrossPart:0)-totalIRS-totalSS;
  const annualMeal=p.mealDaily*p.annualMealDays;
  const annualMealTaxable=Math.max(0,p.mealDaily-limit)*p.annualMealDays;
  // Planning estimate: distribute the declared annual meal days evenly across 12 months.
  const annualWithheld=withholding(p.gross+annualMealTaxable/12,p).irs*12+bonus.irs*2;
  const annualSS=Math.round((p.gross*14+annualMealTaxable)*.11);
  return {...regular,gross:p.gross,irs:totalIRS,ss:totalSS,net,meal,mealTaxable,mealLimit:limit,taxable,
    mealCard:p.mealMethod==='card'?meal:0,bankNet:net-(p.mealMethod==='card'?meal:0),regularNet,bonusNet,
    twelveNet:p.gross+meal+bonusGrossPart-regular.irs-bonusIRSPart-Math.round((taxable+bonusGrossPart)*.11),extraGross:extra?bonusGrossPart:0,
    effective:taxable?regular.irs/taxable*100:0,annualGross:p.gross*14,annualMeal,annualSS,annualWithheld,
    annualNet:p.gross*14+annualMeal-annualSS-annualWithheld};
}
