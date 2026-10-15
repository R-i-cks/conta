// Statistics over daily prices. Pure functions: no DOM, no fetch, so node can
// check them. Everything here describes the past; nothing predicts.
export const SYMBOL=/^[A-Z0-9.^=-]{1,20}$/;
const TRADING_DAYS=252;
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const stdev=a=>{const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1));};
const logReturns=v=>v.slice(1).map((x,i)=>Math.log(x/v[i]));
export function sma(values,n){
  let sum=0;
  return values.map((v,i)=>{sum+=v-(i>=n?values[i-n]:0);return i+1<n?null:sum/n;});
}
// Wilder's RSI: average gains against average losses over n days, 0–100.
export function rsi(values,n=14){
  const out=values.map(()=>null);let gain=0,loss=0;
  for(let i=1;i<values.length;i++){
    const d=values[i]-values[i-1],g=Math.max(d,0),l=Math.max(-d,0);
    if(i<=n){gain+=g/n;loss+=l/n;}else{gain=(gain*(n-1)+g)/n;loss=(loss*(n-1)+l)/n;}
    if(i>=n)out[i]=loss?100-100/(1+gain/loss):gain?100:null; // flat prices have no momentum to read
  }
  return out;
}
export function drawdown(values){
  let peak=-Infinity,max=0;
  for(const v of values){peak=Math.max(peak,v);max=Math.min(max,v/peak-1);}
  return {max,current:values.at(-1)/peak-1};
}
export const volatility=values=>values.length>2?stdev(logReturns(values))*Math.sqrt(TRADING_DAYS):null;
export function shiftDate(iso,{months=0,days=0}={}){
  const d=new Date(iso+'T00:00:00Z'),day=d.getUTCDate();
  d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);
  d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate())-days); // clamp to the month's last day
  return d.toISOString().slice(0,10);
}
// Return since the last close on or before `target`; null when history is too short.
export function periodReturn(dates,values,target){
  const i=dates.findLastIndex(d=>d<=target);
  return i<0||i===dates.length-1&&dates[i]>target?null:values.at(-1)/values[i]-1;
}
// Match exact session dates before rebasing; never carry a price across a missing session.
export function benchmarkComparison(stock,benchmark){
  const other=new Map(benchmark.dates.map((d,i)=>[d,benchmark.adjusted[i]]));
  const matched=stock.dates.map((d,i)=>[d,stock.adjusted[i],other.get(d)]).filter(([,a,b])=>Number.isFinite(a)&&a>0&&Number.isFinite(b)&&b>0);
  if(matched.length<2)return {dates:[],stock:[],benchmark:[],returns:[]};
  const dates=matched.map(r=>r[0]),a=matched.map(r=>r[1]),b=matched.map(r=>r[2]),end=dates.at(-1);
  const returns=[1,3,6,12].map(months=>{
    const target=shiftDate(end,{months}),i=dates.findLastIndex(d=>d<=target);
    const stock=i<0?null:a.at(-1)/a[i]-1,benchmark=i<0?null:b.at(-1)/b[i]-1;
    return {period:months===12?'1y':months+'m',start:i<0?null:dates[i],end,stock,benchmark,difference:i<0?null:stock-benchmark};
  });
  const window=matched.filter(r=>r[0]>=shiftDate(end,{months:12}));
  return {dates:window.map(r=>r[0]),stock:window.map(r=>r[1]/window[0][1]*100),benchmark:window.map(r=>r[2]/window[0][2]*100),returns};
}
// Least squares on log prices: annualised slope and how much of the motion it explains.
export function trend(values){
  const y=values.map(Math.log),n=y.length,x=y.map((_,i)=>i),mx=mean(x),my=mean(y);
  let sxy=0,sxx=0,ssTot=0;
  for(let i=0;i<n;i++){sxy+=(x[i]-mx)*(y[i]-my);sxx+=(x[i]-mx)**2;ssTot+=(y[i]-my)**2;}
  const slope=sxx?sxy/sxx:0,intercept=my-slope*mx;
  const ssRes=y.reduce((s,v,i)=>s+(v-(intercept+slope*x[i]))**2,0);
  const r2=ssTot?1-ssRes/ssTot:0,annual=Math.exp(slope*TRADING_DAYS)-1;
  return {annual,r2,label:r2<0.3?'sideways':annual>0?'uptrend':'downtrend'};
}
// Swing points: a high (low) that no bar within `span` days on either side beats.
// A swing at index i is only known at i+span; detectors wait for that.
export function swingPoints(highs,lows,span=5){
  const out={highs:[],lows:[]};
  for(let i=span;i<highs.length-span;i++){
    const h=highs.slice(i-span,i+span+1),l=lows.slice(i-span,i+span+1);
    if(highs[i]===Math.max(...h))out.highs.push({i,value:highs[i]});
    if(lows[i]===Math.min(...l))out.lows.push({i,value:lows[i]});
  }
  return out;
}
export function swings(highs,lows,span=5){
  const p=swingPoints(highs,lows,span);
  return {highs:p.highs.map(s=>s.value),lows:p.lows.map(s=>s.value)};
}
export function lastCross(fast,slow){
  for(let i=fast.length-1;i>0;i--){
    if(fast[i]===null||slow[i]===null||fast[i-1]===null||slow[i-1]===null)return null;
    const above=fast[i]>slow[i],wasAbove=fast[i-1]>slow[i-1];
    if(above!==wasAbove)return {type:above?'golden':'death',daysAgo:fast.length-1-i};
  }
  return null;
}
const Z90=1.2816; // 10th and 90th percentiles of a normal distribution
export const HORIZONS=[['1 month',21],['3 months',63],['6 months',126],['1 year',252]];
// Lognormal model percentiles from realised volatility around a driftless base.
export function scenarios(price,annualVol){
  return HORIZONS.map(([horizon,days])=>{
    const t=days/TRADING_DAYS,spread=annualVol*Math.sqrt(t);
    return {horizon,days,bear:price*Math.exp(-Z90*spread),base:price,bull:price*Math.exp(Z90*spread)};
  });
}
export function analyse(stock){
  const {dates,closes,adjusted,highs,lows,volumes}=stock;
  if(!dates?.length||dates.length!==closes.length)throw new Error('Price history is incomplete.');
  const last=dates.at(-1),price=closes.at(-1),year=dates.findIndex(d=>d>=shiftDate(last,{months:12})),yearStart=year<0?0:year;
  const yearAdj=adjusted.slice(yearStart),yearHighs=highs.slice(yearStart),yearLows=lows.slice(yearStart);
  const sma20=sma(closes,20),sma50=sma(closes,50),sma200=sma(closes,200),rsi14=rsi(closes).at(-1);
  const high52=Math.max(...yearHighs.filter(Number.isFinite)),low52=Math.min(...yearLows.filter(Number.isFinite));
  const vol1y=volatility(yearAdj),vol30=adjusted.length>31?volatility(adjusted.slice(-31)):null;
  const dd=drawdown(yearAdj),recent=trend(adjusted.slice(-126));
  const cross=lastCross(sma50,sma200);
  const avg=(a,n)=>a.length>=n?mean(a.slice(-n)):null,volume10=avg(volumes,10),volume63=avg(volumes,63);
  const swing=swings(highs.slice(-TRADING_DAYS),lows.slice(-TRADING_DAYS));
  const support=Math.max(...swing.lows.filter(v=>v<price)),resistance=Math.min(...swing.highs.filter(v=>v>price));
  const returns=Object.fromEntries([['1w',{days:7}],['1m',{months:1}],['3m',{months:3}],['6m',{months:6}],['1y',{months:12}]].map(([k,s])=>[k,periodReturn(dates,adjusted,shiftDate(last,s))]));
  returns.ytd=periodReturn(dates,adjusted,`${last.slice(0,4)}-01-01`);
  const metrics={price,last,high52,low52,fromHigh:price/high52-1,fromLow:price/low52-1,sma20:sma20.at(-1),sma50:sma50.at(-1),sma200:sma200.at(-1),rsi:rsi14,vol1y,vol30,
    maxDrawdown:dd.max,currentDrawdown:dd.current,trend:recent,cross,volumeRatio:volume10&&volume63?volume10/volume63:null,
    support:Number.isFinite(support)?support:null,resistance:Number.isFinite(resistance)?resistance:null,returns,sma50Series:sma50,sma200Series:sma200,
    scenarios:vol1y===null?[]:scenarios(price,vol1y),patterns:patterns(stock)};
  metrics.flags=flags(metrics);
  return metrics;
}
const pct=v=>`${v>=0?'+':''}${(v*100).toFixed(1)}%`;
// Plain-language observations. Each names the number behind it; none says buy or sell.
export function flags(m){
  const out=[];
  if(m.sma50!==null&&m.sma200!==null)out.push(m.price>m.sma50&&m.price>m.sma200?{tone:'positive',text:`Price is above its 50-day and 200-day averages.`}:m.price<m.sma50&&m.price<m.sma200?{tone:'negative',text:`Price is below its 50-day and 200-day averages.`}:{tone:'neutral',text:`Price sits between its 50-day and 200-day averages.`});
  if(m.cross&&m.cross.daysAgo<=60)out.push({tone:m.cross.type==='golden'?'positive':'negative',text:`The 50-day average crossed ${m.cross.type==='golden'?'above':'below'} the 200-day average ${m.cross.daysAgo} trading days ago (a ${m.cross.type} cross).`});
  if(m.rsi!==null)out.push(m.rsi>=70?{tone:'negative',text:`RSI is ${m.rsi.toFixed(0)}: recent average gains exceed average losses.`}:m.rsi<=30?{tone:'positive',text:`RSI is ${m.rsi.toFixed(0)}: recent average losses exceed average gains.`}:{tone:'neutral',text:`RSI is ${m.rsi.toFixed(0)}, in its neutral band.`});
  if(m.fromHigh>-0.03)out.push({tone:'neutral',text:`Within ${pct(Math.abs(m.fromHigh))} of the 52-week high.`});
  else if(m.fromLow<0.05)out.push({tone:'neutral',text:`Within ${pct(m.fromLow)} of the 52-week low after a ${pct(m.currentDrawdown)} fall from the peak.`});
  else if(m.currentDrawdown<-0.1)out.push({tone:'neutral',text:`${pct(m.currentDrawdown)} below its 52-week peak; the deepest fall this year was ${pct(m.maxDrawdown)}.`});
  if(m.vol30!==null&&m.vol1y!==null)out.push(m.vol30>m.vol1y*1.3?{tone:'negative',text:`Recent moves are larger than usual: ${pct(m.vol30).slice(1)} annualised volatility over the last month against ${pct(m.vol1y).slice(1)} over the year.`}:m.vol30<m.vol1y*0.7?{tone:'neutral',text:`Recent moves are calmer than usual: ${pct(m.vol30).slice(1)} annualised volatility over the last month against ${pct(m.vol1y).slice(1)} over the year.`}:{tone:'neutral',text:`Volatility of ${pct(m.vol1y).slice(1)} annualised, which is about ${pct(m.vol1y/Math.sqrt(12)).slice(1)} over a typical month of the measured period.`});
  if(m.trend.r2>=0.6)out.push({tone:m.trend.annual>0?'positive':'negative',text:`The last six months follow a fairly steady ${m.trend.label} (${pct(m.trend.annual)} a year pace, explaining ${(m.trend.r2*100).toFixed(0)}% of the motion).`});
  else out.push({tone:'neutral',text:`The last six months show no steady trend; a straight line explains only ${(m.trend.r2*100).toFixed(0)}% of the motion.`});
  if(m.volumeRatio!==null&&(m.volumeRatio>1.5||m.volumeRatio<0.6))out.push({tone:'neutral',text:`Trading volume over the last ten days is ${m.volumeRatio.toFixed(1)}× the three-month average: ${m.volumeRatio>1?'more':'less'} volume than the three-month average.`});
  if(m.support!==null||m.resistance!==null)out.push({tone:'neutral',text:`Recent swing points: ${m.support!==null?`support near ${m.support.toFixed(2)}`:'no support below'}${m.resistance!==null?`, resistance near ${m.resistance.toFixed(2)}`:', no resistance above'}. These are historical price levels.`});
  return out;
}

