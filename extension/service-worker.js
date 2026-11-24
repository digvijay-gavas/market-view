import {collectCycle} from './collector.js';
import {closeOwnedWindow} from './owned-window.js';
const owned=new Set();
async function runOwned(tab,ticket){if(owned.has(ticket))return {state:'busy'};owned.add(ticket);try{const tabs=await chrome.tabs.query({windowId:tab.windowId});if(tabs.length===1&&tabs[0].id===tab.id)await chrome.windows.update(tab.windowId,{state:'minimized'});return await collect(true,{windowId:tab.windowId,runnerTicket:ticket});}finally{owned.delete(ticket);await closeOwnedWindow(chrome,tab).catch(()=>{});}}
let busy=false;
async function settings(){const data=await chrome.storage.local.get(['pairing','clientId','bridgePort']);if(!data.clientId){data.clientId=crypto.randomUUID();await chrome.storage.local.set({clientId:data.clientId});}return data;}
async function api(action,body={}){
 const data=await settings(),port=Number.isInteger(data.bridgePort)&&data.bridgePort>0&&data.bridgePort<65536?data.bridgePort:5186;
 const response=await fetch('http://127.0.0.1:'+port+'/bridge/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Market-Extension':chrome.runtime.id,...(data.pairing?{Authorization:'Bearer '+data.pairing.token}:{})},body:JSON.stringify({clientId:data.clientId,version:chrome.runtime.getManifest().version,...(data.pairing?{account:data.pairing.account}:{}),...body}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'LOCAL_COLLECTOR_UNAVAILABLE');return result;
}
async function collect(manual=false,options={}){
 if(busy)return {state:'busy'};const {pairing}=await settings();if(!pairing?.confirmed)return {state:'unpaired'};busy=true;
 try{const result=await collectCycle(chrome,api,manual,options);await chrome.storage.local.set({lastResult:result});await chrome.action.setBadgeText({text:result.state==='attention'?'!':''});return result;}
 catch(error){const result={state:'attention',reason:/^[A-Z_]+$/.test(error.message||'')?error.message:'LOCAL_COLLECTOR_UNAVAILABLE'};await chrome.storage.local.set({lastResult:result});return result;}
 finally{busy=false;}
}
chrome.runtime.onInstalled.addListener(details=>{if(details.reason==='install')chrome.tabs.create({url:chrome.runtime.getURL('popup.html')});});
chrome.alarms.clear('daily-positions');
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!sender.url||(!sender.url.startsWith(chrome.runtime.getURL(''))&&message.action!=='managed'))return false;
 const work=async()=>{
  if(message.action==='managed'){
   const data=await settings(),local='http://127.0.0.1:'+(data.bridgePort||5186)+'/runner';
   if(!sender.tab||!(sender.url===local||sender.url.startsWith(local+'#'))||!(/^[a-f0-9]{48}$/).test(message.ticket||''))throw new Error('INVALID_RUNNER');
   return runOwned(sender.tab,message.ticket);
  }
  if(message.action==='status'){const data=await settings();return {account:data.pairing?.account,confirmed:Boolean(data.pairing?.confirmed),version:chrome.runtime.getManifest().version,lastResult:(await chrome.storage.local.get('lastResult')).lastResult,busy};}
  if(message.action==='pair'){const result=await api('pair',{code:String(message.code||'')});await chrome.storage.local.set({pairing:result});return {account:result.account,confirmed:false};}
  if(message.action==='confirm'){const result=await api('confirm',{confirmed:message.confirmed===true});const data=await settings();await chrome.storage.local.set({pairing:{...data.pairing,confirmed:true}});collect(true);return result;}
  if(message.action==='collect')return collect(true);
  if(message.action==='open-groww'){await chrome.tabs.create({url:'https://groww.in/stocks/user/holdings',active:true});return {opened:true};}
  if(message.action==='forget'){await chrome.storage.local.remove(['pairing','lastResult']);return {forgotten:true};}
  throw new Error('UNKNOWN_ACTION');
 };
 work().then(result=>respond({ok:true,...result}),error=>respond({ok:false,error:/^[A-Z_]+$/.test(error.message||'')?error.message:'LOCAL_COLLECTOR_UNAVAILABLE'}));return true;
});
