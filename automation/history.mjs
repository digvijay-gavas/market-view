// Portfolio history for the overview chart: per trading day, each account's holdings (from its
// latest capture on or before that day) valued at that day's closing price, plus open-holdings
// XIRR from the purchase lots bought by then. Written by the collector to
// market-view-data/_market-view-history.json; the viewer only reads it.
import {openHoldingsXirr} from '../src/xirr.js';
export const HISTORY_FILE='_market-view-history.json';
const num=x=>typeof x==='number'&&Number.isFinite(x);
export const istDate=iso=>new Date(Date.parse(iso)+330*60000).toISOString().slice(0,10);

// captures: [{account, at, rows:[{groww_slug,name,qty,invested,price}]}]
// closes: Map(slug -> Map(date -> close)); reports: P&L lot reports (pnl.lots as report docs).
export function buildHistory({captures,closes,reports=[],to=new Date().toISOString().slice(0,10)}){
 const byAccount=new Map();
 for(const c of captures){if(!c.rows?.length)continue;const list=byAccount.get(c.account)||[];list.push({...c,date:istDate(c.at)});byAccount.set(c.account,list);}
 for(const list of byAccount.values())list.sort((a,b)=>a.at.localeCompare(b.at));
 const first=[...byAccount.values()].map(l=>l[0].date).sort()[0];if(!first)return {version:1,points:[]};
 // Trading days: any day with a close for any stock, from the first capture to `to`.
 const days=new Set();for(const series of closes.values())for(const d of series.keys())if(d>=first&&d<=to)days.add(d);
 const sortedCloses=new Map([...closes].map(([slug,m])=>[slug,[...m].sort((a,b)=>a[0].localeCompare(b[0]))]));
 const closeOn=(slug,d)=>{const s=sortedCloses.get(slug);if(!s)return null;let v=null;for(const [day,c]of s){if(day>d)break;v=c;}return v;};
 const points=[];
 for(const d of [...days].sort()){
  const accounts={},snapshots=[];
  for(const [account,list] of byAccount){
   const capture=[...list].reverse().find(c=>c.date<=d);if(!capture)continue;
   let invested=0,value=0,priced=0,fallback=0;const holdings=[];
   for(const r of capture.rows){
    if(!num(r.qty)||r.qty<=0)continue;const close=closeOn(r.groww_slug,d),price=num(close)?close:r.price;
    if(num(close))priced++;else fallback++;
    if(num(r.invested))invested+=r.invested;if(num(price))value+=price*r.qty;
    holdings.push({groww_slug:r.groww_slug,name:r.name,qty:r.qty,invested:r.invested,ltp:num(price)?price:null,current_value:num(price)?price*r.qty:null});
   }
   accounts[account]={invested:Math.round(invested*100)/100,value:Math.round(value*100)/100,priced,fallback,capturedAt:capture.at};
   snapshots.push({partition:account,as_of:d,tables:{holdings}});
  }
  // Lots bought after `d` did not exist yet; holdings sold since then have no lots and drop out
  // (reported as coverage, and withheld below the usual minimum).
  const dated=reports.map(r=>({...r,as_of:d,tables:{open_lots:(r.tables?.open_lots||[]).filter(l=>typeof l.buy_date==='string'&&l.buy_date<=d)}}));
  const rate=s=>{const x=openHoldingsXirr(s,dated);return num(x.rate)?{rate:Math.round(x.rate*1e6)/1e6,coverage:Math.round((x.coverage?.costShare||0)*1000)/1000}:null;};
  const xirr={all:rate(snapshots)};for(const s of snapshots)xirr[s.partition]=rate([s]);
  points.push({date:d,accounts,xirr});
 }
 return {version:1,points};
}

