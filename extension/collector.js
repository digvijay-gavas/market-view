import {probePage,extractHoldings,HOLDINGS_URL,fillPinInPage,scrollHoldings} from './holdings.js';
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=code=>{throw new Error(code);};
export async function captureHoldings(chromeApi,api,plan,{delay=pause,now=Date.now,timeoutMs=90000,windowId}={}){
 const tab=await chromeApi.tabs.create({url:HOLDINGS_URL,active:false,...(Number.isInteger(windowId)?{windowId}:{})});let attempted=false,empty=0,stable=0,previous=-1;
 const evaluate=async(func,args=[])=>{const current=await chromeApi.tabs.get(tab.id);if(!current.url?.startsWith('https://groww.in/'))fail('AUTH_REQUIRED');const result=await chromeApi.scripting.executeScript({target:{tabId:tab.id},func,args});return result[0]?.result;};
 try{
  const deadline=now()+timeoutMs;
  while(now()<deadline){
   const current=await chromeApi.tabs.get(tab.id);if(current.status!=='complete'||!current.url||current.url==='about:blank'){await delay(1000);continue;}
   const probe=await evaluate(probePage);if(!probe)fail('GROWW_UNAVAILABLE');if(probe.rejected)fail('PIN_REJECTED');if(probe.challenge)fail('AUTH_REQUIRED');
   if(probe.pin){if(attempted)fail('PIN_REJECTED');attempted=true;let response=await api('unlock',{requestId:plan.requestId});let pin=response.pin;response=null;try{const result=await evaluate(fillPinInPage,[pin]);if(result?.error)fail(result.error);}finally{pin=null;}await delay(1500);continue;}
   if(probe.signedOut)fail('AUTH_REQUIRED');
   if(probe.rows&&!probe.pending){
    await evaluate(scrollHoldings);
    if(probe.rows===previous){if(++stable>=3){const parsed=await evaluate(extractHoldings);if(parsed?.error||!parsed?.rows?.length)fail('PARTIAL_HOLDINGS');return {rows:parsed.rows,emptyVerified:false,capturedAt:new Date(now()).toISOString()};}}else stable=0;
    previous=probe.rows;
   }else if(probe.empty&&!probe.busy&&!probe.pending){if(++empty>=3)return {rows:[],emptyVerified:true,capturedAt:new Date(now()).toISOString()};}
   else{empty=0;stable=0;}await delay(1000);
  }
  fail('HOLDINGS_TIMEOUT');
 }finally{await chromeApi.tabs.remove(tab.id).catch(()=>{});}
}
export async function collectCycle(chromeApi,api,manual=false,options={}){
 const plan=await api('poll',{manual,...(options.runnerTicket?{runnerTicket:options.runnerTicket}:{})});if(plan.action!=='capture')return {state:plan.action,reason:plan.reason,account:plan.account};
 try{const capture=await captureHoldings(chromeApi,api,plan,options),result=await api('result',{...capture,requestId:plan.requestId});return {state:'captured',positions:result.positions,capturedAt:result.capturedAt,account:plan.account};}
 catch(error){const code=/^[A-Z_]+$/.test(error.message||'')?error.message:'GROWW_UNAVAILABLE';await api('error',{requestId:plan.requestId,code}).catch(()=>{});return {state:'attention',reason:code,account:plan.account};}
}
