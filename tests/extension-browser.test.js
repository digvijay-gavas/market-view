import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,cp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ExtensionBridge} from '../automation/extension-bridge.mjs';
import {createAdminServer} from '../automation/admin.mjs';
test('unpacked MV3 extension pairs and captures a mocked Groww page through the real loopback bridge',{skip:!process.env.COLLECTOR_EXTENSION_TESTS,timeout:60000},async()=>{
 const vault={data:{accounts:{swati:{}}},save:async()=>{}},config={version:1,enabled:false,rootId:'synthetic',accounts:[{id:'swati'}],priceProvider:'groww-public',schedule:{open:'09:15',close:'15:30',intervalSeconds:600,jitterSeconds:60}},state={};
 let held=false;const bridge=new ExtensionBridge('synthetic',{openVault:async()=>vault,lock:async()=>{if(held)return null;held=true;return async()=>{held=false;};},readJSON:async path=>String(path).endsWith('config.json')?config:String(path).endsWith('calendar.json')?{years:[new Date().getUTCFullYear()],holidays:[]}:state,atomicJSON:async()=>{}});
 const app=createAdminServer({service:{bridge}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const code=await bridge.createPair({account:'swati'}),home=await mkdtemp(join(tmpdir(),'market-mv3-test-')),extension=join(home,'extension');await cp(fileURLToPath(new URL('../extension',import.meta.url)),extension,{recursive:true});const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));manifest.content_scripts[0].include_globs=[app.url+'/runner*'];await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
 let context,worker;try{
  const {chromium}=await import('playwright');context=await chromium.launchPersistentContext(join(home,'profile'),{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  await context.route('https://groww.in/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<html><meta charset="utf-8"><body><h1>HOLDINGS (1)</h1><table><tr class="holdingRow_tablerow"><td><a href="/stocks/example">Example</a>2 shares Avg. ₹100.00 ₹110.00 +1.00 (1.00%) +₹20.00 10.00% ₹220.00 ₹200.00</td></tr></table></body></html>'}));
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(port=>chrome.storage.local.set({bridgePort:port}),app.server.address().port);
  // Chrome-created tabs can navigate before Playwright attaches its mock route.
  // Supply a preloaded, routed fixture tab; native DOM injection and bridge calls
  // remain real. Unit tests separately verify tab ownership and close behavior.
  const fixturePage=await context.newPage();await fixturePage.goto('https://groww.in/stocks/user/holdings');assert.equal(await fixturePage.locator('tr').count(),1);
  await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://groww.in/stocks/user/holdings'}),fixture=tabs[0],original=chrome.tabs.create.bind(chrome.tabs);if(!fixture)throw new Error('Fixture tab missing');chrome.tabs.create=options=>options.url==='https://groww.in/stocks/user/holdings'?chrome.tabs.get(fixture.id):original(options);});
  const id=new URL(worker.url()).host,page=await context.newPage();await page.goto('chrome-extension://'+id+'/popup.html');
  await page.getByLabel('Pairing code from Collector Admin',{exact:true}).fill(code.code);await page.getByRole('button',{name:'Pair this Chrome profile',exact:true}).click();await page.getByText('Account: swati',{exact:true}).waitFor();assert.equal(vault.data.accounts.swati.extension.confirmed,false);
  await page.getByLabel('I checked that this Chrome profile is signed into the account named above.',{exact:true}).check();await page.getByRole('button',{name:'Confirm account',exact:true}).click();await page.getByText(/1 positions captured/).waitFor({timeout:30000});
  assert.equal(vault.data.accounts.swati.extension.confirmed,true);assert.equal(vault.data.accounts.swati.extension.capture.rows[0].qty,2);assert.equal(vault.data.accounts.swati.extension.capture.rows[0].invested,200);assert.equal(config.collectionMode,'extension');
  const stored=await worker.evaluate(()=>chrome.storage.local.get(null));assert.equal(Object.hasOwn(stored,'pin'),false);assert.equal(Object.hasOwn(stored.pairing,'pin'),false);assert.equal(typeof stored.pairing.token,'string');
  // A separate collector window must close after capture and preserve the popup.
  const secondFixture=await context.newPage();await secondFixture.goto('https://groww.in/stocks/user/holdings');
  await worker.evaluate(async()=>{const fixture=(await chrome.tabs.query({url:'https://groww.in/stocks/user/holdings'}))[0],original=chrome.tabs.create.bind(chrome.tabs);chrome.tabs.create=async options=>{if(options.url==='https://groww.in/stocks/user/holdings'){if(options.windowId!==undefined)await chrome.tabs.move(fixture.id,{windowId:options.windowId,index:-1});return chrome.tabs.get(fixture.id);}return original(options);};});
  const prepared=await bridge.prepareManaged('swati'),owned=await worker.evaluate(()=>chrome.windows.create({url:'about:blank',focused:false}));
  await worker.evaluate(({tabId,url})=>chrome.tabs.update(tabId,{url}),{tabId:owned.tabs[0].id,url:app.url+'/runner#'+prepared.ticket});
  // tabs.update reuses the about:blank page, so inspect ownership through Chrome.
  for(let n=0;n<120&&vault.data.accounts.swati.extension.operation.phase!=='captured';n++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(vault.data.accounts.swati.extension.operation.phase,'captured');
  let remains=true;for(let n=0;n<50&&remains;n++){remains=await worker.evaluate(async id=>{try{await chrome.windows.get(id);return true;}catch{return false;}},owned.id);if(remains)await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(remains,false);assert.equal(page.isClosed(),false);assert.equal(vault.data.accounts.swati.extension.capture.requestId,vault.data.accounts.swati.extension.operation.captureRequestId);

 }catch(error){const status=await worker?.evaluate(()=>chrome.storage.local.get(['lastResult','testTab'])).catch(()=>null);throw new Error(error.message+'; synthetic extension status='+JSON.stringify(status));}
 finally{await context?.close();await app.close();assert.ok(resolve(home).startsWith(resolve(tmpdir())));await rm(home,{recursive:true,force:true});}
});
