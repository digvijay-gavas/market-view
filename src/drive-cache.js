import {validateSnapshot,numeric} from './model.js';
export const READ_SCOPE='https://www.googleapis.com/auth/drive.readonly';
export const CACHE_SCOPE='https://www.googleapis.com/auth/drive.appdata';
export const CACHE_VERSION=3;
const MAX_BYTES=24*1024*1024,MAX_AGE=30*86400000;
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const fields={holdings:['groww_slug','name','qty','invested','avg_price','ltp','current_value'],credits:['isin','ex_date','shares','amount'],open_lots:['stock_name','isin','quantity','buy_value','buy_date'],stocks:['name','weight','segment','groww_slug','isin']};
function cleanSnapshot(s){
 const out=pick(s,['store_version','schema_version','dataset','partition','captured_at','as_of','content_hash','confirmedAt','fileId']);
 out.meta=pick(s.meta,['id','name','last_rebalance']);out.tables={};
 for(const [name,keys] of Object.entries(fields))if(Array.isArray(s.tables?.[name]))out.tables[name]=s.tables[name].map(row=>pick(row,keys));
 return out;
}
export function makeDriveCache(store,views,now=Date.now()){
 const clean={root:pick(store.root,['id','name','mimeType']),loadedAt:store.loadedAt,warnings:store.warnings.filter(w=>typeof w==='string')};
 for(const name of ['snapshots','dividends','reports','smallcases'])clean[name]=(store[name]||[]).map(cleanSnapshot);
 // Views originate only from buildPortfolio, never auth/session objects.
 return {version:CACHE_VERSION,rootId:store.root.id,savedAt:new Date(now).toISOString(),store:clean,views:[...views]};
}
export function readDriveCache(doc,rootId,now=Date.now()){
 try{
  if(doc?.version!==CACHE_VERSION||doc.rootId!==rootId||doc.store?.root?.id!==rootId||typeof doc.store.root.name!=='string'||!Number.isFinite(Date.parse(doc.savedAt))||Date.parse(doc.savedAt)>now+300000||now-Date.parse(doc.savedAt)>MAX_AGE||!Number.isFinite(Date.parse(doc.store.loadedAt))||Date.parse(doc.store.loadedAt)>Date.parse(doc.savedAt)+300000)return null;
  if(!Array.isArray(doc.store.warnings)||doc.store.warnings.some(w=>typeof w!=='string'))return null;
  for(const [name,dataset] of [['snapshots','groww.live_holdings'],['dividends','groww.dividend_report'],['reports','groww.pnl_report'],['smallcases','smallcase.constituents']]){
   if(!Array.isArray(doc.store[name]))return null;
   for(const s of doc.store[name]){if(typeof s.partition!=='string'||!/^[A-Za-z0-9_-]+$/.test(s.partition))return null;validateSnapshot(s,dataset,s.partition);}
  }
  if(!doc.store.snapshots.length||!Array.isArray(doc.views))return null;
  const accounts=new Set(doc.store.snapshots.map(s=>s.partition));
  for(const pair of doc.views){
   if(!Array.isArray(pair)||pair.length!==2)return null;
   const [selection,p]=pair;const selected=JSON.parse(selection);
   if(selected!==null&&(!Array.isArray(selected)||selected.some(a=>!accounts.has(a))))return null;
   if(!p||!Array.isArray(p.positions)||!Array.isArray(p.accounts)||!Array.isArray(p.dividendAccounts)||p.dividendAccounts.some(a=>typeof a!=='string')||!numeric(p.incomplete)||typeof p.xirrReason!=='string'||!p.bm||typeof p.bm.available!=='boolean'||!Array.isArray(p.bm.pending)||typeof p.bm.historyAvailable!=='boolean')return null;
   if(p.bm.available&&(!numeric(p.bm.matched)||typeof p.bm.name!=='string'||typeof p.bm.capturedAt!=='string'))return null;
   if(!p.bm.available&&typeof p.bm.reason!=='string')return null;
   for(const a of p.accounts){if(typeof a.name!=='string'||!numeric(a.positions))return null;for(const f of ['value','cost'])if(a[f]!==null&&!numeric(a[f]))return null;}
   for(const field of ['value','cost','pnl','returnPct','xirr','cashEquivalent','cashWeight','goldValue','goldWeight','otherHoldingsValue','dividends','top5'])if(p[field]!==null&&!numeric(p[field]))return null;
   for(const r of [...p.positions,...p.bm.pending]){if(typeof r.key!=='string'||typeof r.name!=='string'||!Array.isArray(r.accounts)||r.accounts.some(a=>typeof a!=='string')||!['other','member','removed','missing','unresolved'].includes(r.bmState)||(r.removedSince!=null&&typeof r.removedSince!=='string'))return null;for(const field of ['quantity','cost','value','pnl','weight','returnPct','bmTarget','bmWeight','bmDrift'])if(r[field]!==null&&!numeric(r[field]))return null;}
  }
  return doc;
 }catch{return null;}
}
export function cacheAge(savedAt,now=Date.now()){
 const minutes=Math.max(0,Math.floor((now-Date.parse(savedAt))/60000));
 if(!Number.isFinite(minutes))return 'unknown age';
 return minutes<1?'just now':minutes<60?minutes+' min ago':minutes<1440?Math.floor(minutes/60)+' hr ago':Math.floor(minutes/1440)+' day'+(minutes>=2880?'s':'')+' ago';
}
export class DriveDashboardCache{
 constructor(token,{fetcher=globalThis.fetch.bind(globalThis),signal}={}){this.token=token;this.fetcher=fetcher;this.signal=signal;this.files=new Map();}
 async request(url,options={}){
  this.signal?.throwIfAborted();
  const response=await this.fetcher(url,{...options,method:options.method||'GET',headers:{...options.headers,Authorization:'Bearer '+this.token},signal:this.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
  if(response.status===401)throw Object.assign(new Error('Google access expired.'),{authExpired:true});
  if(!response.ok)throw new Error('Drive dashboard cache unavailable (HTTP '+response.status+').');
  const body=await response.text();if(body.length>MAX_BYTES)throw new Error('Drive cache is too large.');
  return body?JSON.parse(body):null;
 }
 async name(rootId){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rootId));return 'market-view-v'+CACHE_VERSION+'-'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')+'.json';}
 async find(rootId){
  const name=await this.name(rootId);const url=new URL('https://www.googleapis.com/drive/v3/files');
  url.search=new URLSearchParams({spaces:'appDataFolder',q:"trashed = false and name = '"+name+"'",fields:'nextPageToken,files(id,name,modifiedTime,size)',pageSize:'100',orderBy:'modifiedTime desc'});
  const data=await this.request(url);const file=data.files?.find(f=>f.name===name);
  // Updates are restricted to IDs returned from this app's private appDataFolder listing.
  if(file)this.files.set(rootId,file);else this.files.delete(rootId);
  return file;
 }
 async load(rootId){
  const file=await this.find(rootId);if(!file||Number(file.size)>MAX_BYTES)return null;
  const doc=await this.request('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(file.id)+'?alt=media');
  return readDriveCache(doc,rootId);
 }
 async save(rootId,payload){
  if(!readDriveCache(payload,rootId))throw new Error('Invalid dashboard cache.');
  const body=JSON.stringify(payload);if(new TextEncoder().encode(body).length>MAX_BYTES)throw new Error('Dashboard cache exceeds size limit.');
  let file=this.files.get(rootId)||await this.find(rootId);
  if(!file){file=await this.request('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:await this.name(rootId),parents:['appDataFolder'],mimeType:'application/json'})});this.files.set(rootId,file);}
  await this.request('https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(file.id)+'?uploadType=media&fields=id',{method:'PATCH',headers:{'Content-Type':'application/json'},body});
 }
}
