import {instrumentIsins} from './instruments.js';
export const isBmPartition=value=>typeof value==='string'&&value.toLowerCase()==='bamimo_0002';
const key=name=>String(name||'').toLowerCase().replace(/-/g,' ').replace(/\b(ltd|limited|india|the|company|co|corp|corpn|industries|enterprises|technologies|services|systems|financial|finance)\b/g,' ').replace(/[^a-z0-9]/g,'');
const number=x=>typeof x==='number'&&Number.isFinite(x);
const matches=(p,s)=>s.groww_slug?p.key===s.groww_slug:s.isin?instrumentIsins[p.key]===s.isin:Boolean(key(s.name)&&(key(p.name)===key(s.name)||key(p.key)===key(s.name)));
const active=s=>s.tables.stocks.filter(r=>number(r.weight)&&r.weight>0);
export function attachBm(positions,snapshots=[]) {
 const captures=snapshots.filter(s=>isBmPartition(s.partition)).sort((a,b)=>b.captured_at.localeCompare(a.captured_at));
 const source=captures[0];
 const unavailable=reason=>({positions:positions.map(p=>({...p,bmState:'other',bmTarget:null,bmWeight:null,bmDrift:null})),bm:{available:false,reason,pending:[],removed:[],historyAvailable:false}});
 if(!source)return unavailable('BM unavailable: no saved BM constituents capture.');
 const stocks=active(source),targetTotal=stocks.reduce((n,s)=>n+s.weight,0);
 if(!targetTotal)return unavailable('BM unavailable: no positive target weights in the saved capture.');
 const resolved=new Map(),used=new Set(),ambiguous=[],pending=[];
 for(const [index,stock] of stocks.entries()){
  const candidates=positions.filter(p=>matches(p,stock));
  if(candidates.length===1&&stocks.filter(s=>matches(candidates[0],s)).length===1&&!used.has(candidates[0].key)){
   resolved.set(candidates[0].key,stock);used.add(candidates[0].key);
  }else{
   const unclear=candidates.length>0;if(unclear)ambiguous.push(stock.name);
   const target=stock.weight/targetTotal*100;
   pending.push({key:'bm-missing-'+index,name:stock.name,accounts:[],quantity:unclear?null:0,cost:null,value:null,pnl:null,returnPct:null,weight:null,bmState:unclear?'unresolved':'missing',placeholder:true,bmTarget:target,bmWeight:unclear?null:0,bmDrift:unclear?null:-target});
  }
 }
 const members=positions.filter(p=>resolved.has(p.key));
 const value=members.every(p=>number(p.value))?members.reduce((n,p)=>n+p.value,0):null;
 const removed=[];
 const rows=positions.map(p=>{
  const stock=resolved.get(p.key),target=stock?stock.weight/targetTotal*100:null;
  const weight=stock&&number(p.value)&&number(value)&&value>0?p.value/value*100:null;
  let state=stock?'member':'other',removedSince=null;
  // A name absent today is not automatically a former BM member. Require history.
  if(!stock&&!stocks.some(s=>matches(p,s))){
   const previous=captures.slice(1).find(s=>active(s).some(r=>matches(p,r)));
   if(previous){state='removed';const absent=captures.filter(s=>s.captured_at>previous.captured_at&&!active(s).some(r=>matches(p,r))).at(-1);removedSince=absent?.as_of||absent?.captured_at||source.as_of;removed.push(p.key);}
  }
  return {...p,bmState:state,bmTarget:target,bmWeight:weight,bmDrift:number(target)&&number(weight)?weight-target:null,removedSince};
 });
 return {positions:rows,bm:{available:true,name:source.meta?.name||'BM Focused Small Cap',capturedAt:source.captured_at,asOf:source.as_of,matched:members.length,missing:pending.map(p=>p.name),ambiguous,pending,removed,historyAvailable:captures.length>1,historySince:captures.at(-1)?.as_of}};
}
export function bmRows(portfolio,filter='all',query=''){
 let rows=portfolio.positions;
 if(filter==='bm')rows=[...rows.filter(r=>r.bmState==='member'),...(portfolio.accounts.length?portfolio.bm.pending||[]:[])];
 else if(filter==='missing')rows=portfolio.accounts.length?(portfolio.bm.pending||[]).filter(r=>r.bmState==='missing'):[];
 else if(filter==='removed')rows=rows.filter(r=>r.bmState==='removed');
 const term=query.trim().toLowerCase();return rows.filter(r=>(r.name+' '+r.key).toLowerCase().includes(term));
}
