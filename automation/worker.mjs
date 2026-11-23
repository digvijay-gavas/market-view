import {readFile,mkdir,rmdir,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hostname} from 'node:os';
import {Vault,atomicJSON} from './vault.mjs';
import {duePlan,nextDelay,ist} from './schedule.mjs';
import {capturePositions} from './browser.mjs';
import {fetchQuotes,universe} from './prices.mjs';
import {Publisher,FileBodyCache,accessToken} from './drive.mjs';
import {positionRows,positionChanges} from '../src/progressive.js';
export async function readJSON(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
export async function lock(home){
 const dir=join(home,'run.lock');await mkdir(home,{recursive:true,mode:0o700});
 try{await mkdir(dir);}catch(error){
  if(error.code!=='EEXIST')throw error;const owner=await readJSON(join(dir,'owner.json'),null);
  if(!owner){if(Date.now()-(await stat(dir)).mtimeMs<60000)return null;try{await rmdir(dir);}catch{return null;}return lock(home);}try{process.kill(owner.pid,0);return null;}catch(error){if(error.code!=='ESRCH')return null;await unlink(join(dir,'owner.json'));await rmdir(dir);return lock(home);}
 }
 await atomicJSON(join(dir,'owner.json'),{pid:process.pid,at:new Date().toISOString()});
 return async()=>{await unlink(join(dir,'owner.json'));await rmdir(dir);};
}
export function validateConfig(config){
 if(config?.version!==1||!Array.isArray(config.accounts)||!config.accounts.length||!config.schedule)throw new Error('CONFIG_INVALID');
 const ids=new Set();for(const a of config.accounts){if(!/^[a-z0-9_-]+$/.test(a.id)||ids.has(a.id))throw new Error('CONFIG_INVALID');ids.add(a.id);}
 if(config.rootId&&!/^[A-Za-z0-9_-]+$/.test(config.rootId))throw new Error('CONFIG_INVALID');
 if(!['groww-public','groww-api'].includes(config.priceProvider))throw new Error('CONFIG_INVALID');nextDelay(config.schedule,()=>0);return config;
}
export async function runCycle({config,state,vault,publisher,home,calendar,now=new Date(),force=false,positionsNow=false,capture=capturePositions,quotes=fetchQuotes,persist=async()=>{}}={}){
 validateConfig(config);const plan=duePlan(config,state,calendar,now,force);if(!plan.due)return {ran:false,reason:plan.reason,state};
 if(!config.rootId)throw new Error('STORE_ROOT_REQUIRED');
 state.positions||={};state.blocked||={};state.instruments||={};state.accounts||={};
 const checkpoint={version:1,writer:hostname(),startedAt:now.toISOString(),positionAccounts:[],quoteState:'pending'};
 await publisher.ensureCatalog();const baselines=[];
 for(const account of config.accounts.filter(a=>a.enabled!==false)){
  let previous=await publisher.latest('portfolio.positions',account.id);
  if(!previous){const legacy=await publisher.latest('groww.live_holdings',account.id);if(legacy)previous={...legacy,dataset:'portfolio.positions',tables:{positions:positionRows(legacy)}};}
  const currentDay=previous?ist(new Date(previous.captured_at)).day:null;
  const needs=positionsNow||currentDay!==plan.day;
  if(vault.data.accounts[account.id]?.pinAttemptPending)state.blocked[account.id]='PIN_CHECK_REQUIRED';
  if(needs&&!state.blocked[account.id]){
   try{
    const captureResult=await capture(home,account,vault.data.accounts[account.id],{channel:config.browserChannel,headless:true,onPinAttempt:async()=>{vault.data.accounts[account.id].pinAttemptPending=true;await vault.save();}});
    const published=await publisher.publish('portfolio.positions',account.id,{positions:captureResult.rows},{},now);
    if(previous){const changes=positionChanges(previous,published.doc);if(changes.length)await publisher.publish('portfolio.position_changes',account.id,{changes},{interval_start:previous.captured_at,interval_end:now.toISOString(),note:'Observed position changes; not verified trades.'},now);}
    if(config.legacyCompatibility!==false){const rows=captureResult.rows.map(r=>({groww_slug:r.groww_slug,name:r.name,qty:r.qty,avg_price:r.avg_price,ltp:r.reference_price,current_value:r.reference_value,invested:r.invested}));await publisher.publish('groww.live_holdings',account.id,{holdings:rows},{},now);}
    const secret=vault.data.accounts[account.id];secret.storageState=captureResult.storageState;secret.restore=false;secret.pinAttemptPending=false;
    previous=published.doc;state.positions[account.id]={day:plan.day,capturedAt:now.toISOString(),hash:published.doc.content_hash};state.accounts[account.id]='ok';
   }catch(error){const code=['PIN_REJECTED','PIN_REQUIRED','PIN_INPUT_CHANGED','AUTH_REQUIRED','PROFILE_SETUP_REQUIRED','PARTIAL_HOLDINGS','HOLDINGS_TIMEOUT'].includes(error.code)?error.code:'POSITION_CAPTURE_FAILED';state.accounts[account.id]=code;if(['PIN_REJECTED','PIN_REQUIRED','PIN_INPUT_CHANGED','AUTH_REQUIRED','PROFILE_SETUP_REQUIRED'].includes(code))state.blocked[account.id]=code;}
  }else state.accounts[account.id]=state.blocked[account.id]||'reused';
  await vault.save();await persist(state);
  if(previous)baselines.push(previous);
  checkpoint.positionAccounts.push({account:account.id,state:state.accounts[account.id],capturedAt:previous?.captured_at||null});
 }
 if(!baselines.length)throw new Error('NO_POSITION_BASELINE');
 const priorPrices=await publisher.latest('market.prices','shared');
 let priceResult;
 try{
  priceResult=await quotes(universe(baselines),{provider:config.priceProvider,instruments:state.instruments,token:vault.data.growwApi?.token,previous:priorPrices?.tables.quotes||[],now});
  state.instruments=priceResult.instruments;checkpoint.quoteState=priceResult.fresh?'updated':'stale';checkpoint.freshQuotes=priceResult.fresh;checkpoint.failedQuotes=priceResult.failures.length;
  if(priceResult.fresh)await publisher.publish('market.prices','shared',{quotes:priceResult.quotes},{provider:config.priceProvider},now);
 }catch{checkpoint.quoteState='PRICE_FETCH_FAILED';}
 const cacheResult=await publisher.compileCache();checkpoint.cache=cacheResult.reused?'reused':'rebuilt';
 delete state.lastError;state.lastRunAt=now.toISOString();state.nextRunAt=new Date(+now+Math.max(nextDelay(config.schedule),priceResult?.retryAfterMs||0)).toISOString();
 checkpoint.completedAt=new Date().toISOString();checkpoint.nextRunAt=state.nextRunAt;await publisher.status(checkpoint);await vault.save();
 return {ran:true,state,checkpoint};
}
export async function run(home,{force=false,positionsNow=false,dryRun=false}={}){
 const config=validateConfig(await readJSON(join(home,'config.json'),null)),state=await readJSON(join(home,'state.json'),{}),calendar=config.calendar||await readJSON(new URL('calendar.json',import.meta.url));
 const plan=duePlan(config,state,calendar,new Date(),force);if(dryRun||!plan.due)return {ran:false,...plan};
 const release=await lock(home);if(!release)return {ran:false,reason:'ALREADY_RUNNING'};
 try{
  Object.assign(config,validateConfig(await readJSON(join(home,'config.json'),null)));
  const recheck=duePlan(config,state,calendar,new Date(),force);if(!recheck.due)return {ran:false,...recheck};
  Object.assign(state,await readJSON(join(home,'state.json'),{}));const vault=await new Vault(home).open();const token=await accessToken(vault.data.google);
  const publisher=new Publisher(token,config.rootId,{cache:new FileBodyCache(home)});
  const result=await runCycle({config,state,vault,publisher,home,calendar,force,positionsNow,persist:s=>atomicJSON(join(home,'state.json'),s)});await atomicJSON(join(home,'state.json'),result.state);return result;
 }catch(error){state.lastError={at:new Date().toISOString(),code:/^[A-Z_]+$/.test(error.message)?error.message:'COLLECTOR_FAILED'};state.nextRunAt=new Date(Date.now()+600000).toISOString();await atomicJSON(join(home,'state.json'),state);throw new Error(state.lastError.code);}
 finally{await release();}
}
