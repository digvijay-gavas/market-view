import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DriveDashboardCache,makeDriveCache,readDriveCache,cacheAge,CACHE_VERSION,CACHE_FILE,reuseSharedCache,RECHECK_MS} from '../src/drive-cache.js';
import {buildPortfolio} from '../src/model.js';
import {MV_FOLDER} from '../src/mv-data.js';
const now=Date.now();
const snapshot={store_version:1,schema_version:1,dataset:'groww.live_holdings',partition:'one',captured_at:'2026-01-01T10:00:00Z',as_of:'2026-01-01',content_hash:'sha256:'+'a'.repeat(64),tables:{holdings:[{groww_slug:'synthetic-alpha',name:'Synthetic Alpha',qty:1,invested:100,current_value:110}]}};
const store={root:{id:'source-root',name:'Synthetic portfolio',mimeType:'application/vnd.google-apps.folder'},snapshots:[snapshot],dividends:[],reports:[],smallcases:[],warnings:[],loadedAt:new Date(now).toISOString(),sourceSignature:'sha256:'+'c'.repeat(64)};
const payload=()=>makeDriveCache(store,new Map([['null',buildPortfolio(store.snapshots)]]),now);
test('Drive cache roundtrip keeps computed values and strips source/session credentials',()=>{
 const input=structuredClone(store);input.accessToken='DO_NOT_SAVE';input.root.secret='DO_NOT_SAVE';input.snapshots[0].meta={accessToken:'DO_NOT_SAVE',id:'one'};
 const doc=makeDriveCache(input,new Map([['null',buildPortfolio(input.snapshots)]]),now);
 assert.ok(!JSON.stringify(doc).includes('DO_NOT_SAVE'));assert.ok(readDriveCache(doc,'source-root',now));
 assert.equal(doc.views[0][1].value,110);assert.equal(doc.views[0][1].pnl,10);
});
test('wrong root, future, expired, invalid-source and old-version caches are ignored',()=>{
 const original=payload();
 for(const mutate of [p=>p.version=CACHE_VERSION-1,p=>p.rootId='other',p=>p.savedAt=new Date(now+3600000).toISOString(),p=>p.savedAt=new Date(now-31*86400000).toISOString(),p=>p.store.snapshots[0].schema_version=99,p=>p.views[0][1].value='invalid',p=>delete p.views[0][1].dividendAccounts,p=>p.views[0][1].positions[0].removedSince={},p=>p.views[0][1].bm.pending=null]){
  const doc=structuredClone(original);mutate(doc);assert.equal(readDriveCache(doc,'source-root',now),null);
 }
 assert.equal(readDriveCache(original,'other',now),null);
});
test('cache timestamp accurately states hours and days instead of claiming a live portfolio',()=>{
 assert.equal(cacheAge(new Date(now).toISOString(),now),'just now');assert.equal(cacheAge(new Date(now-7200000).toISOString(),now),'2 hr ago');assert.equal(cacheAge(new Date(now-2*86400000).toISOString(),now),'2 days ago');
});
function sharedBackend({canAdd=true,canEdit=true,legacy=null}={}){
 // Fake Drive: market-data root ('source-root') → market-view-data folder ('mv') → cache file.
 const calls=[];let saved=null,file=null,folder=null,creates=0;
 return {calls,get creates(){return creates;},fetcher:async(url,options)=>{
  url=new URL(url);calls.push({url,options});
  if(options.method==='POST'){const metadata=JSON.parse(options.body);
   if(metadata.mimeType==='application/vnd.google-apps.folder'){assert.deepEqual(metadata.parents,['source-root']);assert.equal(metadata.name,MV_FOLDER);folder={id:'mv',name:MV_FOLDER,mimeType:metadata.mimeType,parents:['source-root'],capabilities:{canAddChildren:canAdd}};return Response.json({id:'mv'});}
   assert.deepEqual(metadata.parents,['mv']);assert.equal(metadata.name,CACHE_FILE);creates++;file={id:'shared-cache',name:CACHE_FILE,mimeType:'application/json',parents:['mv'],capabilities:{canEdit}};return Response.json({id:file.id});}
  if(options.method==='PATCH'){assert.equal(url.pathname,'/upload/drive/v3/files/shared-cache');saved=JSON.parse(options.body);return Response.json({id:file.id});}
  if(url.searchParams.get('alt')==='media')return Response.json(url.pathname.endsWith('/legacy-cache')?legacy:saved);
  if(url.pathname==='/drive/v3/files/source-root')return Response.json({id:'source-root',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:canAdd}});
  const q=url.searchParams.get('q');assert.equal(url.searchParams.get('spaces'),'drive');assert.equal(url.searchParams.get('supportsAllDrives'),'true');
  if(q.includes("name = '"+MV_FOLDER+"'"))return Response.json({files:folder?[folder]:[]});
  if(q.includes("'mv' in parents"))return Response.json({files:file?[file]:[]});
  assert.ok(q.includes("'source-root' in parents"));return Response.json({files:legacy?[{id:'legacy-cache',name:CACHE_FILE,mimeType:'application/json',parents:['source-root']}]:[]});
 }};
}
test('a cache left in the market-data root by older builds is still read, but new saves go to market-view-data',async()=>{
 const backend=sharedBackend({legacy:payload()});
 assert.equal((await new DriveDashboardCache('viewer',{fetcher:backend.fetcher}).load('source-root')).views[0][1].value,110);
 await new DriveDashboardCache('editor',{fetcher:backend.fetcher,writeEnabled:true}).save('source-root',payload());
 assert.equal(backend.creates,1);assert.ok(!backend.calls.some(c=>c.options.method==='PATCH'&&c.url.pathname.endsWith('legacy-cache')));
});
test('different family accounts read the same cache in the same shared root; viewer never writes',async()=>{
 const backend=sharedBackend(),editor=new DriveDashboardCache('editor-token',{fetcher:backend.fetcher,writeEnabled:true});
 await editor.save('source-root',payload());const before=backend.calls.length;
 const viewer=new DriveDashboardCache('viewer-token',{fetcher:backend.fetcher});
 const cached=await viewer.load('source-root');assert.equal(cached.views[0][1].value,110);
 assert.ok(backend.calls.slice(before).every(c=>c.options.method==='GET'&&c.options.headers.Authorization==='Bearer viewer-token'));
 await assert.rejects(viewer.save('source-root',payload()),e=>e.cacheReadOnly);
 const secondEditor=new DriveDashboardCache('second-editor',{fetcher:backend.fetcher,writeEnabled:true});await secondEditor.save('source-root',payload());
 assert.equal(backend.creates,1,'another account must update the existing shared file');
 assert.ok(backend.calls.every(c=>c.options.credentials==='omit'));
 assert.ok(!JSON.stringify(cached).includes('editor-token'));
});
test('shared-cache writes require explicit consent and folder/file editor capabilities',async()=>{
 const backend=sharedBackend({canAdd:false});
 await assert.rejects(new DriveDashboardCache('editor',{fetcher:backend.fetcher,writeEnabled:true}).save('source-root',payload()),e=>e.cacheReadOnly);
 assert.equal(backend.creates,0);
 const readonly=sharedBackend({canEdit:false});
 await assert.rejects(new DriveDashboardCache('editor',{fetcher:readonly.fetcher,writeEnabled:true}).save('source-root',payload()),e=>e.cacheReadOnly);
 assert.ok(!readonly.calls.some(c=>c.options.method==='PATCH'));
});
test('cache discovery rejects other parents and filenames and makes a stable canonical duplicate choice',async()=>{
 const row=(id,parents=['source-root'],name=CACHE_FILE)=>({id,parents,name,mimeType:'application/json'});
 const files=[row('x',['wrong-root']),row('z'),row('a'),row('b',['source-root'],'holdings.json')];
 const reader=new DriveDashboardCache('viewer',{fetcher:async()=>Response.json({files})});
 assert.equal((await reader.find('source-root')).id,'a');
 await assert.rejects(reader.find("source-root' or trashed=true"),/Invalid/);
});
test('calculations are reused by snapshot identity, not login, cache age or writer identity',()=>{
 const doc=payload(),signature=doc.store.sourceSignature;
 assert.equal(reuseSharedCache(doc,{signature}),true);
 assert.equal(reuseSharedCache(doc,{signature:'sha256:'+'d'.repeat(64)}),false);
 assert.equal(reuseSharedCache(doc,{signature:null}),false);
 const old=structuredClone(doc);old.savedAt=new Date(now-60*86400000).toISOString();old.store.loadedAt=old.savedAt;
 assert.ok(readDriveCache(old,'source-root',now));assert.equal(reuseSharedCache(old,{signature}),true);
});
test('shared cache includes all-accounts calculations without another user selection preferences',()=>{
 const all=buildPortfolio(store.snapshots),views=new Map([['null',all],['["one"]',all]]);
 assert.deepEqual(makeDriveCache(store,views,now).views.map(([key])=>key),['null']);
});
test('cache denial is distinguishable from expired auth and aborted account switches',async()=>{
 await assert.rejects(new DriveDashboardCache('synthetic',{fetcher:async()=>new Response('',{status:401})}).load('source-root'),e=>e.authExpired);
 await assert.rejects(new DriveDashboardCache('synthetic',{fetcher:async()=>new Response('',{status:403})}).load('source-root'),/unavailable/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(new DriveDashboardCache('synthetic',{signal:controller.signal,fetcher:async()=>{throw new Error('must not fetch');}}).load('source-root'),e=>e.name==='AbortError');
});