// ---- Named chart patterns. Each detector returns the trading-day index on
// which the pattern completed (a neckline break, a breakout close, a candle
// close), never the earlier swing day, so the history stats never peek ahead.
const SPAN=5,near=(a,b,tol)=>Math.abs(a-b)/Math.max(a,b)<=tol;
const firstBreak=(closes,from,until,test)=>{for(let j=from;j<Math.min(until,closes.length);j++)if(test(closes[j]))return j;return null;};
const extreme=(values,a,b,fn)=>fn(...values.slice(a,b+1));
function doubles(c,top){
  // Two swing highs (lows) within 3% over 20–120 days, a trough (peak) at least
  // 5% away between them, completed by a close through that level within 60 days.
  const points=top?c.swing.highs:c.swing.lows,level=top?c.lows:c.highs,out=[];
  for(let k=1;k<points.length;k++){
    const a=points[k-1],b=points[k],gap=b.i-a.i;
    if(gap<20||gap>120||!near(a.value,b.value,0.03))continue;
    const neck=extreme(level,a.i,b.i,top?Math.min:Math.max);
    if(top?neck>Math.min(a.value,b.value)*0.95:neck<Math.max(a.value,b.value)*1.05)continue;
    const j=firstBreak(c.closes,b.i+SPAN,b.i+SPAN+60,x=>top?x<neck:x>neck);
    if(j!==null)out.push(j);
  }
  return out;
}
function headShoulders(c,top){
  // Shoulders within 5% of each other, head at least 3% beyond both, 30–200 days
  // from shoulder to shoulder, completed by a close through the neckline.
  const points=top?c.swing.highs:c.swing.lows,level=top?c.lows:c.highs,out=[];
  for(let k=2;k<points.length;k++){
    const [s1,h,s2]=[points[k-2],points[k-1],points[k]],width=s2.i-s1.i;
    if(width<30||width>200||!near(s1.value,s2.value,0.05))continue;
    if(top?h.value<Math.max(s1.value,s2.value)*1.03:h.value>Math.min(s1.value,s2.value)*0.97)continue;
    const neck=top?Math.min(extreme(level,s1.i,h.i,Math.min),extreme(level,h.i,s2.i,Math.min)):Math.max(extreme(level,s1.i,h.i,Math.max),extreme(level,h.i,s2.i,Math.max));
    const j=firstBreak(c.closes,s2.i+SPAN,s2.i+SPAN+60,x=>top?x<neck:x>neck);
    if(j!==null)out.push(j);
  }
  return out;
}
function breakouts(c,up){
  // First close beyond the previous 60 days' extreme; later new highs in the same run do not count again.
  const out=[],beyond=j=>up?c.closes[j]>extreme(c.highs,j-60,j-1,Math.max):c.closes[j]<extreme(c.lows,j-60,j-1,Math.min);
  for(let j=61;j<c.closes.length;j++)if(beyond(j)&&!beyond(j-1))out.push(j);
  return out;
}
const gaps=(c,up)=>c.opens?c.closes.map((_,j)=>j>0&&(up?c.opens[j]>c.highs[j-1]*1.02:c.opens[j]<c.lows[j-1]*0.98)?j:null).filter(j=>j!==null):[];
function candles(c,kind){
  if(!c.opens)return [];
  const out=[],body=j=>Math.abs(c.closes[j]-c.opens[j]);
  for(let j=6;j<c.closes.length;j++){
    const o=c.opens[j],x=c.closes[j],h=c.highs[j],l=c.lows[j],fell=c.closes[j-1]<c.closes[j-6]*0.97,rose=c.closes[j-1]>c.closes[j-6]*1.03;
    const prevBear=c.closes[j-1]<c.opens[j-1],prevBull=c.closes[j-1]>c.opens[j-1];
    if(kind==='bullishEngulfing'&&fell&&prevBear&&x>o&&o<=c.closes[j-1]&&x>=c.opens[j-1]&&body(j)>body(j-1))out.push(j);
    if(kind==='bearishEngulfing'&&rose&&prevBull&&x<o&&o>=c.closes[j-1]&&x<=c.opens[j-1]&&body(j)>body(j-1))out.push(j);
    if(kind==='hammer'&&fell&&body(j)>0&&Math.min(o,x)-l>=2*body(j)&&h-Math.max(o,x)<=body(j))out.push(j);
    if(kind==='shootingStar'&&rose&&body(j)>0&&h-Math.max(o,x)>=2*body(j)&&Math.min(o,x)-l<=body(j))out.push(j);
  }
  return out;
}
function crosses(c,golden){
  const out=[];
  for(let j=1;j<c.closes.length;j++){
    if([c.sma50[j],c.sma50[j-1],c.sma200[j],c.sma200[j-1]].some(v=>v===null))continue;
    const above=c.sma50[j]>c.sma200[j],wasAbove=c.sma50[j-1]>c.sma200[j-1];
    if(above!==wasAbove&&above===golden)out.push(j);
  }
  return out;
}
export const PATTERNS=[
  ['doubleTop','Double top','bearish',c=>doubles(c,true)],['doubleBottom','Double bottom','bullish',c=>doubles(c,false)],
  ['headShoulders','Head and shoulders','bearish',c=>headShoulders(c,true)],['inverseHeadShoulders','Inverse head and shoulders','bullish',c=>headShoulders(c,false)],
  ['breakout','Breakout above the 60-day range','bullish',c=>breakouts(c,true)],['breakdown','Breakdown below the 60-day range','bearish',c=>breakouts(c,false)],
  ['gapUp','Gap up','bullish',c=>gaps(c,true)],['gapDown','Gap down','bearish',c=>gaps(c,false)],
  ['bullishEngulfing','Bullish engulfing candle','bullish',c=>candles(c,'bullishEngulfing')],['bearishEngulfing','Bearish engulfing candle','bearish',c=>candles(c,'bearishEngulfing')],
  ['hammer','Hammer candle','bullish',c=>candles(c,'hammer')],['shootingStar','Shooting star candle','bearish',c=>candles(c,'shootingStar')],
  ['goldenCross','Golden cross','bullish',c=>crosses(c,true)],['deathCross','Death cross','bearish',c=>crosses(c,false)],
];
// What this stock did in the `horizon` days after each completed signal.
export function history(signals,adjusted,horizon=21){
  const returns=signals.filter(i=>i+horizon<adjusted.length).map(i=>adjusted[i+horizon]/adjusted[i]-1).sort((a,b)=>a-b);
  const n=returns.length,mid=Math.floor(n/2);
  return {count:n,up:returns.filter(r=>r>0).length,median:!n?null:n%2?returns[mid]:(returns[mid-1]+returns[mid])/2};
}
export function patterns(stock,horizon=21){
  // A bar from a session still open can change before the close, so it cannot complete anything yet.
  const end=stock.liveBar?stock.closes.length-1:stock.closes.length,cut=a=>a&&a.slice(0,end);
  const dates=cut(stock.dates),closes=cut(stock.closes),adjusted=cut(stock.adjusted),highs=cut(stock.highs),lows=cut(stock.lows),opens=cut(stock.opens);
  const c={closes,adjusted,highs,lows,opens:opens&&opens.length===closes.length?opens:null,sma50:sma(closes,50),sma200:sma(closes,200),swing:swingPoints(highs,lows,SPAN)};
  const found=PATTERNS.map(([key,name,direction,detect])=>{
    const signals=[...new Set(detect(c))].sort((a,b)=>a-b);
    if(!signals.length)return null;
    const last=signals.at(-1);
    return {key,name,direction,occurrences:signals.length,last:{date:dates[last],daysAgo:stock.closes.length-1-last},history:history(signals,adjusted,horizon)};
  }).filter(Boolean).sort((a,b)=>a.last.daysAgo-b.last.daysAgo);
  // Any month in the same period, so a hit rate can be read against this stock's own habit.
  found.baseline=history(closes.map((_,i)=>i),adjusted,horizon);
  return found;
}

