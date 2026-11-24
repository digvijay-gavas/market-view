import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {marketOpen,duePlan,nextDelay} from '../automation/schedule.mjs';
import {seal,unseal,portableSeal,portableOpen,Vault,outsideRepo,REPO} from '../automation/vault.mjs';
import {filterState,waitReady} from '../automation/browser.mjs';
import {fetchQuotes,universe} from '../automation/prices.mjs';
import {runCycle} from '../automation/worker.mjs';
import {Publisher} from '../automation/drive.mjs';
const calendar=JSON.parse(await readFile(new URL('../automation/calendar.json',import.meta.url)));
const schedule={open:'09:15',close:'15:30',intervalSeconds:600,jitterSeconds:60};
test('IST window, published holiday, weekends, unknown year and explicit special session',()=>{
 for(const time of ['2026-11-23T03:44:00Z','2026-11-23T10:00:00Z','2026-11-24T04:00:00Z','2026-11-22T04:00:00Z'])assert.equal(marketOpen(new Date(time),calendar,schedule).open,false);
 assert.equal(marketOpen(new Date('2026-11-23T03:45:00Z'),calendar,schedule).open,true);
 assert.equal(marketOpen(new Date('2027-01-04T04:00:00Z'),calendar,schedule).reason,'CALENDAR_REQUIRED');
 assert.equal(marketOpen(new Date('2026-11-22T04:00:00Z'),{...calendar,specialSessions:{'2026-11-22':['09:15','10:00']}},schedule).open,true);
 assert.equal(nextDelay(schedule,lo=>lo),540000);assert.equal(nextDelay(schedule,(lo,hi)=>hi-1),660000);assert.throws(()=>nextDelay({...schedule,jitterSeconds:999}));
 const config={enabled:true,schedule,accounts:[{id:'a'}]};assert.equal(duePlan(config,{nextRunAt:'2026-11-23T05:00:00Z'},calendar,new Date('2026-11-23T04:00:00Z')).reason,'NOT_DUE');
});
test('vault authenticates ciphertext, portable bundle needs strong passphrase, native key stays separate',async()=>{
 assert.throws(()=>outsideRepo(join(REPO,'..private')));assert.throws(()=>outsideRepo(REPO));
 const key=randomBytes(32),value={accounts:{a:{pin:'1234'}}},doc=seal(value,key);assert.deepEqual(unseal(doc,key),value);assert.ok(!JSON.stringify(doc).includes('1234'));assert.throws(()=>unseal(doc,randomBytes(32)));
 const bundle=portableSeal(value,'synthetic strong passphrase');assert.deepEqual(portableOpen(bundle,'synthetic strong passphrase'),value);assert.throws(()=>portableOpen(bundle,'incorrect password'));assert.throws(()=>portableSeal(value,'1234'));
 const home=await mkdtemp(join(tmpdir(),'market-view-vault-test-'));let saved;
 try{const credentials=async(op,target,v)=>op==='set'?(saved=v):saved;const v=await new Vault(home,{credentials}).open(true);v.data=value;await v.save();assert.deepEqual((await new Vault(home,{credentials}).open()).data,value);assert.ok(!(await readFile(join(home,'secrets.enc.json'),'utf8')).includes('1234'));}finally{await rm(home,{recursive:true,force:true});}
});
test('portable browser state excludes Google and lookalike origins',()=>{
 const state=filterState({cookies:[{domain:'.groww.in'},{domain:'.google.com'},{domain:'evilgroww.in'}],origins:[{origin:'https://groww.in'},{origin:'https://accounts.google.com'},{origin:'http://groww.in'}]});assert.equal(state.cookies.length,1);assert.equal(state.origins.length,1);
});
test('login, challenge and partial loading never become empty holdings',async()=>{
 for(const p of [{signedOut:true,empty:true},{challenge:true,empty:true},{pin:true}])await assert.rejects(waitReady({evaluate:async()=>p},{delay:async()=>{}}),e=>['AUTH_REQUIRED','PIN_REQUIRED'].includes(e.code));
 let n=0;assert.equal(await waitReady({evaluate:async()=>{n++;return {empty:true};}},{delay:async()=>{}}),'empty');assert.equal(n,3);
});
test('shared universe deduplicates accounts; partial quote fetch retains old timestamps and stops on 429',async()=>{
 const rows=[{groww_slug:'one',qty:2},{groww_slug:'two',qty:3}];assert.equal(universe([{tables:{positions:rows}},{tables:{positions:rows}}]).length,2);
 let calls=0;const old={groww_slug:'two',ltp:42,fetched_at:'2026-11-22T04:00:00Z',source:'test'};
 const result=await fetchQuotes(rows,{instruments:{one:{symbol:'ONE',exchange:'NSE'},two:{symbol:'TWO',exchange:'NSE'}},previous:[old],delay:async()=>{},fetcher:async()=>++calls===1?Response.json({ltp:100}):new Response('',{status:429,headers:{'retry-after':'900'}})});
 assert.equal(calls,2);assert.equal(result.fresh,1);assert.equal(result.stopped,true);assert.equal(result.retryAfterMs,900000);assert.deepEqual(result.quotes.find(q=>q.groww_slug==='two'),old);
});
test('official quotes batch at most fifty instruments and share one authenticated request per batch',async()=>{
 const rows=Array.from({length:51},(_,n)=>({groww_slug:'s'+n,qty:1})),instruments=Object.fromEntries(rows.map(r=>[r.groww_slug,{symbol:r.groww_slug,exchange:'NSE'}]));const sizes=[];
 const result=await fetchQuotes(rows,{provider:'groww-api',token:'synthetic',instruments,delay:async()=>{},fetcher:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer synthetic');const keys=new URL(url).searchParams.get('exchange_symbols').split(',');sizes.push(keys.length);return Response.json({status:'SUCCESS',payload:Object.fromEntries(keys.map(k=>[k,100]))});}});
 assert.deepEqual(sizes,[50,1]);assert.equal(result.fresh,51);
});
function harness(){
 const docs=new Map(),writes=[],account={id:'a'},config={version:1,enabled:true,rootId:'synthetic',accounts:[account],schedule,priceProvider:'groww-public'},state={},vault={data:{accounts:{a:{bound:true}}},save:async()=>{}};
 const publisher={marketViewData:async function(){return this;},ensureCatalog:async()=>{},latest:async(d,p)=>docs.get(d+'/'+p),publish:async(d,p,tables,meta,at)=>{const doc={dataset:d,partition:p,tables,meta,captured_at:at.toISOString(),content_hash:'sha256:'+'a'.repeat(64)};docs.set(d+'/'+p,doc);writes.push(d);return {doc};},compileCache:async()=>({reused:false}),status:async()=>{}};
 let captures=0;const capture=async()=>{captures++;return {rows:[{groww_slug:'one',name:'One',qty:2,invested:100,reference_price:55,reference_value:110}],storageState:{}};};
 const quotes=async rows=>({quotes:rows.map(r=>({groww_slug:r.groww_slug,ltp:60,fetched_at:'2026-11-23T04:00:00Z',source:'test'})),fresh:rows.length,failures:[],instruments:{}});
 return {config,state,vault,publisher,capture,quotes,calendar,docs,writes,get captures(){return captures;}};
}
test('daily positions reconcile once, ten minute cycles fetch only shared quotes; missed days reconcile once',async()=>{
 const h=harness();await runCycle({...h,now:new Date('2026-11-23T04:00:00Z')});await runCycle({...h,now:new Date('2026-11-23T04:20:00Z')});assert.equal(h.captures,1);assert.equal(h.writes.filter(d=>d==='market.prices').length,2);
 await runCycle({...h,now:new Date('2026-11-25T04:00:00Z')});assert.equal(h.captures,2);assert.equal(h.writes.filter(d=>d==='portfolio.positions').length,2);assert.equal(h.writes.filter(d=>d==='portfolio.position_changes').length,0);
});
test('blocked PIN state survives a later cache failure and prevents more automatic attempts',async()=>{
 const h=harness();h.docs.set('portfolio.positions/a',{dataset:'portfolio.positions',partition:'a',captured_at:'2026-11-20T04:00:00Z',tables:{positions:[{groww_slug:'one',qty:1}]}});let persisted;
 h.capture=async()=>{throw Object.assign(new Error('PIN_REJECTED'),{code:'PIN_REJECTED'});};h.publisher.compileCache=async()=>{throw new Error('CACHE_FAILED');};
 await assert.rejects(runCycle({...h,now:new Date('2026-11-23T04:00:00Z'),persist:async s=>{persisted=structuredClone(s);}}),/CACHE_FAILED/);assert.equal(persisted.blocked.a,'PIN_REJECTED');let attempted=false;h.capture=async()=>{attempted=true;};h.publisher.compileCache=async()=>({reused:true});await runCycle({...h,now:new Date('2026-11-23T04:20:00Z')});assert.equal(attempted,false);
});
test('unfinished immutable Drive uploads are invisible under snapshot filenames',async()=>{
 const calls=[];const p=new Publisher('synthetic','root');p.children=async()=>[];p.mutation=async(path,options)=>{calls.push({path,...options});return {id:'created'};};await p.jsonFile('20261123T040000Z__aaaaaaaaaaaa.json','parent',{test:true},{immutable:true});
 assert.match(calls[0].body.name,/^\.pending-/);assert.equal(calls[1].upload,true);assert.equal(calls[2].body.name,'20261123T040000Z__aaaaaaaaaaaa.json');
});
