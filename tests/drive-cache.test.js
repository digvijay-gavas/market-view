import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DriveDashboardCache,makeDriveCache,readDriveCache,cacheAge,CACHE_VERSION} from '../src/drive-cache.js';
import {buildPortfolio} from '../src/model.js';
const now=Date.now();
const snapshot={store_version:1,schema_version:1,dataset:'groww.live_holdings',partition:'one',captured_at:'2026-01-01T10:00:00Z',as_of:'2026-01-01',content_hash:'sha256:'+'a'.repeat(64),tables:{holdings:[{groww_slug:'synthetic-alpha',name:'Synthetic Alpha',qty:1,invested:100,current_value:110}]}};
const store={root:{id:'source-root',name:'Synthetic portfolio',mimeType:'application/vnd.google-apps.folder'},snapshots:[snapshot],dividends:[],reports:[],smallcases:[],warnings:[],loadedAt:new Date(now).toISOString()};
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
test('Drive caching writes only appDataFolder files discovered by its own listing',async()=>{
 const calls=[];let saved=null,file=null;
 const fetcher=async(url,options)=>{
  url=new URL(url);calls.push({url,options});
  if(options.method==='POST'){const metadata=JSON.parse(options.body);assert.deepEqual(metadata.parents,['appDataFolder']);file={id:'own-cache',name:metadata.name};return Response.json({id:file.id});}
  if(options.method==='PATCH'){assert.equal(url.pathname,'/upload/drive/v3/files/own-cache');saved=JSON.parse(options.body);return Response.json({id:file.id});}
  if(url.searchParams.get('alt')==='media')return Response.json(saved);
  assert.equal(url.searchParams.get('spaces'),'appDataFolder');return Response.json({files:file?[file]:[]});
 };
 const cache=new DriveDashboardCache('synthetic-token',{fetcher});assert.equal(await cache.load('source-root'),null);
 await cache.save('source-root',payload());assert.equal((await cache.load('source-root')).views[0][1].value,110);
 assert.ok(calls.every(c=>c.options.credentials==='omit'&&c.options.headers.Authorization==='Bearer synthetic-token'));
 assert.ok(!JSON.stringify(saved).includes('synthetic-token'));
 // Different user cache clients have no shared file IDs, token or payload.
 const other=new DriveDashboardCache('other-token',{fetcher:async(url,o)=>{assert.equal(o.headers.Authorization,'Bearer other-token');return Response.json({files:[]});}});
 assert.equal(await other.load('source-root'),null);
});
test('cache denial is distinguishable from expired auth and aborted account switches',async()=>{
 await assert.rejects(new DriveDashboardCache('synthetic',{fetcher:async()=>new Response('',{status:401})}).load('source-root'),e=>e.authExpired);
 await assert.rejects(new DriveDashboardCache('synthetic',{fetcher:async()=>new Response('',{status:403})}).load('source-root'),/unavailable/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(new DriveDashboardCache('synthetic',{signal:controller.signal,fetcher:async()=>{throw new Error('must not fetch');}}).load('source-root'),e=>e.name==='AbortError');
});
