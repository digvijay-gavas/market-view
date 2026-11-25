// Developer script runner (switched on for a limited time from the local admin board). Waits for
// jobs from the paired local collector and runs each one in a groww.in / smallcases.groww.in tab of
// this profile, in the page's own JavaScript context, returning the script's (JSON) result.
const HOSTS=['groww.in','smallcases.groww.in'];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function allowedUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&HOSTS.includes(u.hostname)&&!u.port&&!u.username;}catch{return false;}}

// Runs inside the page (MAIN world). The script body may use `await` and `return` a value.
export async function pageRunner(code){
 try{
  const value=await (new Function('return (async()=>{\n'+code+'\n})()'))();
  let json=JSON.stringify(value===undefined?null:value);
  if(json===undefined)json='null';
  if(json.length>900000)json=JSON.stringify({truncated:true,length:json.length,preview:json.slice(0,900000)});
  return {ok:true,json,finalUrl:location.href};
 }catch(error){return {ok:false,error:String(error?.stack||error).slice(0,4000),finalUrl:location.href};}
}

export async function runJob(chromeApi,job,{delay=pause}={}){
 if(!allowedUrl(job.url))return {ok:false,error:'SCRIPT_URL_NOT_ALLOWED'};
 const windows=await chromeApi.windows.getAll({windowTypes:['normal']});
 const tab=windows.length?await chromeApi.tabs.create({url:job.url,active:false}):(await chromeApi.windows.create({url:job.url,focused:false,state:'minimized'})).tabs[0];
 try{
  const deadline=Date.now()+job.timeoutMs;
  for(;;){const t=await chromeApi.tabs.get(tab.id);if(t.status==='complete')break;if(Date.now()>deadline)return {ok:false,error:'SCRIPT_PAGE_TIMEOUT'};await delay(500);}
  const t=await chromeApi.tabs.get(tab.id);if(!allowedUrl(t.url||''))return {ok:false,error:'SCRIPT_REDIRECTED_OFF_SITE',finalUrl:String(t.url||'').slice(0,200)};
  if(job.settleMs)await delay(job.settleMs);
  const run=chromeApi.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:pageRunner,args:[job.code]}).then(r=>r[0]?.result||{ok:false,error:'SCRIPT_NO_RESULT'});
  const timer=delay(Math.max(1000,deadline-Date.now())).then(()=>({ok:false,error:'SCRIPT_TIMEOUT'}));
  return await Promise.race([run,timer]);
 }catch(error){return {ok:false,error:String(error?.message||error).slice(0,1000)};}
 finally{if(!job.keepTab)await chromeApi.tabs.remove(tab.id).catch(()=>{});}
}

// Long-polls the collector while the runner is on; returns when it is switched off.
export async function scriptLoop(chromeApi,api,{onJob=()=>{}}={}){
 for(;;){
  const r=await api('script-wait',{}).catch(()=>null);
  if(!r?.enabled)return;
  if(!r.job)continue;
  onJob(true);
  try{const result=await runJob(chromeApi,r.job);await api('script-result',{id:r.job.id,...result}).catch(()=>{});}
  finally{onJob(false);}  // only after the result is sent (an update may reload the extension)
 }
}
