import {join} from 'node:path';
import {Vault,atomicJSON} from './vault.mjs';
import {readJSON,lock,run,validateConfig} from './worker.mjs';
import {duePlan} from './schedule.mjs';
import {ExtensionBridge} from './extension-bridge.mjs';
import {openCollectionChrome} from './normal-chrome.mjs';
import {captureOperation} from './capture-operation.mjs';
import {runSummary} from './run-status.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function managedRun(home,{force=false,account,positionsNow=force}={},deps={}){
 const d={readJSON,atomicJSON,openVault:()=>new Vault(home).open(),lock:name=>lock(home,name),launch:openCollectionChrome,run,sleep,now:()=>new Date(),...deps};
 const release=await d.lock('managed.lock');if(!release)throw new Error('COLLECTOR_BUSY');
 let history,result,entry;const captures=[];
 try{
  const config=validateConfig(await d.readJSON(join(home,'config.json'))),state=await d.readJSON(join(home,'state.json'),{}),calendar=config.calendar||await d.readJSON(new URL('calendar.json',import.meta.url)),plan=duePlan(config,state,calendar,d.now(),force);
  if(!plan.due)return {ran:false,reason:plan.reason};
  if(account&&!config.accounts.some(a=>a.id===account))throw new Error('UNKNOWN_ACCOUNT');
  const vault=await d.openVault(),selected=config.accounts.filter(a=>a.enabled!==false&&(!account||a.id===account)&&(positionsNow||plan.positions.includes(a.id)));
  history=await d.readJSON(join(home,'sync-history.json'),[]);if(!Array.isArray(history))history=[];history=history.map(h=>h.phase==='running'?{...h,phase:'interrupted',completedAt:d.now().toISOString()}:h);entry={startedAt:d.now().toISOString(),source:force?'manual':'automatic',scope:account||'all',phase:'running',accounts:[]};
  const persist=()=>d.atomicJSON(join(home,'sync-history.json'),[entry,...history].slice(0,12));await persist();
  const bridge=deps.bridge||new ExtensionBridge(home);
  for(const a of selected){
   const item={account:a.id,phase:'running'};entry.accounts.push(item);await persist();let prepared;
   try{
    const ext=vault.data.accounts[a.id]?.extension;if(!ext?.confirmed)throw new Error('EXTENSION_NOT_PAIRED');
    if(!force&&Date.parse(ext.retryAt||'')>+d.now())throw new Error(ext.lastError||'RETRY_LATER');
    if(vault.data.accounts[a.id]?.pinAttemptPending)throw new Error('PIN_CHECK_REQUIRED');
    prepared=await bridge.prepareManaged(a.id);await d.launch(a.legacyProfileHint,prepared.extensionId,prepared.ticket);
    const openingDeadline=+d.now()+45000,deadline=+d.now()+210000;let op;
    do{await d.sleep(2000);const current=await d.openVault();op=captureOperation(current.data.accounts[a.id]?.extension,d.now());if(op?.id!==prepared.operationId)throw new Error('CAPTURE_SUPERSEDED');if(op.phase==='queued'&&+d.now()>openingDeadline)throw new Error('EXTENSION_OFFLINE');if(['captured','succeeded','failed'].includes(op.phase))break;}while(+d.now()<deadline);
    if(!['captured','succeeded'].includes(op?.phase))throw new Error(op?.error||'EXTENSION_OFFLINE');
    await bridge.finishManaged(a.id,prepared.operationId);item.phase='captured';item.positions=op.positions;captures.push({account:a.id,id:prepared.operationId});
   }catch(error){item.phase='failed';item.error=/^[A-Z_]+$/.test(error.message||'')?error.message:'CHROME_LAUNCH_FAILED';if(prepared)await bridge.finishManaged(a.id,prepared.operationId,item.error);}
   await persist();
  }
  result=await d.run(home,{force:true,positionsNow:positionsNow||selected.length>0});if(!result.ran)throw new Error(result.reason||'COLLECTOR_BUSY');
  const summary=runSummary(result.checkpoint);summary.partial||=entry.accounts.some(a=>a.phase==='failed');
  entry.phase=summary.partial?'partial':'succeeded';entry.cache=summary.cache;entry.quoteState=summary.quoteState;
  for(const a of entry.accounts)if(a.phase==='captured'){const published=result.checkpoint.positionAccounts.find(p=>p.account===a.account);if(published?.state==='ok')a.phase='synced';else {a.phase='failed';a.error='POSITION_SYNC_FAILED';summary.partial=true;entry.phase='partial';}}
  return {...summary,ran:true};
 }catch(error){if(entry){entry.phase='failed';entry.error=/^[A-Z_]+$/.test(error.message||'')?error.message:'SYNC_FAILED';for(const c of captures){await (deps.bridge||new ExtensionBridge(home)).finishManaged(c.account,c.id,entry.error,'publish').catch(()=>{});}}throw error;}
 finally{try{if(entry){entry.completedAt=d.now().toISOString();await d.atomicJSON(join(home,'sync-history.json'),[entry,...history].slice(0,12));}}finally{await release();}}
}
