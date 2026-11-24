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
// Holdings whose purchase lots cannot be matched exactly are left out (and listed) instead of
// blanking the whole figure. Below MIN_COVERAGE of cost the result is withheld as unrepresentative.
export const MIN_COVERAGE=0.5;
// Groww rounds per-lot buy values, so lot totals drift a few rupees from the holding's invested
// amount (seen: up to ₹3.87 over 23 lots). Allow ₹5 or 0.1% of cost; real differences
// (corporate actions, missed trades) are far larger.
export const costTolerance=invested=>Math.max(5,Math.abs(invested)*0.001);
export function openHoldingsXirr(snapshots,reports=[]){
 const excluded=[],adjusted=[],missing=reason=>({rate:null,reason,excluded,adjusted,coverage:null});
 if(!snapshots.length)return missing('No holdings to calculate.');
 const dates=new Set(snapshots.map(s=>s.as_of));if(dates.size!==1||day(snapshots[0].as_of)===null)return missing('Holdings need a common valuation date.');
 const date=snapshots[0].as_of,terminal=day(date),flows=[];let value=0,included=0,total=0,costIncluded=0,costTotal=0;
 for(const snapshot of snapshots){
  const report=reports.filter(r=>r.partition===snapshot.partition&&day(r.as_of)!==null&&day(r.as_of)<=terminal).sort((a,b)=>b.as_of.localeCompare(a.as_of)||b.captured_at.localeCompare(a.captured_at))[0];
  const used=new Set();
  for(const holding of snapshot.tables.holdings){
   if(holding.qty===0&&holding.invested===0&&(holding.current_value===0||holding.ltp!=null))continue;
   total++;if(number(holding.invested))costTotal+=holding.invested;
   const skip=reason=>excluded.push({account:snapshot.partition,name:holding.name,reason});
   if(!report){skip('no dated P&L report for this account');continue;}
   const isin=instrumentIsins[holding.groww_slug];
   const lots=report.tables.open_lots.filter(l=>isin?l.isin===isin:name(l.stock_name)===name(holding.name));
   const ids=new Set(lots.map(l=>l.isin));
   if(!lots.length||ids.size!==1||used.has([...ids][0])){skip('purchase lots not found in the P&L report');continue;}
   used.add([...ids][0]);
   if(!number(holding.qty)||!number(holding.invested)||lots.some(l=>!number(l.quantity)||l.quantity<=0||!number(l.buy_value)||l.buy_value<0||day(l.buy_date)===null||day(l.buy_date)>terminal)){skip('purchase lots are incomplete or undated');continue;}
   const quantity=lots.reduce((sum,l)=>sum+l.quantity,0),cost=lots.reduce((sum,l)=>sum+l.buy_value,0);
   if(Math.abs(quantity-holding.qty)>1e-6){skip(`P&L lots (${quantity} shares) differ from current holding (${holding.qty} shares); the report is likely older than a recent buy or sell`);continue;}
   // Same shares, different cost: shares credited into Groww (grey-market/off-market transfers, allotments)
   // carry the cost the owner entered on the holding, while the P&L report shows a market price for that
   // day. The holding's invested amount is the true cost: keep the lot dates, scale the amounts to it.
   const scale=Math.abs(cost-holding.invested)>costTolerance(holding.invested)&&cost>0&&holding.invested>0?holding.invested/cost:1;
   if(scale!==1)adjusted.push({account:snapshot.partition,name:holding.name,lotCost:cost,invested:holding.invested});
   const current=number(holding.current_value)?holding.current_value:number(holding.ltp)?holding.qty*holding.ltp:null;
   if(!number(current)){skip('current value missing');continue;}
   value+=current;included++;costIncluded+=holding.invested;for(const lot of lots)flows.push({date:lot.buy_date,amount:-lot.buy_value*scale});
  }
 }
 const coverage={included,total,costShare:costTotal>0?costIncluded/costTotal:0};
 if(!included)return {...missing(excluded.length?'No holding has purchase lots matching its current quantity and cost.':'No holdings to calculate.'),coverage};
 if(coverage.costShare<MIN_COVERAGE)return {...missing(`Only ${Math.round(coverage.costShare*100)}% of cost has matching purchase lots; refresh the P&L reports.`),coverage};
 flows.push({date,amount:value});const rate=xirr(flows);
 const basis='Annualised from dated purchases to saved value; excludes sold holdings and dividends.';
 return {rate,excluded,adjusted,coverage,reason:rate===null?'No supported annualised return for these cash flows.':excluded.length?`${basis} Covers ${included} of ${total} holdings (${Math.round(coverage.costShare*100)}% of cost).`:basis};
}
