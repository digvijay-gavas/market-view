import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {defaultHome,outsideRepo} from './vault.mjs';
export async function ensureBridge(home=defaultHome()){
 home=outsideRepo(home);
 try{const current=JSON.parse(await readFile(join(home,'admin-instance.json'),'utf8'));if(current.port===5186&&typeof current.key==='string'){const response=await fetch('http://127.0.0.1:5186/api/alive',{headers:{'X-Admin-Key':current.key},redirect:'error',signal:AbortSignal.timeout(2000)});if(response.ok)return;}}catch{}
 const child=spawn(process.execPath,[fileURLToPath(new URL('admin.mjs',import.meta.url)),'--no-open','--home',home],{detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>{});child.unref();
}
