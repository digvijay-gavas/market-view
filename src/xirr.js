import {instrumentIsins} from './instruments.js';
// Open-holdings money-weighted return. Closed trades and dividend income are excluded.
const number=x=>typeof x==='number'&&Number.isFinite(x);
const name=x=>typeof x==='string'?x.trim().replace(/\s+/g,' ').toUpperCase():'';
const day=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const time=Date.parse(value+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time/86400000:null;};
export function xirr(flows){
 if(!Array.isArray(flows)||flows.length<2||flows.some(f=>day(f.date)===null||!number(f.amount)))return null;
 const grouped=new Map();for(const f of flows){const d=day(f.date);grouped.set(d,(grouped.get(d)||0)+f.amount);}
 const rows=[...grouped].filter(([,a])=>a!==0).sort((a,b)=>a[0]-b[0]);
 // Our supported cash-flow shape has purchases followed by one terminal value.
 // Reject other sign patterns rather than silently choosing among multiple roots.
 if(rows.length<2||rows.at(-1)[1]<=0||rows.slice(0,-1).some(([,a])=>a>=0))return null;
 const base=rows[0][0],years=rows.map(([d,a])=>[(d-base)/365,a]);
 const npv=logRate=>years.reduce((sum,[t,a])=>sum+a*Math.exp(-logRate*t),0);
 let low=-30,high=30;if(!(npv(low)>0&&npv(high)<0))return null;
 for(let i=0;i<200;i++){const mid=(low+high)/2;if(npv(mid)>0)low=mid;else high=mid;}
 const result=Math.expm1((low+high)/2);return number(result)?result:null;
}
export function openHoldingsXirr(snapshots,reports=[]){
 const missing=reason=>({rate:null,reason});
 if(!snapshots.length)return missing('No holdings to calculate.');
 const dates=new Set(snapshots.map(s=>s.as_of));if(dates.size!==1||day(snapshots[0].as_of)===null)return missing('Holdings need a common valuation date.');
 const date=snapshots[0].as_of,terminal=day(date),flows=[];let value=0;
 for(const snapshot of snapshots){
  if(!snapshot.tables.holdings.length)continue;
  const report=reports.filter(r=>r.partition===snapshot.partition&&day(r.as_of)!==null&&day(r.as_of)<=terminal).sort((a,b)=>b.as_of.localeCompare(a.as_of)||b.captured_at.localeCompare(a.captured_at))[0];
  if(!report)return missing('Dated P&L lots missing for '+snapshot.partition+'.');
  const used=new Set();
  for(const holding of snapshot.tables.holdings){
   if(holding.qty===0&&holding.invested===0&&(holding.current_value===0||holding.ltp!=null))continue;
   const isin=instrumentIsins[holding.groww_slug];
   const lots=report.tables.open_lots.filter(l=>isin?l.isin===isin:name(l.stock_name)===name(holding.name));
   const ids=new Set(lots.map(l=>l.isin));
   if(!lots.length||ids.size!==1||used.has([...ids][0]))return missing('Purchase lots cannot be matched exactly for '+holding.name+'.');
   used.add([...ids][0]);
   if(!number(holding.qty)||!number(holding.invested)||lots.some(l=>!number(l.quantity)||l.quantity<=0||!number(l.buy_value)||l.buy_value<0||day(l.buy_date)===null||day(l.buy_date)>terminal))return missing('Complete dated purchase lots required for '+holding.name+'.');
   const quantity=lots.reduce((sum,l)=>sum+l.quantity,0),cost=lots.reduce((sum,l)=>sum+l.buy_value,0);
   if(Math.abs(quantity-holding.qty)>1e-6||Math.abs(cost-holding.invested)>Math.max(1,0.05*lots.length))return missing('P&L lots do not match current quantity/cost for '+holding.name+'.');
   const current=number(holding.current_value)?holding.current_value:number(holding.ltp)?holding.qty*holding.ltp:null;
   if(!number(current))return missing('Captured value missing for '+holding.name+'.');
   value+=current;for(const lot of lots)flows.push({date:lot.buy_date,amount:-lot.buy_value});
  }
 }
 flows.push({date,amount:value});const rate=xirr(flows);
 return {rate,reason:rate===null?'No supported annualised return for these cash flows.':'Annualised from dated purchases to saved value; excludes sold holdings and dividends.'};
}