// Yahoo daily closes keyed by IST date.
export async function yahooCloses(m,{from,fetcher=fetch}={}){
 const ticker=m.symbol+(m.exchange==='BSE'?'.BO':'.NS'),period1=Math.floor(Date.parse(from+'T00:00:00Z')/1000)-7*86400,period2=Math.floor(Date.now()/1000)+86400;
 const response=await fetcher('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(ticker)+'?interval=1d&period1='+period1+'&period2='+period2,{headers:{Accept:'application/json','User-Agent':'MarketViewCollector/1.0'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('HISTORY_HTTP_'+response.status);
 const r=(await response.json())?.chart?.result?.[0],ts=r?.timestamp||[],close=r?.indicators?.quote?.[0]?.close||[];
 const out=new Map();ts.forEach((t,i)=>{if(num(close[i])&&close[i]>0)out.set(istDate(new Date(t*1000).toISOString()),Math.round(close[i]*100)/100);});
 return out;
}

// Gathers every recorded capture (the Market app's holdings captures are only read, never
// written) and market-view's position captures, resolves exchange symbols, fetches daily
// closes and writes the history file into market-view-data.
export async function compileHistory(publisher,{instruments={},fetcher=fetch,delay=ms=>new Promise(r=>setTimeout(r,ms)),lookup,now=new Date()}={}){
 const {validateSnapshot,SNAPSHOT}=await import('../src/model.js');
 const store=await publisher.marketViewData(),FOLDER='application/vnd.google-apps.folder';
 const captures=[];
 const scan=async(rootId,dataset,read)=>{
  const top=(await publisher.children([rootId])).filter(f=>f.name===dataset&&f.mimeType===FOLDER);if(!top.length)return;
  for(const part of (await publisher.children(top.map(f=>f.id))).filter(f=>f.mimeType===FOLDER)){
   for(const file of (await publisher.children([part.id])).filter(f=>SNAPSHOT.test(f.name))){
    try{const doc=await publisher.readJSON(file);const rows=read(doc,part.name);if(rows)captures.push({account:part.name,at:doc.captured_at,rows});}catch(error){if(error.authExpired)throw error;}
   }
  }
 };
 await scan(publisher.rootId,'groww.live_holdings',(doc,p)=>validateSnapshot(doc,'groww.live_holdings',p).tables.holdings.map(r=>({groww_slug:r.groww_slug,name:r.name,qty:r.qty,invested:r.invested,price:r.ltp??null})));
 await scan(store.rootId,'portfolio.positions',doc=>doc?.dataset==='portfolio.positions'&&typeof doc.captured_at==='string'&&Array.isArray(doc.tables?.positions)?doc.tables.positions.map(r=>({groww_slug:r.groww_slug,name:r.name,qty:r.qty,invested:r.invested,price:r.reference_price??null,exchange:r.exchange,symbol:r.symbol})):null);
 const loaded=await publisher.load(publisher.rootId);
 const symbols={...instruments};
 for(const s of loaded.snapshots)for(const r of s.tables.holdings)if(r.symbol&&!symbols[r.groww_slug])symbols[r.groww_slug]={symbol:r.symbol,exchange:r.exchange};
 for(const c of captures)for(const r of c.rows)if(r.symbol&&!symbols[r.groww_slug])symbols[r.groww_slug]={symbol:r.symbol,exchange:r.exchange};
 const slugs=[...new Set(captures.flatMap(c=>c.rows.filter(r=>num(r.qty)&&r.qty>0).map(r=>r.groww_slug)))];
 const from=captures.map(c=>istDate(c.at)).sort()[0];
 const closes=new Map(),missing=[];
 for(const slug of slugs){
  if(!symbols[slug]&&lookup)try{const m=await lookup(slug);if(m)symbols[slug]=m;}catch{}
  const m=symbols[slug];if(!m){missing.push(slug);continue;}
  try{closes.set(slug,await yahooCloses(m,{from,fetcher}));}catch{missing.push(slug);}
  await delay(250);
 }
 const history=buildHistory({captures,closes,reports:loaded.reports||[],to:istDate(now.toISOString())});
 const doc={...history,generatedAt:now.toISOString(),from,captures:captures.length,stocks:slugs.length,unpriced:missing};
 await store.jsonFile(HISTORY_FILE,store.rootId,doc);
 return {points:history.points.length,captures:captures.length,stocks:slugs.length,unpriced:missing.length,instruments:symbols};
}
