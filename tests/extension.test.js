import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ExtensionBridge} from '../automation/extension-bridge.mjs';
import {extensionCapture} from '../automation/extension-inbox.mjs';
import {collectCycle} from '../extension/collector.js';
import {runCycle} from '../automation/worker.mjs';
const clientId='12345678-1234-1234-1234-123456789012',extensionId='a'.repeat(32),at='2026-11-23T04:00:00.000Z',row={groww_slug:'example',name:'Example',qty:2,invested:200,reference_price:110,reference_value:220};
function fixture(){
 let now=new Date(at),held=false,published=0;const config={version:1,enabled:true,rootId:'synthetic',accounts:[{id:'swati'},{id:'anna'}],schedule:{open:'09:15',close:'15:30',intervalSeconds:600,jitterSeconds:0},priceProvider:'groww-public',calendar:{years:[2026],holidays:['2026-11-24'],specialSessions:{}}},state={},vault={data:{accounts:{swati:{pin:'1234'},anna:{}}},save:async()=>{}};
 const bridge=new ExtensionBridge('synthetic',{openVault:async()=>vault,readJSON:async path=>String(path).endsWith('config.json')?config:state,atomicJSON:async(path,value)=>Object.assign(String(path).endsWith('config.json')?config:state,value),now:()=>now,lock:async()=>{if(held)return null;held=true;return async()=>{held=false;};},afterCapture:async()=>{published++;}});
 const pair=async(account='swati')=>{const p=await bridge.createPair({account});const token=await bridge.call('pair',{code:p.code,clientId},extensionId);const body={account,clientId};await bridge.call('confirm',{...body,confirmed:true},extensionId,token.token);return {body,token:token.token};};
 return {bridge,vault,config,state,pair,setNow:value=>{now=new Date(value);},get published(){return published;}};
}
test('pairing codes expire, are consumed once, and require account confirmation before collection',async()=>{
 const f=fixture(),p=await f.bridge.createPair({account:'swati'});f.setNow('2026-11-23T04:11:00Z');await assert.rejects(f.bridge.call('pair',{code:p.code,clientId},extensionId),/PAIRING_EXPIRED/);
 const next=await f.bridge.createPair({account:'swati'}),token=await f.bridge.call('pair',{code:next.code,clientId},extensionId);assert.equal(token.confirmed,false);assert.equal(f.config.collectionMode,'extension');assert.equal(f.vault.data.accounts.swati.extension.tokenHash.includes(token.token),false);
 await assert.rejects(f.bridge.call('pair',{code:next.code,clientId},extensionId),/PAIRING_EXPIRED/);assert.equal((await f.bridge.call('poll',{account:'swati',clientId},extensionId,token.token)).action,'confirm');
 await assert.rejects(f.bridge.call('confirm',{account:'swati',clientId,confirmed:false},extensionId,token.token),/ACCOUNT_CONFIRMATION_REQUIRED/);
});
test('extension tokens are restricted to one account, client and extension origin and can be revoked',async()=>{
 const f=fixture(),p=await f.pair();for(const [body,id,token]of [[{...p.body,account:'anna'},extensionId,p.token],[{...p.body,clientId:'different'},extensionId,p.token],[p.body,'b'.repeat(32),p.token],[p.body,extensionId,'bad']])await assert.rejects(f.bridge.call('poll',body,id,token),/EXTENSION_AUTH_REQUIRED/);
 await f.bridge.revoke({account:'swati'});await assert.rejects(f.bridge.call('poll',p.body,extensionId,p.token),/EXTENSION_AUTH_REQUIRED/);
});
test('daily capture obeys calendar and pause gates, while explicit manual capture works when paused',async()=>{
 const f=fixture(),p=await f.pair();f.bridge.deps.readJSON=async path=>String(path).endsWith('config.json')?f.config:{years:[2026],holidays:['2026-11-24'],specialSessions:{}};
 let plan=await f.bridge.call('poll',p.body,extensionId,p.token);assert.equal(plan.action,'capture');await f.bridge.call('result',{...p.body,requestId:plan.requestId,rows:[row],capturedAt:at},extensionId,p.token);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.published,1);
 assert.equal((await f.bridge.call('poll',p.body,extensionId,p.token)).reason,'POSITIONS_CURRENT');f.config.enabled=false;assert.equal((await f.bridge.call('poll',p.body,extensionId,p.token)).reason,'PAUSED');assert.equal((await f.bridge.call('poll',{...p.body,manual:true},extensionId,p.token)).action,'capture');
 f.vault.data.accounts.swati.extension.manualRequestedAt=null;f.config.enabled=true;f.setNow('2026-11-24T04:00:00Z');assert.equal((await f.bridge.call('poll',p.body,extensionId,p.token)).reason,'MARKET_CLOSED');
});
test('PIN is returned only for an authenticated live capture and is guarded before its one allowed attempt',async()=>{
 const f=fixture(),p=await f.pair();await assert.rejects(f.bridge.call('unlock',{...p.body,requestId:'wrong'},extensionId,p.token),/CAPTURE_REQUEST_EXPIRED/);const plan=await f.bridge.call('poll',{...p.body,manual:true},extensionId,p.token);
 assert.equal(Object.hasOwn(plan,'pin'),false);const result=await f.bridge.call('unlock',{...p.body,requestId:plan.requestId},extensionId,p.token);assert.equal(result.pin,'1234');assert.equal(f.vault.data.accounts.swati.pinAttemptPending,true);
 await assert.rejects(f.bridge.call('unlock',{...p.body,requestId:plan.requestId},extensionId,p.token),/PIN_CHECK_REQUIRED/);
});
test('capture rejects replay, partial empty data, duplicate holdings and implausible timestamps',async()=>{
 const f=fixture(),p=await f.pair(),plan=await f.bridge.call('poll',{...p.body,manual:true},extensionId,p.token),base={...p.body,requestId:plan.requestId,capturedAt:at};
 for(const input of [{...base,rows:[]},{...base,rows:[row,row]},{...base,rows:[row],capturedAt:'2026-11-24T04:00:00Z'}])await assert.rejects(f.bridge.call('result',input,extensionId,p.token));
 const accepted=await f.bridge.call('result',{...base,rows:[{...row,privateField:'DO_NOT_STORE'}]},extensionId,p.token);assert.equal(accepted.positions,1);assert.equal(JSON.stringify(f.vault.data.accounts.swati.extension.capture).includes('DO_NOT_STORE'),false);
 await assert.rejects(f.bridge.call('result',{...base,rows:[row]},extensionId,p.token),/CAPTURE_REQUEST_EXPIRED/);
});
test('extension capture keeps source timestamps and requires a current-day observation',()=>{
 const secret={extension:{confirmed:true,capture:{rows:[row],capturedAt:at}}};assert.equal(extensionCapture(secret,new Date(at)).capturedAt,at);assert.throws(()=>extensionCapture(secret,new Date('2026-11-25T04:00:00Z')),/EXTENSION_CAPTURE_REQUIRED/);
});
function chromeMock(probes){let index=0,removed=0,time=Date.parse(at);const chrome={tabs:{create:async()=>({id:1}),get:async()=>({url:'https://groww.in/stocks/user/holdings',status:'complete'}),remove:async()=>{removed++;}},scripting:{executeScript:async({func})=>[{result:func.name==='probePage'?probes[Math.min(index++,probes.length-1)]:func.name==='extractHoldings'?{rows:[row]}:{filled:true}}]}};return {chrome,options:{delay:async()=>{},now:()=>{time+=1000;return time;},timeoutMs:30000},get removed(){return removed;}};}
test('collection script never treats login/OTP as empty and never repeats a PIN attempt',async()=>{
 for(const probes of [[{signedOut:true,empty:true}],[{challenge:true,empty:true}],[{pin:true},{pin:true}]]){const f=chromeMock(probes),calls=[];const api=async(action,body)=>{calls.push(action);if(action==='poll')return {action:'capture',requestId:'test',account:'swati'};if(action==='unlock')return {pin:'1234'};return {recorded:true};};const result=await collectCycle(f.chrome,api,true,f.options);assert.equal(result.state,'attention');assert.equal(calls.includes('result'),false);assert.ok(calls.filter(a=>a==='unlock').length<=1);assert.equal(f.removed,1);}
});
test('collection waits for a stable complete table and posts structured holdings only',async()=>{
 const f=chromeMock([{rows:1}]),calls=[];const api=async(action,body)=>{calls.push({action,body});return action==='poll'?{action:'capture',requestId:'test',account:'swati'}:{positions:1,capturedAt:body.capturedAt};};const result=await collectCycle(f.chrome,api,true,f.options);assert.equal(result.state,'captured');assert.deepEqual(calls.find(c=>c.action==='result').body.rows,[row]);assert.equal(f.removed,1);
});
test('worker publishes extension timestamps and never opens a browser for paired accounts',async()=>{
 const f=fixture();f.config.accounts=[{id:'swati',captureMode:'extension'}];f.vault.data.accounts.swati.extension={confirmed:true,capture:{rows:[row],capturedAt:'2026-11-23T03:55:00.000Z'}};const writes=[];
 const publisher={marketViewData:async function(){return this;},ensureCatalog:async()=>{},latest:async()=>null,publish:async(d,p,t,m,at)=>{writes.push({d,at:at.toISOString()});return {doc:{tables:t,captured_at:at.toISOString(),content_hash:'sha256:'+'a'.repeat(64)}};},compileCache:async()=>({reused:false}),status:async()=>{}};
 await runCycle({config:f.config,state:{},vault:f.vault,publisher,calendar:{years:[2026],holidays:[]},now:new Date(at),capture:async()=>assert.fail('Browser must not launch'),quotes:async()=>({quotes:[],fresh:0,failures:[],instruments:{}})});
 assert.equal(writes.find(w=>w.d==='portfolio.positions').at,'2026-11-23T03:55:00.000Z');assert.equal(writes.some(w=>w.d==='groww.live_holdings'),false,"the Market app's dataset is never written");
});
test('extension manifest limits access to Groww and loopback and requests no cookies or Google access',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url)));assert.ok(manifest.content_scripts.some(c=>c.world==='MAIN'&&c.matches.every(m=>m.startsWith('https://groww.in/stocks/user/holdings'))),'page hook limited to the holdings page');assert.deepEqual(manifest.host_permissions,['https://groww.in/*','https://smallcases.groww.in/*','http://127.0.0.1/*']);assert.equal(manifest.permissions.includes('cookies'),false);assert.equal(manifest.manifest_version,3);
});
