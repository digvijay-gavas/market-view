import {access} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {normalChromeRoot} from './profiles.mjs';
export function profileName(hint){const name=String(hint||'').replace(/^legacy:/,'').replaceAll('_',' ');if(!/^(?:Default|Profile [0-9]+|Bunny)$/.test(name))throw new Error('CHROME_PROFILE_NOT_LINKED');return name;}
export async function openChromeExtensions(hint){return launchChrome(hint,'chrome://extensions/');}
export async function openCollectionChrome(hint,extensionId,ticket){
 if(!/^[a-p]{32}$/.test(extensionId)||!(/^[a-f0-9]{48}$/).test(ticket))throw new Error('INVALID_RUNNER');
 return launchChrome(hint,'http://127.0.0.1:5186/runner#'+ticket,true);
}
async function launchChrome(hint,url,collection=false){
 if(process.platform!=='win32')throw new Error('OPEN_CHROME_MANUALLY');const profile=profileName(hint);await access(join(normalChromeRoot(),profile));
 const candidates=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(root=>join(root,'Google','Chrome','Application','chrome.exe'));let executable;
 for(const path of candidates){try{await access(path);executable=path;break;}catch{}}
 if(!executable)throw new Error('CHROME_NOT_INSTALLED');
 // Ordinary user-controlled Chrome: no debugger, automation, cookie export or security flags.
 const child=spawn(executable,['--profile-directory='+profile,...(collection?['--new-window','--start-minimized']:[]),url],{detached:true,windowsHide:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
