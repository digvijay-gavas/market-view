// `node automation/cli.mjs script <account> <url> <file|-> [--keep-tab] [--settle <ms>] [--timeout <ms>]`
// Submits a script to the running admin process (the runner must be switched on in the admin
// board) and prints its JSON result. Uses the local admin key, like the admin page.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function scriptCommand(home,args){
 const [account,url,file]=args;if(!account||!url||!file)throw new Error('USAGE: script <account> <url> <file|-> [--keep-tab] [--settle ms] [--timeout ms]');
 const flag=name=>{const i=args.indexOf(name);return i>=0?Number(args[i+1]):undefined;};
 const code=file==='-'?await new Promise(r=>{let s='';process.stdin.on('data',d=>s+=d).on('end',()=>r(s));}):await readFile(file,'utf8');
 const inst=JSON.parse(await readFile(join(home,'admin-instance.json'),'utf8')),base='http://127.0.0.1:'+inst.port;
 const s=await fetch(base+'/api/session',{method:'POST',headers:{'X-Admin-Key':inst.key,Origin:base}});if(!s.ok)throw new Error('ADMIN_NOT_RUNNING');
 const headers={'X-Collector-Admin':'1',Cookie:s.headers.get('set-cookie').split(';')[0]};
 const r=await fetch(base+'/api/script',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:base},body:JSON.stringify({op:'run',account,url,code,keepTab:args.includes('--keep-tab'),settleMs:flag('--settle'),timeoutMs:flag('--timeout')})});
 const job=await r.json();if(!r.ok)throw new Error(job.error||'SCRIPT_SUBMIT_FAILED');
 for(const end=Date.now()+(flag('--timeout')||60000)+60000;Date.now()<end;){
  await new Promise(res=>setTimeout(res,1000));
  const g=await (await fetch(base+'/api/script?id='+job.id,{headers})).json();
  if(['done','failed','cancelled'].includes(g.state)){
   let value=g.json;try{value=JSON.parse(g.json);}catch{}
   return {state:g.state,finalUrl:g.finalUrl,error:g.error,result:value};
  }
 }
 return {state:'waiting',note:'No result yet: is Chrome open for this profile with extension 1.4.0?',id:job.id};
}
