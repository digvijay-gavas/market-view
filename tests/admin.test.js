import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminService} from '../automation/admin-service.mjs';
import {createAdminServer} from '../automation/admin.mjs';
const home='synthetic-private-home';
function fixture(overrides={}){
 const config={version:1,enabled:false,rootId:'synthetic',accounts:[{id:'swati'}],schedule:{open:'09:15',close:'15:30',intervalSeconds:600,jitterSeconds:60},priceProvider:'groww-public',browserChannel:'chrome'},state={blocked:{swati:'PIN_REJECTED'}},vault={data:{accounts:{swati:{pin:'1234'}},google:{refresh_token:'synthetic-refresh-token'},desktopClient:{installed:{client_id:'synthetic.apps.googleusercontent.com',client_secret:'synthetic-client-secret'}}},save:async()=>{}};
 let held=false,closed=0;const page={goto:async()=>{}},context={pages:()=>[page],close:async()=>{closed++;},storageState:async()=>({cookies:[{domain:'.groww.in',name:'session',value:'synthetic-session'},{domain:'.google.com',value:'synthetic-google-cookie'}],origins:[]})};
 const service=new AdminService(home,{readJSON:async path=>path.endsWith('config.json')?config:state,atomicJSON:async(path,value)=>{Object.assign(path.endsWith('config.json')?config:state,value);},openVault:async()=>vault,lock:async()=>{if(held)return null;held=true;return async()=>{held=false;};},taskInstalled:async()=>false,setTaskEnabled:async()=>false,openProfile:async()=>context,waitReady:async()=>{},savedProfiles:async()=>[],accessToken:async()=> 'synthetic-access-token',reader:()=>({get:async()=>({mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}})}),installTask:async()=>{},...overrides});
 return {service,config,state,vault,get held(){return held;},get closed(){return closed;}};
}
async function until(check){for(let n=0;n<100;n++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('Operation did not reach expected state');}
test('admin status returns readiness flags and timestamps, never saved PINs, tokens or session state',async()=>{
 const f=fixture(),status=await f.service.status(),text=JSON.stringify(status);assert.equal(status.accounts[0].pinSaved,true);assert.equal(status.googleConnected,true);
 for(const secret of ['1234','synthetic-refresh-token','synthetic-client-secret','storageState'])assert.ok(!text.includes(secret));
});
test('PIN saves validate the account and digits, retain enrollment block, and do not echo the PIN',async()=>{
 const f=fixture();await f.service.savePin({account:'swati',pin:'6789'});assert.equal(f.vault.data.accounts.swati.pin,'6789');assert.equal(f.state.blocked.swati,'PIN_REJECTED');
 await assert.rejects(f.service.savePin({account:'missing',pin:'6789'}),/UNKNOWN_ACCOUNT/);await assert.rejects(f.service.savePin({account:'swati',pin:'bad'}),/PIN_MUST_HAVE_FOUR_DIGITS/);assert.equal(f.held,false);
});
test('Groww enrollment requires browser readiness and explicit account confirmation; exclusive lock prevents concurrent edits',async()=>{
 const f=fixture();const job=f.service.enroll({account:'swati'});await until(()=>f.service.job.phase==='confirm');assert.equal(f.vault.data.accounts.swati.bound,undefined);assert.equal(f.held,true);
 await assert.rejects(f.service.savePin({account:'swati',pin:'6789'}),/ADMIN_BUSY/);assert.throws(()=>f.service.confirm({id:'wrong'}),/NO_CONFIRMATION_PENDING/);
 f.service.confirm({id:job.id});await f.service.job.done;assert.equal(f.service.job.phase,'complete');assert.equal(f.vault.data.accounts.swati.bound,true);assert.equal(f.vault.data.accounts.swati.storageState.cookies.length,1);assert.equal(f.state.blocked.swati,undefined);assert.equal(f.closed,1);assert.equal(f.held,false);
});
test('cancelled enrollment closes Chrome, leaves the account unbound and releases the worker lock',async()=>{
 const f=fixture(),job=f.service.enroll({account:'swati'});await until(()=>f.service.job.phase==='confirm');await f.service.cancel({id:job.id});await f.service.job.done;assert.equal(f.service.job.phase,'cancelled');assert.equal(f.vault.data.accounts.swati.bound,undefined);assert.equal(f.held,false);assert.ok(f.closed>0);
});
test('saved session selection is committed only after explicit account confirmation',async()=>{
 const profiles=[{id:'legacy:Profile_2',label:'Saved collector Profile 2',path:'/private/synthetic-collector'}];const f=fixture({savedProfiles:async()=>profiles});
 const job=f.service.enroll({account:'swati',profile:profiles[0].id});await until(()=>f.service.job.phase==='confirm');assert.equal(f.config.accounts[0].profileDirectory,undefined);f.service.confirm({id:job.id});await f.service.job.done;assert.equal(f.config.accounts[0].profileDirectory,profiles[0].path);assert.equal(f.vault.data.accounts.swati.bound,true);
 const g=fixture({savedProfiles:async()=>profiles}),cancelled=g.service.enroll({account:'swati',profile:profiles[0].id});await until(()=>g.service.job.phase==='confirm');await g.service.cancel({id:cancelled.id});await g.service.job.done;assert.equal(g.config.accounts[0].profileDirectory,undefined);
 const bad=fixture();bad.service.enroll({account:'swati',profile:'../../anywhere'});await bad.service.job.done;assert.equal(bad.service.job.error,'SAVED_PROFILE_UNAVAILABLE');
});
test('Google consent can be cancelled without retaining the worker lock',async()=>{
 const f=fixture({googleLogin:async(c,v,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('CANCELLED')),{once:true}))});
 const job=f.service.connectGoogle();await until(()=>f.service.job.phase==='signin');await f.service.cancel({id:job.id});await f.service.job.done;assert.equal(f.service.job.phase,'cancelled');assert.equal(f.held,false);
});
test('starting scheduling checks folder editor access and leaves collection paused if registration fails',async()=>{
 const denied=fixture({reader:()=>({get:async()=>({mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:false}})})});await assert.rejects(denied.service.startSchedule(),/FOLDER_EDITOR_REQUIRED/);assert.equal(denied.config.enabled,false);
 const failed=fixture({installTask:async()=>{throw new Error('INSTALL_FAILED');}});await assert.rejects(failed.service.startSchedule(),/INSTALL_FAILED/);assert.equal(failed.config.enabled,false);
 const ok=fixture();await ok.service.startSchedule();assert.equal(ok.config.enabled,true);await ok.service.pause();assert.equal(ok.config.enabled,false);
});
test('admin adds validated account aliases and disallows changing a running collector folder',async()=>{
 const f=fixture();await f.service.addAccount({account:'anna'});assert.equal(f.config.accounts.length,2);await assert.rejects(f.service.addAccount({account:'../escape'}),/INVALID_ACCOUNT/);await assert.rejects(f.service.addAccount({account:'anna'}),/ACCOUNT_ALREADY_EXISTS/);f.config.enabled=true;await assert.rejects(f.service.saveRoot({rootId:'other'}),/PAUSE_BEFORE_CHANGING_FOLDER/);
});
test('loopback admin requires a bootstrap key, private cookie, same-origin requests and explicit API header',async()=>{
 let saved;const app=createAdminServer({service:{status:async()=>({initialized:true}),savePin:async input=>{saved=input.pin;}}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=app.url;
 try{
  assert.equal((await fetch(origin+'/api/status')).status,403);
  assert.equal((await fetch(origin+'/api/session',{method:'POST',headers:{Origin:'https://example.com','X-Admin-Key':app.key}})).status,403);
  assert.equal((await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'X-Admin-Key':'incorrect'}})).status,403);
  const login=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'X-Admin-Key':app.key}});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(origin+'/api/status',{headers:{Cookie:cookie}})).status,403);
  const headers={Cookie:cookie,'X-Collector-Admin':'1',Origin:origin,'Content-Type':'application/json'};
  assert.equal((await fetch(origin+'/api/status',{headers})).status,200);
  assert.equal((await fetch(origin+'/api/action',{method:'POST',headers:{...headers,Origin:'null'},body:JSON.stringify({action:'pin',pin:'1234'})})).status,403);assert.equal(saved,undefined);
  const save=await fetch(origin+'/api/action',{method:'POST',headers,body:JSON.stringify({action:'pin',account:'swati',pin:'1234'})});assert.equal(save.status,200);assert.equal(saved,'1234');assert.ok(!(await save.text()).includes('1234'));
  assert.equal((await fetch(origin+'/api/action',{method:'POST',headers,body:JSON.stringify({action:'__proto__'})})).status,400);
  assert.equal((await fetch(origin+'/api/action',{method:'POST',headers,body:JSON.stringify({action:'pin',pin:'x'.repeat(40000)})})).status,413);
  const root=await fetch(origin);assert.match(root.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(root.headers.get('cache-control'),'no-store');assert.ok(!(await root.text()).includes(app.key));
 }finally{await app.close();}
});
test('admin UI works in a real mobile browser without persisting PIN inputs',{skip:!process.env.COLLECTOR_BROWSER_TESTS},async()=>{
 const f=fixture(),app=createAdminServer({service:f.service});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const {chromium}=await import('playwright');const browser=await chromium.launch({channel:process.env.COLLECTOR_TEST_BROWSER||'chrome',headless:true});
 try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(app.url+'/#'+app.key);await page.getByRole('heading',{name:"Your family's accounts"}).waitFor();assert.equal(new URL(page.url()).hash,'');
  await page.getByLabel('Groww PIN for swati').fill('6789');await page.getByRole('button',{name:'Save PIN',exact:true}).click();await page.getByText('PIN saved encrypted. Pair the extension to use it.',{exact:true}).waitFor();assert.equal(f.vault.data.accounts.swati.pin,'6789');assert.equal(await page.getByLabel('Groww PIN for swati').inputValue(),'');assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Pair Chrome extension',exact:true}).click();await page.getByLabel('One-time pairing code for swati',{exact:true}).waitFor();assert.match(await page.getByLabel('One-time pairing code for swati',{exact:true}).inputValue(),/^[A-F0-9]{20}$/);assert.equal(f.vault.data.accounts.swati.bound,undefined);
 }finally{await browser.close();await app.close();}
});
