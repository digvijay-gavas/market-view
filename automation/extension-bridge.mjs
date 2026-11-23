import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {Vault,atomicJSON} from './vault.mjs';
import {readJSON,lock,validateConfig} from './worker.mjs';
import {ist,marketOpen} from './schedule.mjs';
import {validateProgressive} from '../src/progressive.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=code=>{throw new Error(code);};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const codes=new Set(['AUTH_REQUIRED','PIN_REQUIRED','PIN_REJECTED','PIN_INPUT_CHANGED','PIN_CHECK_REQUIRED','PARTIAL_HOLDINGS','HOLDINGS_TIMEOUT','GROWW_UNAVAILABLE']);
export class ExtensionBridge{
 constructor(home,deps={}){this.home=home;this.codes=new Map();this.deps={openVault:()=>new Vault(home).open(),readJSON,atomicJSON,lock:()=>lock(home),now:()=>new Date(),afterCapture:async()=>{},...deps};}
 pending(account){return [...this.codes.values()].some(p=>p.account===account&&p.expires>+this.deps.now());}
 async activateMode(){return this.locked(async()=>{const {config}=await this.context();config.collectionMode='extension';await this.deps.atomicJSON(join(this.home,'config.json'),config);});}
 async locked(fn){const release=await this.deps.lock();if(!release)fail('COLLECTOR_BUSY');try{return await fn();}finally{await release();}}
 async context(){return {config:validateConfig(await this.deps.readJSON(join(this.home,'config.json'),null)),vault:await this.deps.openVault(),now:this.deps.now()};}
 async createPair({account}){return this.locked(async()=>{
  const {config,now}=await this.context();if(!config.accounts.some(a=>a.id===account))fail('UNKNOWN_ACCOUNT');
  for(const [key,item]of this.codes)if(item.account===account||item.expires<+now)this.codes.delete(key);
  const code=randomBytes(10).toString('hex').toUpperCase(),expires=+now+600000;this.codes.set(hash(code),{account,expires});return {code,expiresAt:new Date(expires).toISOString()};
 });}
 async revoke({account}){return this.locked(async()=>{const {config,vault}=await this.context();const entry=config.accounts.find(a=>a.id===account);if(!entry)fail('UNKNOWN_ACCOUNT');const secret=vault.data.accounts[account];if(secret){delete secret.extension;secret.bound=false;}entry.captureMode='extension';await vault.save();await this.deps.atomicJSON(join(this.home,'config.json'),config);for(const [key,item]of this.codes)if(item.account===account)this.codes.delete(key);});}
 async requestCapture({account}){return this.locked(async()=>{const {vault,now}=await this.context(),ext=vault.data.accounts[account]?.extension;if(!ext?.confirmed)fail('EXTENSION_NOT_PAIRED');ext.manualRequestedAt=now.toISOString();ext.retryAt=null;await vault.save();});}
 async pair(input,extensionId){return this.locked(async()=>{
  const {config,vault,now}=await this.context();if(typeof input.code!=='string'||typeof input.clientId!=='string'||!/^[a-f0-9-]{36}$/.test(input.clientId))fail('PAIRING_INVALID');
  const digest=hash(input.code.toUpperCase().replaceAll(' ','')),pending=this.codes.get(digest);if(!pending||pending.expires<+now)fail('PAIRING_EXPIRED');
  const token=randomBytes(32).toString('base64url'),secret=vault.data.accounts[pending.account]||={};
  secret.extension={tokenHash:hash(token),clientId:input.clientId,extensionId,confirmed:false,pairedAt:now.toISOString()};
  const entry=config.accounts.find(a=>a.id===pending.account);if(!entry)fail('UNKNOWN_ACCOUNT');entry.captureMode='extension';config.collectionMode='extension';secret.bound=false;
  await vault.save();await this.deps.atomicJSON(join(this.home,'config.json'),config);this.codes.delete(digest);return {token,account:pending.account,confirmed:false};
 });}
 async authenticated(input,extensionId,token){
  if(typeof token!=='string'||token.length>100||typeof input.account!=='string')fail('EXTENSION_AUTH_REQUIRED');
  const ctx=await this.context(),secret=ctx.vault.data.accounts[input.account],ext=secret?.extension;
  if(!ext||!same(ext.tokenHash,hash(token))||ext.clientId!==input.clientId||ext.extensionId!==extensionId)fail('EXTENSION_AUTH_REQUIRED');
  const entry=ctx.config.accounts.find(a=>a.id===input.account);if(!entry||entry.enabled===false)fail('EXTENSION_AUTH_REQUIRED');return {...ctx,secret,ext,entry};
 }
 request(ext,input,now){if(!ext.confirmed)fail('EXTENSION_NOT_CONFIRMED');if(!ext.request||ext.request.id!==input.requestId||Date.parse(ext.request.expiresAt)<+now)fail('CAPTURE_REQUEST_EXPIRED');}
 async call(action,input,extensionId,token){
  if(action==='pair')return this.pair(input,extensionId);
  let accepted=false;
  const response=await this.locked(async()=>{
   const {config,vault,now,secret,ext,entry}=await this.authenticated(input,extensionId,token);
   if(action==='confirm'){
    if(input.confirmed!==true)fail('ACCOUNT_CONFIRMATION_REQUIRED');ext.confirmed=true;secret.bound=true;secret.pinAttemptPending=false;ext.manualRequestedAt=now.toISOString();ext.retryAt=null;entry.captureMode='extension';
    await vault.save();await this.deps.atomicJSON(join(this.home,'config.json'),config);return {account:input.account,confirmed:true};
   }
   if(action==='poll'){
    if(!ext.confirmed)return {action:'confirm',account:input.account};
    const manual=input.manual===true||Boolean(ext.manualRequestedAt),calendar=config.calendar||await this.deps.readJSON(new URL('calendar.json',import.meta.url));
    const market=marketOpen(now,calendar,config.schedule);
    if(!manual&&(!config.enabled||!market.open))return {action:'idle',reason:!config.enabled?'PAUSED':market.reason,account:input.account};
    if(!manual&&Date.parse(ext.retryAt||'')>+now)return {action:'idle',reason:ext.lastError||'RETRY_LATER',account:input.account};
    if(!manual&&ext.capture&&ist(new Date(ext.capture.capturedAt)).day===ist(now).day)return {action:'idle',reason:'POSITIONS_CURRENT',account:input.account};
    if(!ext.request||Date.parse(ext.request.expiresAt)<+now)ext.request={id:randomBytes(24).toString('base64url'),issuedAt:now.toISOString(),expiresAt:new Date(+now+180000).toISOString()};
    await vault.save();return {action:'capture',account:input.account,requestId:ext.request.id,expiresAt:ext.request.expiresAt};
   }
   this.request(ext,input,now);
   if(action==='unlock'){
    if(secret.pinAttemptPending||ext.request.pinIssued)fail('PIN_CHECK_REQUIRED');if(!/^\d{4}$/.test(secret.pin||''))fail('PIN_REQUIRED');
    secret.pinAttemptPending=true;ext.request.pinIssued=true;await vault.save();return {pin:secret.pin};
   }
   if(action==='result'){
    if(!Array.isArray(input.rows)||input.rows.length>2000||input.rows.length===0&&input.emptyVerified!==true)fail('PARTIAL_HOLDINGS');
    const captured=Date.parse(input.capturedAt);if(!Number.isFinite(captured)||captured< Date.parse(ext.request.issuedAt)-5000||captured>+now+300000)fail('CAPTURE_TIME_INVALID');
    const fields=['groww_slug','name','qty','invested','avg_price','reference_price','reference_value'];
    const rows=input.rows.map(r=>Object.fromEntries(fields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));validateProgressive({dataset:'portfolio.positions',tables:{positions:rows}});
    ext.capture={rows,capturedAt:new Date(captured).toISOString(),requestId:ext.request.id};ext.request=null;ext.manualRequestedAt=null;ext.lastError=null;ext.retryAt=null;secret.pinAttemptPending=false;
    const state=await this.deps.readJSON(join(this.home,'state.json'),{});if(state.blocked)delete state.blocked[input.account];await vault.save();await this.deps.atomicJSON(join(this.home,'state.json'),state);accepted=true;return {accepted:true,positions:rows.length,capturedAt:ext.capture.capturedAt};
   }
   if(action==='error'){
    ext.lastError=codes.has(input.code)?input.code:'GROWW_UNAVAILABLE';ext.retryAt=new Date(+now+(['AUTH_REQUIRED','PIN_REJECTED','PIN_CHECK_REQUIRED'].includes(ext.lastError)?3600000:600000)).toISOString();ext.request=null;ext.manualRequestedAt=null;await vault.save();return {recorded:true};
   }
   fail('UNKNOWN_BRIDGE_ACTION');
  });
  if(accepted)Promise.resolve().then(()=>this.deps.afterCapture()).catch(()=>{});return response;
 }
}
