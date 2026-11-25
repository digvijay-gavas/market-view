import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {defaultHome,outsideRepo} from './vault.mjs';
const alive=async home=>{try{const current=JSON.parse(await readFile(join(home,'admin-instance.json'),'utf8'));if(current.port!==5186||typeof current.key!=='string')return false;const response=await fetch('http://127.0.0.1:5186/api/alive',{headers:{'X-Admin-Key':current.key},redirect:'error',signal:AbortSignal.timeout(2000)});return response.ok;}catch{return false;}};
// Managed and scheduled runs open Chrome on http://127.0.0.1:5186/runner, served by the admin
// process (which also hosts the extension bridge). Start it hidden if it is not running and wait
// until it answers. Never under `node --test`.
export async function ensureBridge(home=defaultHome(),{waitMs=20000}={}){
 if(process.env.NODE_TEST_CONTEXT)return true;
 home=outsideRepo(home);
 if(await alive(home))return true;
 const child=spawn(process.execPath,[fileURLToPath(new URL('admin.mjs',import.meta.url)),'--no-open','--home',home],{detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>{});child.unref();
 for(const end=Date.now()+waitMs;Date.now()<end;){await new Promise(r=>setTimeout(r,500));if(await alive(home))return true;}
 throw new Error('BRIDGE_NOT_STARTED');
}
