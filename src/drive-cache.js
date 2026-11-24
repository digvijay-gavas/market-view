import {validateSnapshot,numeric} from './model.js';
export const READ_SCOPE='https://www.googleapis.com/auth/drive.readonly';
// Shared-folder updates require an editor's explicit opt-in to Drive write scope.
export const CACHE_SCOPE='https://www.googleapis.com/auth/drive';
export const CACHE_FILE='_market-view-dashboard-cache.json';
export const RECHECK_MS=4*3600000;
export const CACHE_VERSION=8;
const MAX_BYTES=24*1024*1024;
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const fields={holdings:['groww_slug','name','qty','invested','avg_price','ltp','current_value'],credits:['isin','ex_date','shares','amount'],open_lots:['stock_name','isin','quantity','buy_value','buy_date'],stocks:['name','weight','segment','groww_slug','isin']};
function cleanSnapshot(s){
 const out=pick(s,['store_version','schema_version','dataset','partition','captured_at','as_of','content_hash','confirmedAt','fileId']);
 out.meta=pick(s.meta,['id','name','last_rebalance','progressive','positions_captured_at']);out.tables={};
 for(const [name,keys] of Object.entries(fields))if(Array.isArray(s.tables?.[name]))out.tables[name]=s.tables[name].map(row=>pick(row,keys));
 return out;
}
export function makeDriveCache(store,views,now=Date.now()){
 const clean={root:pick(store.root,['id','name','mimeType']),loadedAt:store.loadedAt,sourceSignature:store.sourceSignature,warnings:store.warnings.filter(w=>typeof w==='string')};
 if(store.progressiveSources)clean.progressiveSources=store.progressiveSources.map(s=>pick(s,['account','positionsAt','pricesFrom','pricesTo','fallback','stale']));
 for(const name of ['snapshots','dividends','reports','smallcases'])clean[name]=(store[name]||[]).map(cleanSnapshot);
 // Views originate only from buildPortfolio, never auth/session objects.
 return {version:CACHE_VERSION,rootId:store.root.id,savedAt:new Date(now).toISOString(),store:clean,views:[...views].filter(([selection])=>selection==='null')};
}
export function readDriveCache(doc,rootId,now=Date.now()){
 try{
  if(doc?.version!==CACHE_VERSION||doc.rootId!==rootId||doc.store?.root?.id!==rootId||typeof doc.store.root.name!=='string'||!Number.isFinite(Date.parse(doc.savedAt))||Date.parse(doc.savedAt)>now+300000||!Number.isFinite(Date.parse(doc.store.loadedAt))||Date.parse(doc.store.loadedAt)>Date.parse(doc.savedAt)+300000)return null;
  if(typeof doc.store.sourceSignature!=='string'||!/^sha256:[0-9a-f]{64}$/.test(doc.store.sourceSignature))return null;
  if(doc.store.progressiveSources&&(!Array.isArray(doc.store.progressiveSources)||doc.store.progressiveSources.some(s=>typeof s.account!=='string'||typeof s.positionsAt!=='string'||!numeric(s.fallback)||!numeric(s.stale))))return null;
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
 constructor(token,{fetcher=globalThis.fetch.bind(globalThis),signal,writeEnabled=false}={}){this.token=token;this.fetcher=fetcher;this.signal=signal;this.writeEnabled=writeEnabled;this.files=new Map();}
 async request(url,options={}){
  this.signal?.throwIfAborted();
  const response=await this.fetcher(url,{...options,method:options.method||'GET',headers:{...options.headers,Authorization:'Bearer '+this.token},signal:this.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
  if(response.status===401)throw Object.assign(new Error('Google access expired.'),{authExpired:true});
  if(!response.ok)throw new Error('Drive dashboard cache unavailable (HTTP '+response.status+').');
  const body=await response.text();if(body.length>MAX_BYTES)throw new Error('Drive cache is too large.');
  return body?JSON.parse(body):null;
 }
 async find(rootId){
  if(typeof rootId!=='string'||!/^[A-Za-z0-9_-]+$/.test(rootId))throw new Error('Invalid cache source folder.');
  const files=[];let pageToken;
  do{
   const url=new URL('https://www.googleapis.com/drive/v3/files');
   url.search=new URLSearchParams({spaces:'drive',q:"trashed = false and '"+rootId+"' in parents and name = '"+CACHE_FILE+"'",fields:'nextPageToken,files(id,name,mimeType,parents,modifiedTime,size,capabilities(canEdit))',pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(pageToken?{pageToken}:{})});
   const data=await this.request(url);files.push(...(data.files||[]));pageToken=data.nextPageToken;
  }while(pageToken);
  // Stable canonical choice if two initial writers happened to create duplicates.
  const file=files.filter(f=>f.name===CACHE_FILE&&f.mimeType==='application/json'&&f.parents?.includes(rootId)).sort((a,b)=>a.id.localeCompare(b.id))[0];
  if(file)this.files.set(rootId,file);else this.files.delete(rootId);return file;
 }
 async load(rootId){
  const file=await this.find(rootId);if(!file||Number(file.size)>MAX_BYTES)return null;
  const doc=await this.request('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(file.id)+'?alt=media&supportsAllDrives=true');
  return readDriveCache(doc,rootId);
 }
 async save(rootId,payload){
  if(!this.writeEnabled)throw Object.assign(new Error('Shared cache updates are not enabled for this login.'),{cacheReadOnly:true});
  if(!readDriveCache(payload,rootId))throw new Error('Invalid dashboard cache.');
  const body=JSON.stringify(payload);if(new TextEncoder().encode(body).length>MAX_BYTES)throw new Error('Dashboard cache exceeds size limit.');
  let file=await this.find(rootId);
  if(file){const existing=readDriveCache(await this.request('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(file.id)+'?alt=media&supportsAllDrives=true'),rootId);if(existing?.store.sourceSignature===payload.store.sourceSignature)return {unchanged:true};}
  if(!file){
   const root=await this.request('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(rootId)+'?fields=id,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true');
   if(root.id!==rootId||root.mimeType!=='application/vnd.google-apps.folder'||root.trashed||root.capabilities?.canAddChildren!==true)throw Object.assign(new Error('A folder editor must create the shared cache.'),{cacheReadOnly:true});
   const created=await this.request('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:CACHE_FILE,parents:[rootId],mimeType:'application/json'})});
   file=await this.find(rootId);if(!file||!created.id)throw new Error('Could not locate the shared cache after creation.');
  }
  if(file.capabilities?.canEdit!==true)throw Object.assign(new Error('Only cache editors can update the shared file.'),{cacheReadOnly:true});
  await this.request('https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(file.id)+'?uploadType=media&fields=id&supportsAllDrives=true',{method:'PATCH',headers:{'Content-Type':'application/json'},body});
 }
}
export function reuseSharedCache(doc,{signature}={}){
 return Boolean(doc&&typeof signature==='string'&&doc.store.sourceSignature===signature);
}