// ---- Metric guide: one line on what each number means and a rule-of-thumb
// rating against stated thresholds. Thresholds are generic; the UI says so.
const below=(good,warn,unit='')=>({grade:v=>v<=good?'good':v<=warn?'warn':'bad',rule:`Good ≤ ${good}${unit} · Watch ${good}–${warn}${unit} · Poor > ${warn}${unit}`});
const above=(good,warn,unit='')=>({grade:v=>v>=good?'good':v>=warn?'warn':'bad',rule:`Good ≥ ${good}${unit} · Watch ${warn}–${good}${unit} · Poor < ${warn}${unit}`});
const between=(lo,hi,unit='')=>({grade:v=>v>=lo&&v<=hi?'good':'warn',rule:`Typical ${lo}–${hi}${unit} · Watch outside`});
const f=(path)=>(m,fund)=>path.split('.').reduce((v,k)=>v?.[k],fund)??null;
const pctOf=v=>v===null||v===undefined?null:v*100;
export const GUIDE=[
  ['1-year return','pct',m=>pctOf(m.returns['1y']),above(10,0,'%'),'Price change over twelve months including dividends. Compare with the benchmark, not with zero.'],
  ['Volatility','pct',m=>pctOf(m.vol1y),below(20,40,'%'),'How much the price swings in a year. High volatility means bigger losses on bad days as well as bigger gains.'],
  ['Drawdown from peak','pct',m=>pctOf(m.currentDrawdown),above(-10,-25,'%'),'How far the price sits below its 52-week high. Deep drawdowns need large rises to recover.'],
  ['RSI (14)','num',m=>m.rsi,between(30,70),'Momentum over two weeks. Above 70 the rise has been fast; below 30 the fall has been fast. Neither says what happens next.'],
  ['Trend versus averages','text',m=>m.sma50===null||m.sma200===null?null:m.price>m.sma50&&m.price>m.sma200?'Above both':m.price<m.sma50&&m.price<m.sma200?'Below both':'Between',{grade:v=>v==='Above both'?'good':v==='Between'?'warn':'bad',rule:'Good above both · Watch between · Poor below both'},'Where the price sits against its 50-day and 200-day averages, the usual definition of an uptrend or downtrend.'],
  ['Trailing P/E','x',f('summaryDetail.trailingPE'),{grade:v=>v<0?'bad':v<=15?'good':v<=25?'warn':'bad',rule:'Good ≤ 15 · Watch 15–25 · Poor > 25 or negative'},'Price divided by last year\'s earnings per share: how many years of profit you pay for. Negative means the company lost money.'],
  ['Forward P/E','x',f('summaryDetail.forwardPE'),{grade:v=>v<0?'bad':v<=15?'good':v<=25?'warn':'bad',rule:'Good ≤ 15 · Watch 15–25 · Poor > 25 or negative'},'The same ratio using analysts\' estimated earnings for next year. Estimates are often optimistic.'],
  ['PEG ratio','x',f('defaultKeyStatistics.pegRatio'),below(1,2),'P/E divided by expected growth. Around 1 means you pay a fair price for the growth; well above 2 means growth is expensive.'],
  ['Price / book','x',f('defaultKeyStatistics.priceToBook'),below(1.5,3),'Price against the accounting value of the company\'s assets. Meaningful for banks and industry, less so for software and brands.'],
  ['Price / sales','x',f('summaryDetail.priceToSalesTrailing12Months'),below(2,5),'Market value against yearly revenue. Useful when earnings are negative or lumpy.'],
  ['Dividend yield','pct',(m,fund)=>pctOf(f('summaryDetail.dividendYield')(m,fund)),{grade:v=>v>=2&&v<=6?'good':v<2?'warn':'bad',rule:'Good 2–6% · Watch below 2% · Poor above 6%, often a falling price'},'Yearly dividend as a share of the price. A very high yield usually means the price fell or the dividend is at risk.'],
  ['Payout ratio','pct',(m,fund)=>pctOf(f('summaryDetail.payoutRatio')(m,fund)),below(60,80,'%'),'Share of profit paid out as dividends. Above 80% leaves little room if profits dip.'],
  ['Beta','num',f('summaryDetail.beta'),{grade:v=>v<=0.8?'good':v<=1.2?'warn':'bad',rule:'Good ≤ 0.8 · Watch 0.8–1.2 · Poor > 1.2'},'How much the stock moves with the market. 1.5 means it tends to fall 15% when the market falls 10%.'],
  ['Profit margin','pct',(m,fund)=>pctOf(f('financialData.profitMargins')(m,fund)),above(10,5,'%'),'Net profit as a share of revenue. Thin margins leave little cushion against cost rises.'],
  ['Operating margin','pct',(m,fund)=>pctOf(f('financialData.operatingMargins')(m,fund)),above(15,5,'%'),'Profit from the core business before interest and tax, as a share of revenue.'],
  ['Revenue growth','pct',(m,fund)=>pctOf(f('financialData.revenueGrowth')(m,fund)),above(10,0,'%'),'Sales growth against the same period a year earlier.'],
  ['Earnings growth','pct',(m,fund)=>pctOf(f('financialData.earningsGrowth')(m,fund)),above(10,0,'%'),'Profit growth against the same period a year earlier. One-off items distort it.'],
  ['Return on equity','pct',(m,fund)=>pctOf(f('financialData.returnOnEquity')(m,fund)),above(15,8,'%'),'Profit earned on shareholders\' capital. High debt inflates it.'],
  ['Debt / equity','pct',f('financialData.debtToEquity'),below(50,100,'%'),'Borrowings against shareholders\' capital. Banks and utilities run higher by nature.'],
  ['Current ratio','x',f('financialData.currentRatio'),above(1.5,1),'Short-term assets against short-term debts. Below 1 the company may struggle to pay bills this year.'],
  ['Free cash flow','money',f('financialData.freeCashflow'),{grade:v=>v>0?'good':'bad',rule:'Good positive · Poor negative'},'Cash left after running and investing in the business. Profits without cash are a warning.'],
  ['Analyst consensus','num',f('financialData.recommendationMean'),below(2.5,3.5),'Average analyst rating from 1 (strong buy) to 5 (strong sell), via Yahoo. Analysts lean optimistic.'],
  ['Share of your portfolio','pct',(m,fund,pos)=>pos?.share===undefined||pos.share===null?null:pos.share*100,{grade:(v,pos)=>pos?.limit!==null&&pos?.limit!==undefined?(v<=pos.limit?'good':'bad'):v<=10?'good':v<=25?'warn':'bad',rule:'Your thesis limit if set; otherwise Good ≤ 10% · Watch 10–25% · Poor > 25%'},'How much of your invested money rides on this one stock. Concentration is the risk you control directly.'],
];
export function evaluate(m,fundamentals,position=null){
  return GUIDE.map(([name,kind,read,{grade,rule},what])=>{
    const value=read(m,fundamentals||{},position);
    return value===null||value===undefined||typeof value==='number'&&!Number.isFinite(value)?null:{name,kind,value,tone:grade(value,position),rule,what};
  }).filter(Boolean);
}
