// Developer script runner: runs a short script inside a Groww page of a paired Chrome profile, to
// explore a page before changing the extension. Off by default; switched on from the admin board
// for a limited time (and off again when the admin process restarts). Only https://groww.in and
// https://smallcases.groww.in pages. Every script and result is appended to script-runner.log in
// the collector home. Intended for reading pages; it never handles the PIN.
import {appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';

export const SCRIPT_HOSTS=['groww.in','smallcases.groww.in'];
export const MAX_CODE=100*1024, MAX_RESULT=1024*1024, MAX_MINUTES=120;
const fail=code=>{throw Object.assign(new Error(code),{status:400});};
export function scriptUrl(value){
 let u;try{u=new URL(String(value||''));}catch{fail('SCRIPT_URL_INVALID');}
 if(u.protocol!=='https:'||!SCRIPT_HOSTS.includes(u.hostname)||u.username||u.password||u.port)fail('SCRIPT_URL_NOT_ALLOWED');
 return u.href;
}

export class ScriptRunner{
 constructor(home,{now=()=>Date.now(),log=line=>appendFile(join(home,'script-runner.log'),line+'\n',{mode:0o600})}={}){
  Object.assign(this,{home,now,log});this.until=0;this.jobs=new Map();this.waiters=new Map();
 }
 get enabled(){return this.until>this.now();}
 enable(minutes=30){
  if(!Number.isInteger(minutes)||minutes<1||minutes>MAX_MINUTES)fail('SCRIPT_MINUTES_INVALID');
  this.until=this.now()+minutes*60000;this.audit({event:'enabled',until:new Date(this.until).toISOString()});return this.status();
 }
 disable(){this.until=0;for(const job of this.jobs.values())if(job.state==='queued'){job.state='cancelled';job.error='RUNNER_DISABLED';}this.audit({event:'disabled'});this.wake();return this.status();}
 submit({account,url,code,keepTab=false,settleMs=1500,timeoutMs=60000},accounts=[]){
  if(!this.enabled)fail('SCRIPT_RUNNER_OFF');
  if(typeof account!=='string'||!accounts.includes(account))fail('UNKNOWN_ACCOUNT');
  if(typeof code!=='string'||!code.trim()||code.length>MAX_CODE)fail('SCRIPT_CODE_INVALID');
  const job={id:randomBytes(12).toString('hex'),account,url:scriptUrl(url),code,keepTab:keepTab===true,
   settleMs:Math.min(Math.max(Number(settleMs)||0,0),30000),timeoutMs:Math.min(Math.max(Number(timeoutMs)||60000,5000),180000),
   state:'queued',createdAt:new Date(this.now()).toISOString()};
  this.jobs.set(job.id,job);this.trim();
  this.audit({event:'submitted',id:job.id,account,url:job.url,sha256:createHash('sha256').update(code).digest('hex'),code});
  this.wake(account);return this.view(job);
 }
 // Extension side: wait (long poll) for the next job for this account.
 async take(account,waitMs=20000){
  const deadline=this.now()+waitMs;
  for(;;){
   if(!this.enabled)return {enabled:false};
   const job=[...this.jobs.values()].find(j=>j.account===account&&j.state==='queued');
   if(job){job.state='running';job.startedAt=new Date(this.now()).toISOString();
    return {enabled:true,until:new Date(this.until).toISOString(),job:{id:job.id,url:job.url,code:job.code,keepTab:job.keepTab,settleMs:job.settleMs,timeoutMs:job.timeoutMs}};}
   const left=deadline-this.now();if(left<=0)return {enabled:true,until:new Date(this.until).toISOString(),job:null};
   await new Promise(resolve=>{const list=this.waiters.get(account)||[];list.push(resolve);this.waiters.set(account,list);setTimeout(resolve,Math.min(left,5000));});
  }
 }
 complete(account,input){
  const job=this.jobs.get(String(input?.id||''));if(!job||job.account!==account||job.state!=='running')fail('SCRIPT_JOB_UNKNOWN');
  const json=typeof input.json==='string'?input.json:null;
  if(json!==null&&json.length>MAX_RESULT)fail('SCRIPT_RESULT_TOO_LARGE');
  Object.assign(job,{state:input.ok===true?'done':'failed',finishedAt:new Date(this.now()).toISOString(),json,error:input.ok===true?null:String(input.error||'SCRIPT_FAILED').slice(0,4000),finalUrl:typeof input.finalUrl==='string'?input.finalUrl.slice(0,500):null});
  this.audit({event:job.state,id:job.id,account,bytes:json?.length||0,error:job.error,finalUrl:job.finalUrl});
  return {accepted:true};
 }
 get(id){const job=this.jobs.get(String(id||''));if(!job)fail('SCRIPT_JOB_UNKNOWN');return {...this.view(job),json:job.json??null,error:job.error??null,finalUrl:job.finalUrl??null};}
 status(){return {enabled:this.enabled,until:this.enabled?new Date(this.until).toISOString():null,recent:[...this.jobs.values()].slice(-8).reverse().map(j=>this.view(j))};}
 view(j){return {id:j.id,account:j.account,url:j.url,state:j.state,createdAt:j.createdAt,finishedAt:j.finishedAt||null,error:j.error||null};}
 wake(account){for(const [key,list] of this.waiters)if(!account||key===account){this.waiters.delete(key);for(const r of list)r();}}
 trim(){while(this.jobs.size>50)this.jobs.delete(this.jobs.keys().next().value);}
 audit(entry){this.log(JSON.stringify({at:new Date(this.now()).toISOString(),...entry})).catch?.(()=>{});}
}
