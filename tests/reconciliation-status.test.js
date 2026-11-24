import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ExtensionBridge} from '../automation/extension-bridge.mjs';
import {captureOperation} from '../automation/capture-operation.mjs';
import {runSummary} from '../automation/run-status.mjs';
import {reconciliationFeedback,fetchFeedback} from '../automation/admin-ui/feedback.js';
import {runCycle} from '../automation/worker.mjs';
import {createAdminServer} from '../automation/admin.mjs';
const clientId='12345678-1234-1234-1234-123456789012',extensionId='a'.repeat(32),row={groww_slug:'example',name:'Example',qty:2,invested:200,reference_price:110,reference_value:220};
function fixture(afterCapture=async()=>({pending:true})){
 let now=new Date(),held=false;const config={version:1,enabled:false,rootId:'synthetic',accounts:[{id:'bunny'}],priceProvider:'groww-public',schedule:{open:'09:15',close:'15:30',intervalSeconds:600,jitterSeconds:0},calendar:{years:[now.getUTCFullYear()],holidays:[]}},state={},vault={data:{accounts:{bunny:{}}},save:async()=>{}};
 const bridge=new ExtensionBridge('synthetic',{openVault:async()=>vault,readJSON:async p=>String(p).endsWith('config.json')?config:state,atomicJSON:async()=>{},now:()=>now,afterCapture,lock:async()=>{if(held)return null;held=true;return async()=>{held=false;};}});
 const bind=async()=>{const code=await bridge.createPair({account:'bunny'}),paired=await bridge.call('pair',{code:code.code,clientId},extensionId);const body={account:'bunny',clientId};await bridge.call('confirm',{...body,confirmed:true},extensionId,paired.token);return {body,token:paired.token};};
 return {bridge,config,state,vault,bind,get ext(){return vault.data.accounts.bunny.extension;},get now(){return now;},advance:ms=>{now=new Date(+now+ms);}};
}
async function settled(){for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));}
test('reconcile request is durably queued, deduplicated and becomes running only when Chrome polls',async()=>{
 const f=fixture(),p=await f.bind(),queued=await f.bridge.requestCapture({account:'bunny'});assert.equal(queued.phase,'queued');assert.equal((await f.bridge.requestCapture({account:'bunny'})).id,queued.id);
 const plan=await f.bridge.call('poll',p.body,extensionId,p.token);assert.equal(f.ext.operation.id,queued.id);assert.equal(f.ext.operation.phase,'running');assert.equal(f.ext.operation.captureRequestId,plan.requestId);
 const status=captureOperation(f.ext,f.now);assert.equal(status.phase,'running');assert.equal('captureRequestId' in status,false);assert.equal('tokenHash' in status,false);
});
test('no-response requests expire visibly instead of spinning indefinitely',async()=>{
 const f=fixture();await f.bind();await f.bridge.requestCapture({account:'bunny'});f.advance(301000);const status=captureOperation(f.ext,f.now);assert.equal(status.phase,'failed');assert.equal(status.error,'EXTENSION_OFFLINE');
 const view=reconciliationFeedback({extensionPaired:true,reconciliation:status},true);assert.equal(view.phase,'failed');
 f.ext.operation={id:'sync',phase:'captured',publishState:'pending',deadlineAt:new Date(+f.now-1).toISOString()};assert.equal(captureOperation(f.ext,f.now).errorStage,'publish');
});
test('accepted capture remains pending when Drive is unconfigured and never reports reconciliation success',async()=>{
 const f=fixture(),p=await f.bind();await f.bridge.requestCapture({account:'bunny'});const plan=await f.bridge.call('poll',p.body,extensionId,p.token);await f.bridge.call('result',{...p.body,requestId:plan.requestId,rows:[row],capturedAt:f.now.toISOString()},extensionId,p.token);await settled();
 assert.equal(f.ext.operation.phase,'captured');assert.equal(f.ext.operation.publishState,'awaiting-drive');const view=reconciliationFeedback({extensionPaired:true,reconciliation:captureOperation(f.ext,f.now)},false);assert.equal(view.phase,'waiting');assert.match(view.message,/Connect Google Drive/);assert.doesNotMatch(view.message,/Succeeded/);
});
test('capture errors and failed Drive publication retain explicit failure and the valid local inbox',async()=>{
 const f=fixture(async()=>{throw new Error('DRIVE_WRITE_FAILED');}),p=await f.bind();const plan=await f.bridge.call('poll',p.body,extensionId,p.token);await f.bridge.call('error',{...p.body,requestId:plan.requestId,code:'AUTH_REQUIRED'},extensionId,p.token);assert.equal(f.ext.operation.phase,'failed');assert.equal(f.ext.operation.error,'AUTH_REQUIRED');
 const retry=await f.bridge.call('poll',{...p.body,manual:true},extensionId,p.token);await f.bridge.call('result',{...p.body,requestId:retry.requestId,rows:[row],capturedAt:f.now.toISOString()},extensionId,p.token);await settled();assert.equal(f.ext.operation.phase,'failed');assert.equal(f.ext.operation.errorStage,'publish');assert.equal(f.ext.capture.rows.length,1);
});
test('worker only marks the matching capture successful after the shared cache finishes',async()=>{
 const f=fixture(),at='2026-11-23T04:00:00.000Z';f.config.enabled=true;f.config.collectionMode='extension';f.config.calendar={years:[2026],holidays:[]};f.vault.data.accounts.bunny.extension={confirmed:true,capture:{requestId:'capture-one',capturedAt:at,rows:[row]},operation:{id:'operation-one',phase:'captured',captureRequestId:'capture-one',positions:1,capturedAt:at}};
 const docs=new Map();let failCache=true;const publisher={marketViewData:async function(){return this;},ensureCatalog:async()=>{},latest:async(d,p)=>docs.get(d+'/'+p),publish:async(d,p,t,m,date)=>{const doc={dataset:d,partition:p,tables:t,captured_at:date.toISOString(),content_hash:'sha256:'+'a'.repeat(64)};docs.set(d+'/'+p,doc);return {doc};},compileCache:async()=>{if(failCache)throw new Error('CACHE_FAILED');return {reused:false};},status:async()=>{}};
 const args={config:f.config,state:{},vault:f.vault,publisher,calendar:f.config.calendar,now:new Date(at),positionsNow:true,quotes:async()=>({fresh:0,quotes:[],failures:[],instruments:{}})};
 await assert.rejects(runCycle(args),/CACHE_FAILED/);assert.equal(f.ext.operation.phase,'captured');failCache=false;await runCycle(args);assert.equal(f.ext.operation.phase,'succeeded');
 f.ext.operation={id:'new-queued-operation',phase:'queued'};await runCycle(args);assert.equal(f.ext.operation.phase,'queued');
});
test('partial fetch results are preserved and never labelled fully successful',()=>{
 const summary=runSummary({positionAccounts:[{state:'ok'},{state:'EXTENSION_NOT_PAIRED'}],failedQuotes:2,quoteState:'updated',cache:'rebuilt'});assert.equal(summary.partial,true);assert.equal(summary.pendingAccounts,1);
 const view=fetchFeedback({job:{type:'fetch',phase:'partial',result:summary}});assert.equal(view.phase,'waiting');assert.match(view.message,/Partly updated/);assert.doesNotMatch(view.message,/Succeeded/);
 assert.equal(fetchFeedback({lastRunSummary:summary,lastRunAt:'2026-11-23T04:00:00Z'}).phase,'waiting');assert.equal(fetchFeedback({job:{type:'fetch',phase:'failed',error:'DRIVE_WRITE_FAILED'}}).phase,'failed');
});
test('mobile admin keeps per-button waiting, running, success and partial-fetch feedback across reloads',{skip:!process.env.COLLECTOR_BROWSER_TESTS,timeout:30000},async()=>{
 const account={id:'bunny',extensionPaired:true,pinSaved:true,lastPosition:null},snapshot={initialized:true,accounts:[account],googleConnected:true,googleClientSaved:true,rootId:'synthetic',enabled:false,taskInstalled:false,extensionFolder:'C:\\synthetic\\extension',job:null};
 const app=createAdminServer({service:{status:async()=>snapshot,requestExtensionCapture:async()=>{account.reconciliation={id:'op-one',phase:'queued',requestedAt:new Date().toISOString()};return account.reconciliation;},fetchNow:async()=>{snapshot.job={id:'fetch-one',type:'fetch',phase:'running'};return snapshot.job;}}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const {chromium}=await import('playwright'),browser=await chromium.launch({channel:process.env.COLLECTOR_TEST_BROWSER||'chrome',headless:true});
 try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(app.url+'/#'+app.key);const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:/^bunny$/i})});await card.getByRole('button',{name:'Reconcile positions',exact:true}).click();await card.getByRole('button',{name:'Waiting for Chrome…',exact:true}).waitFor();assert.equal(await card.getByRole('button',{name:'Waiting for Chrome…'}).getAttribute('aria-busy'),'true');assert.match(await card.innerText(),/Opening the paired Chrome profile/);
  account.reconciliation.phase='running';await page.reload();await card.getByRole('button',{name:'Reconciling…',exact:true}).waitFor();
  account.reconciliation.phase='captured';account.reconciliation.publishState='pending';await page.reload();await card.getByRole('button',{name:'Syncing…',exact:true}).waitFor();
  account.reconciliation={id:'op-one',phase:'succeeded',positions:3,capturedAt:new Date().toISOString()};account.lastPosition=account.reconciliation.capturedAt;await page.reload();await card.getByText(/Succeeded · 3 positions/).waitFor();assert.equal(await card.getByRole('button',{name:'Reconcile positions',exact:true}).isEnabled(),true);assert.match(await card.innerText(),/Positions reconciled:/);
  await page.getByRole('button',{name:'Fetch now',exact:true}).click();await page.getByRole('button',{name:'Fetching…',exact:true}).waitFor();snapshot.job={id:'fetch-one',type:'fetch',phase:'partial',result:{pendingAccounts:1,failedQuotes:0}};await page.reload();await page.locator('#fetch-feedback').filter({hasText:'Partly updated'}).waitFor();assert.equal(await page.getByRole('button',{name:'Fetch now',exact:true}).isEnabled(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await browser.close();await app.close();}
});
