import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DriveReader,folderId} from '../src/drive.js';
test('folder links validate destination and ignore arbitrary URLs',()=>{
 assert.equal(folderId('https://drive.google.com/drive/folders/synthetic_123?usp=sharing'),'synthetic_123');
 assert.equal(folderId('synthetic-123'),'synthetic-123');
 assert.throws(()=>folderId('https://example.com/folders/a'));
 assert.throws(()=>folderId("x' or trashed=true"));
});
test('Drive list follows pagination and sends read-only token requests without cookies/cache',async()=>{
 const calls=[];const d=new DriveReader('synthetic-test-token',{fetcher:async(url,options)=>{
  calls.push({url,options});return Response.json(url.searchParams.has('pageToken')?{files:[{id:'two'}]}:{files:[{id:'one'}],nextPageToken:'page2'});
 }});
 const rows=await d.findStores();assert.equal(rows.length,2);assert.equal(calls.length,2);
 for(const c of calls){assert.equal(c.options.method,'GET');assert.equal(c.options.headers.Authorization,'Bearer synthetic-test-token');assert.equal(c.options.credentials,'omit');assert.equal(c.options.cache,'no-store');assert.equal(c.url.searchParams.get('supportsAllDrives'),'true');}
});
test('expired token is an auth failure; private response body never appears in errors',async()=>{
 const d=new DriveReader('synthetic',{fetcher:async()=>new Response('private details',{status:401})});
 await assert.rejects(d.findStores(),e=>e.authExpired&&!e.message.includes('private details'));
});
test('two signed-in reader instances never share tokens or requests',async()=>{
 const headers=[];const fetcher=async(u,o)=>{headers.push(o.headers.Authorization);return Response.json({files:[]});};
 await new DriveReader('synthetic-user-a',{fetcher}).findStores();await new DriveReader('synthetic-user-b',{fetcher}).findStores();
 assert.deepEqual(headers,['Bearer synthetic-user-a','Bearer synthetic-user-b']);
});
test('aborting on sign-out cancels a pending Drive read',async()=>{
 const controller=new AbortController();const d=new DriveReader('synthetic',{signal:controller.signal,fetcher:async(u,o)=>{assert.equal(o.signal,controller.signal);o.signal.throwIfAborted();}});
 controller.abort();await assert.rejects(d.findStores(),e=>e.name==='AbortError');
});
test('incomplete Drive listings fail rather than silently showing partial totals',async()=>{
 const d=new DriveReader('synthetic',{fetcher:async()=>Response.json({files:[],incompleteSearch:true})});
 await assert.rejects(d.findStores(),/incomplete/);
});

// Native browser fetch requires its Window/global receiver. Arrow-function mocks
// did not exercise the production default transport's calling context.
test('default browser fetch keeps its global receiver during Drive folder search',async()=>{
 const originalFetch=globalThis.fetch;
 const requests=[];
 globalThis.fetch=async function(url,options){
  assert.equal(this,globalThis,'native fetch must be called with the global receiver');
  requests.push({url,options});
  return Response.json({files:[{id:'synthetic-folder',name:'market-data'}]});
 };
 try {
  const rows=await new DriveReader('synthetic-default-token').findStores();
  assert.equal(rows[0].id,'synthetic-folder');assert.equal(requests.length,1);
  assert.equal(requests[0].options.headers.Authorization,'Bearer synthetic-default-token');
 } finally {globalThis.fetch=originalFetch;}
});

test('transient browser network failures retry the same read-only request',async()=>{
 let calls=0;
 const d=new DriveReader('synthetic',{fetcher:async()=>{if(++calls===1)throw new TypeError('Failed to fetch');return Response.json({files:[]});}});
 assert.deepEqual(await d.findStores(),[]);assert.equal(calls,2);
});
test('persistent browser failure identifies operation without leaking request URL or credentials',async()=>{
 const d=new DriveReader('synthetic-secret-not-a-real-token',{fetcher:async()=>{throw new TypeError('Failed to fetch');}});
 await assert.rejects(d.get('/files/synthetic-private-id',{alt:'media'}),e=>e.fatal&&e.message.includes('file download')&&!e.message.includes('synthetic-private-id')&&!e.message.includes('synthetic-secret'));
});
