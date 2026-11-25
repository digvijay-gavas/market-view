// A position reconciliation is independent of quote observations. Never invent trades.
export const PROGRESSIVE_DATASETS=['portfolio.positions','market.prices'];
const num=x=>typeof x==='number'&&Number.isFinite(x);
const timestamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&/(Z|[+-]\d{2}:\d{2})$/.test(x);
export function validateProgressive(doc){
 if(doc.dataset==='portfolio.positions'){
  if(!Array.isArray(doc.tables.positions))throw new Error('Missing positions table');
  const seen=new Set();for(const r of doc.tables.positions){
   if(typeof r.groww_slug!=='string'||!r.groww_slug||seen.has(r.groww_slug)||typeof r.name!=='string')throw new Error('Invalid or duplicate position');seen.add(r.groww_slug);
   for(const f of ['qty','invested','avg_price','reference_price','reference_value'])if(r[f]!=null&&(!num(r[f])||r[f]<0))throw new Error('Invalid position amount');
   if(!num(r.qty)||r.invested===undefined)throw new Error('Missing position basis');
  }
 }else if(doc.dataset==='market.prices'){
  if(!Array.isArray(doc.tables.quotes))throw new Error('Missing quotes table');
  const seen=new Set();for(const r of doc.tables.quotes){
   if(typeof r.groww_slug!=='string'||!r.groww_slug||seen.has(r.groww_slug)||!num(r.ltp)||r.ltp<=0||!timestamp(r.fetched_at)||typeof r.source!=='string')throw new Error('Invalid quote');seen.add(r.groww_slug);
   if(r.quoted_at!=null&&!timestamp(r.quoted_at))throw new Error('Invalid quote time');
  }
 }else throw new Error('Unsupported progressive dataset');
 return doc;
}
export function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
export async function hashJSON(value){const data=new TextEncoder().encode(JSON.stringify(canonical(value))),digest=await crypto.subtle.digest('SHA-256',data);return 'sha256:'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');}
export function positionRows(holdingSnapshot){return holdingSnapshot.tables.holdings.map(r=>({groww_slug:r.groww_slug,name:r.name,qty:r.qty,invested:r.invested,avg_price:r.avg_price??null,reference_price:r.ltp??null,reference_value:r.current_value??null}));}
export function positionChanges(before,after){
 const a=new Map((before?.tables.positions||[]).map(r=>[r.groww_slug,r])),b=new Map(after.tables.positions.map(r=>[r.groww_slug,r]));
 const rows=[];for(const slug of new Set([...a.keys(),...b.keys()])){
  const old=a.get(slug),next=b.get(slug),qty=(next?.qty??0)-(old?.qty??0);
  const cost=(!next||num(next.invested))&&(!old||num(old.invested))?(next?.invested??0)-(old?.invested??0):null;
  if(qty||old?.invested!==next?.invested)rows.push({groww_slug:slug,name:next?.name||old.name,quantity_delta:qty,cost_delta:cost,previous_captured_at:before?.captured_at??null,captured_at:after.captured_at,classification:before?'position_change':'initial_baseline'});
 }
 return rows; // Quantity changes can include transfers, splits or corrections, not just buys/sells.
}
export async function materializePositions(legacy=[],positions=[],priceSnapshots=[],now=Date.now()){
 const accounts=new Map(legacy.map(s=>[s.partition,{snapshot:s,rows:positionRows(s),progressive:false}]));
 for(const s of positions){const old=accounts.get(s.partition);if(!old||s.captured_at>=old.snapshot.captured_at)accounts.set(s.partition,{snapshot:s,rows:s.tables.positions,progressive:true});}
 const quotes=new Map();for(const s of priceSnapshots)for(const q of s.tables.quotes){const old=quotes.get(q.groww_slug);if(!old||q.fetched_at>old.fetched_at)quotes.set(q.groww_slug,q);}
 const out=[],sources=[],warnings=[];
 for(const [account,entry] of accounts){
  if(!entry.progressive&&!quotes.size){out.push(entry.snapshot);continue;}
  const dates=new Set(),times=[],quoteTimes=[];let fallback=0,stale=0;
  const rows=entry.rows.map(r=>{
   const quote=quotes.get(r.groww_slug),use=quote&&quote.fetched_at>=entry.snapshot.captured_at&&Date.parse(quote.fetched_at)<=now+300000;
   const time=use?quote.fetched_at:entry.snapshot.captured_at;
   const ltp=use?quote.ltp:r.reference_price;
   dates.add(time.slice(0,10));times.push(time);if(use){quoteTimes.push(time);if(now-Date.parse(time)>20*60000)stale++;}else fallback++;
   const value=num(ltp)&&num(r.qty)?ltp*r.qty:r.reference_value??null;
   // Exchange symbol (for live prices): from the position capture, else from the newest saved quote.
   const exchange=r.symbol?r.exchange:quote?.symbol?quote.exchange:null,symbol=r.symbol||quote?.symbol||null;
   return {groww_slug:r.groww_slug,name:r.name,qty:r.qty,invested:r.invested,avg_price:r.avg_price??null,ltp:ltp??null,current_value:value,...(symbol&&['NSE','BSE'].includes(exchange)?{exchange,symbol:String(symbol)}:{})};
  });
  const captured=[entry.snapshot.captured_at,...times].sort().at(-1);
  const doc={...entry.snapshot,dataset:'groww.live_holdings',source:'groww',method:'api',captured_at:captured,as_of:dates.size===1?[...dates][0]:rows.length?null:entry.snapshot.as_of,meta:{progressive:true,positions_captured_at:entry.snapshot.captured_at},tables:{holdings:rows}};
  doc.content_hash=await hashJSON(Object.fromEntries(['dataset','schema_version','partition','as_of','meta','tables'].map(k=>[k,doc[k]])));doc.confirmedAt=captured;out.push(doc);
  sources.push({account,positionsAt:entry.snapshot.captured_at,pricesFrom:quoteTimes.length?quoteTimes.sort()[0]:null,pricesTo:quoteTimes.at(-1)||null,fallback,stale});
  if(fallback)warnings.push(`${account}: ${fallback} position(s) use their reconciliation price; no newer quote available.`);
  if(stale)warnings.push(`${account}: ${stale} price observation(s) are over 20 minutes old.`);
  if(now-Date.parse(entry.snapshot.captured_at)>36*3600000)warnings.push(`${account}: position quantities were last reconciled over 36 hours ago; new activity may be missing.`);
 }
 return {snapshots:out,sources,warnings};
}
