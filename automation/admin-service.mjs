import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Vault,atomicJSON,REPO} from './vault.mjs';
import {readJSON,lock,validateConfig,run} from './worker.mjs';
import {protectHome,googleLogin} from './cli.mjs';
import {openProfile,waitReady,filterState,HOLDINGS_URL} from './browser.mjs';
import {accessToken} from './drive.mjs';
import {DriveReader,folderId} from '../src/drive.js';
import {installTask,taskInstalled,setTaskEnabled} from './task.mjs';
import {savedProfiles} from './profiles.mjs';
import {ExtensionBridge} from './extension-bridge.mjs';
import {openChromeExtensions} from './normal-chrome.mjs';
import {captureOperation} from './capture-operation.mjs';
import {managedRun} from './managed.mjs';
import {minute} from './schedule.mjs';

export function safeCode(error){const code=error?.code||error?.message;return /^[A-Z][A-Z_]{1,70}$/.test(code||'')?code:'SETUP_OR_RUNTIME_ERROR';}
function fail(code){throw new Error(code);}
export class AdminService{
 constructor(home,deps={}){
  this.home=home;this.configPath=join(home,'config.json');this.job=null;this.pending=false;
  this.deps={openVault:(create=false)=>new Vault(home).open(create),lock:()=>lock(home),readJSON,atomicJSON,protectHome,googleLogin,openProfile,waitReady,accessToken,reader:token=>new DriveReader(token),installTask,taskInstalled,setTaskEnabled,run,managedRun,savedProfiles,...deps};
  this.bridge=new ExtensionBridge(home,{...this.deps,afterCapture:async()=>{const vault=await this.deps.openVault(),config=await this.configured();if(vault.data.google?.refresh_token&&config.rootId)return this.deps.run(home,{force:true,positionsNow:true});return {pending:true};}});
 }
 async status(){
  const config=await this.deps.readJSON(this.configPath,null),state=await this.deps.readJSON(join(this.home,'state.json'),{});
  if(!config)return {initialized:false,accounts:[],job:this.publicJob()};
  const [vault,installed,profiles]=await Promise.all([this.deps.openVault(),this.deps.taskInstalled(),this.deps.savedProfiles()]);
  return {initialized:true,extensionFolder:join(REPO,'extension'),profiles:profiles.map(({id,label})=>({id,label})),googleConnected:Boolean(vault.data.google?.refresh_token),googleClientSaved:Boolean(vault.data.desktopClient),rootId:config.rootId,enabled:config.enabled,taskInstalled:installed,schedule:config.schedule,pricesEnabled:config.pricesEnabled!==false,positionsCadence:config.positionsCadence||'daily',syncHistory:await this.deps.readJSON(join(this.home,'sync-history.json'),[]),lastRunAt:state.lastRunAt||null,lastRunSummary:state.lastRunSummary||null,nextRunAt:state.nextRunAt||null,lastError:state.lastError?.code||null,accounts:config.accounts.map(a=>({id:a.id,profileId:a.profileDirectory?profiles.find(p=>p.path===a.profileDirectory)?.id||'unavailable':'dedicated',suggestedProfile:a.legacyProfileHint,pairingPending:this.bridge.pending(a.id),reconciliation:captureOperation(vault.data.accounts[a.id]?.extension),extensionPaired:Boolean(vault.data.accounts[a.id]?.extension?.confirmed),extensionCapturedAt:vault.data.accounts[a.id]?.extension?.capture?.capturedAt||null,extensionError:vault.data.accounts[a.id]?.extension?.lastError||null,pinSaved:Boolean(vault.data.accounts[a.id]?.pin),enrolled:Boolean(vault.data.accounts[a.id]?.bound),blocked:state.blocked?.[a.id]||(vault.data.accounts[a.id]?.pinAttemptPending?'PIN_CHECK_REQUIRED':null),lastPosition:state.positions?.[a.id]?.capturedAt||null})),job:this.publicJob()};
 }
 publicJob(){if(!this.job)return null;const {id,type,account,phase,error,result}=this.job;return {id,type,account,phase,error,result};}
 pairExtension(input){return this.bridge.createPair(input);}
 revokeExtension(input){return this.bridge.revoke(input);}
 requestExtensionCapture({account}){return this.startJob('fetch',account,()=>this.deps.managedRun(this.home,{force:true,account},{bridge:this.bridge}));}
 reconcileAll(){return this.fetchNow();}
 async saveFrequency({minutes,positionsCadence,open,close,pricesEnabled}){return this.exclusive(async()=>{if(!Number.isInteger(minutes)||minutes<5||minutes>240||!['daily','each-run'].includes(positionsCadence))fail('INVALID_FREQUENCY');const config=await this.configured(),window={open:open??config.schedule.open,close:close??config.schedule.close};try{if(minute(window.open)>=minute(window.close))fail('INVALID_COLLECTION_WINDOW');}catch{fail('INVALID_COLLECTION_WINDOW');}if(pricesEnabled!==undefined&&typeof pricesEnabled!=='boolean')fail('INVALID_FREQUENCY');const windowChanged=window.open!==config.schedule.open||window.close!==config.schedule.close;Object.assign(config.schedule,window);config.schedule.intervalSeconds=minutes*60;config.schedule.jitterSeconds=Math.min(60,Math.floor(minutes*60/3));config.positionsCadence=positionsCadence;if(pricesEnabled!==undefined)config.pricesEnabled=pricesEnabled;if(config.enabled&&windowChanged)await this.deps.installTask(this.home,config.schedule);await this.deps.atomicJSON(this.configPath,config);const state=await this.deps.readJSON(join(this.home,'state.json'),{});delete state.nextRunAt;await this.deps.atomicJSON(join(this.home,'state.json'),state);});}
 async openAccountChrome({account}){const config=await this.configured(),entry=this.account(config,account);await openChromeExtensions(entry.legacyProfileHint);}
 async exclusive(fn){
  if(this.pending||this.job&&['running','signin','confirm'].includes(this.job.phase))fail('ADMIN_BUSY');this.pending=true;
  let release;try{release=await this.deps.lock();if(!release)fail('COLLECTOR_BUSY');return await fn();}finally{this.pending=false;await release?.();}
 }
 async configured(){return validateConfig(await this.deps.readJSON(this.configPath,null));}
 account(config,id){const account=config.accounts.find(a=>a.id===id);if(!account)fail('UNKNOWN_ACCOUNT');return account;}
 async initialize({account='self',rootId=''}={}){
  return this.exclusive(async()=>{
   if(await this.deps.readJSON(this.configPath,null))fail('CONFIG_ALREADY_EXISTS');
   if(!/^[a-z0-9_-]{1,40}$/.test(account))fail('INVALID_ACCOUNT');await this.deps.protectHome(this.home);
   const config=validateConfig({version:1,enabled:false,collectionMode:'extension',rootId:rootId?folderId(rootId):'',accounts:[{id:account,enabled:true}],schedule:{open:'09:15',close:'15:30',intervalSeconds:600,jitterSeconds:60},priceProvider:'groww-public',browserChannel:'chrome',legacyCompatibility:true});
   const vault=await this.deps.openVault(true);await vault.save();await this.deps.atomicJSON(this.configPath,config);
  });
 }
 async savePin({account,pin}){
  return this.exclusive(async()=>{const config=await this.configured();this.account(config,account);if(typeof pin!=='string'||!/^\d{4}$/.test(pin))fail('PIN_MUST_HAVE_FOUR_DIGITS');const vault=await this.deps.openVault();vault.data.accounts[account]||={};vault.data.accounts[account].pin=pin;await vault.save();});
 }
 async addAccount({account}){
  return this.exclusive(async()=>{const config=await this.configured();if(typeof account!=='string'||!/^[a-z0-9_-]{1,40}$/.test(account))fail('INVALID_ACCOUNT');if(config.accounts.some(a=>a.id===account))fail('ACCOUNT_ALREADY_EXISTS');config.accounts.push({id:account,enabled:true});await this.deps.atomicJSON(this.configPath,config);});
 }
 async saveRoot({rootId}){return this.exclusive(async()=>{const config=await this.configured();if(config.enabled)fail('PAUSE_BEFORE_CHANGING_FOLDER');config.rootId=folderId(String(rootId||''));await this.deps.atomicJSON(this.configPath,config);});}
 startJob(type,account,fn){
  if(this.pending||this.job&&['running','signin','confirm'].includes(this.job.phase))fail('ADMIN_BUSY');
  const job={id:randomUUID(),type,account,phase:'running',controller:new AbortController()};this.job=job;
  job.done=Promise.resolve().then(()=>fn(job)).then(result=>{job.result=result;job.phase=result?.partial?'partial':'complete';},error=>{job.phase=job.controller.signal.aborted?'cancelled':'failed';job.error=safeCode(error);});
  return this.publicJob();
 }
 async jobLock(job,fn){const release=await this.deps.lock();if(!release)fail('COLLECTOR_BUSY');try{job.controller.signal.throwIfAborted();return await fn();}finally{await release();}}
 enroll({account,profile}){
  return this.startJob('enroll',account,job=>this.jobLock(job,async()=>{
   const config=await this.configured(),entry=this.account(config,account);const vault=await this.deps.openVault(),secret=vault.data.accounts[account]||={};let context;
   const choices=await this.deps.savedProfiles(),chosen=profile&&profile!=='dedicated'?choices.find(p=>p.id===profile):null;
   if(profile&&profile!=='dedicated'&&!chosen)fail('SAVED_PROFILE_UNAVAILABLE');
   const profilePath=profile==='dedicated'?undefined:chosen?.path||entry.profileDirectory;
   try{
    context=await this.deps.openProfile(this.home,account,{channel:config.browserChannel,headless:false,profilePath,restore:!profilePath&&secret.restore?secret.storageState:null});
    job.cancel=async()=>{job.rejectConfirm?.(new Error('CANCELLED'));await context.close();};job.controller.signal.throwIfAborted();
    const page=context.pages()[0]||await context.newPage();job.phase='signin';await page.goto(HOLDINGS_URL,{waitUntil:'domcontentloaded'});
    await this.deps.waitReady(page,{interactive:true,timeoutMs:900000,pin:secret.pin,onPinAttempt:async()=>{secret.pinAttemptPending=true;await vault.save();}});job.controller.signal.throwIfAborted();
    job.phase='confirm';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CONFIRMATION_TIMEOUT')),300000);job.confirm=()=>{clearTimeout(timer);resolve();};job.rejectConfirm=error=>{clearTimeout(timer);reject(error);};});
    job.controller.signal.throwIfAborted();await this.deps.waitReady(page,{timeoutMs:15000});
    secret.storageState=filterState(await context.storageState({indexedDB:true}));secret.bound=true;secret.restore=false;secret.pinAttemptPending=false;
    if(profilePath)entry.profileDirectory=profilePath;else delete entry.profileDirectory;
    await this.deps.atomicJSON(this.configPath,config);await vault.save();
    const state=await this.deps.readJSON(join(this.home,'state.json'),{});if(state.blocked)delete state.blocked[account];await this.deps.atomicJSON(join(this.home,'state.json'),state);
   }finally{await context?.close();}
  }));
 }
 connectGoogle({client}={}){
  return this.startJob('google',null,job=>this.jobLock(job,async()=>{
   await this.configured();const vault=await this.deps.openVault();
   if(client){if(typeof client.installed?.client_id!=='string'||!client.installed.client_id.endsWith('.apps.googleusercontent.com'))fail('DESKTOP_CLIENT_REQUIRED');vault.data.desktopClient=client;await vault.save();}
   if(!vault.data.desktopClient)fail('DESKTOP_CLIENT_REQUIRED');job.phase='signin';
   await this.deps.googleLogin(vault.data.desktopClient,vault,{signal:job.controller.signal});
  }));
 }
 confirm({id}){if(this.job?.id!==id||this.job.phase!=='confirm')fail('NO_CONFIRMATION_PENDING');this.job.confirm();this.job.phase='running';}
 async cancel({id}){if(this.job?.id!==id||!['running','signin','confirm'].includes(this.job.phase))fail('NO_JOB_RUNNING');if(this.job.type==='fetch')fail('FETCH_CANNOT_BE_CANCELLED');this.job.controller.abort();await this.job.cancel?.();}
 async startSchedule(){return this.exclusive(async()=>{
  const config=await this.configured(),vault=await this.deps.openVault(),token=await this.deps.accessToken(vault.data.google);
  if(!config.rootId){const stores=await this.deps.reader(token).findStores();if(stores.length!==1)fail('SET_EXACT_ROOT_ID_IN_CONFIG');config.rootId=stores[0].id;}
  const root=await this.deps.reader(token).get('/files/'+encodeURIComponent(config.rootId),{fields:'id,mimeType,trashed,capabilities(canAddChildren)',supportsAllDrives:'true'});
  if(root.trashed||root.mimeType!=='application/vnd.google-apps.folder'||root.capabilities?.canAddChildren!==true)fail('FOLDER_EDITOR_REQUIRED');
  await this.deps.installTask(this.home,config.schedule);config.collectionMode='extension';config.enabled=true;await this.deps.atomicJSON(this.configPath,config);
 });}
 async pause(){return this.exclusive(async()=>{const config=await this.configured();config.enabled=false;await this.deps.atomicJSON(this.configPath,config);await this.deps.setTaskEnabled(false);});}
 fetchNow(){return this.startJob('fetch',null,async()=>{await this.bridge.activateMode();return this.deps.managedRun(this.home,{force:true},{bridge:this.bridge});});}
 async close(){if(this.job&&['running','signin','confirm'].includes(this.job.phase)&&this.job.type!=='fetch'){await this.cancel({id:this.job.id});await this.job.done;}}
}
