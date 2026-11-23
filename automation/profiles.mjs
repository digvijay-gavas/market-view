import {readdir,stat,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {REPO,outsideRepo} from './vault.mjs';
const inside=(root,path)=>{const r=relative(root,path);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
export function normalChromeRoot(){return resolve(process.env.LOCALAPPDATA||join(process.env.USERPROFILE||'.','AppData','Local'),'Google','Chrome','User Data');}
export async function reusableProfile(path,{chromeRoot=normalChromeRoot()}={}){
 const full=await realpath(path),normal=await realpath(chromeRoot).catch(()=>resolve(chromeRoot));
 if(inside(normal,full))throw new Error('NORMAL_CHROME_PROFILE_UNSUPPORTED');outsideRepo(full);
 if(!(await stat(join(full,'Default'))).isDirectory()||!(await stat(join(full,'Local State'))).isFile())throw new Error('SAVED_PROFILE_UNAVAILABLE');return full;
}
export async function savedProfiles({root=resolve(REPO,'../market/data/cache/chrome'),chromeRoot}={}){
 const entries=await readdir(root,{withFileTypes:true}).catch(()=>[]),result=[];
 for(const entry of entries){if(!entry.isDirectory()||!/^[-A-Za-z0-9_ ]{1,80}$/.test(entry.name))continue;
  try{const path=await reusableProfile(join(root,entry.name),{chromeRoot});result.push({id:'legacy:'+entry.name,label:'Saved collector · '+entry.name.replaceAll('_',' '),path});}catch{}
 }
 return result.sort((a,b)=>a.label.localeCompare(b.label));
}
