import {createCipheriv,createDecipheriv,randomBytes,scryptSync,createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export const REPO=resolve(fileURLToPath(new URL('../',import.meta.url)));
export function outsideRepo(path){const full=resolve(path),rel=relative(REPO,full);if(!rel||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)))throw new Error('Private collector state must be outside the source repository.');return full;}
export function defaultHome(){return outsideRepo(join(process.env.LOCALAPPDATA||join(process.env.HOME||process.env.USERPROFILE||'.','.local','share'),'MarketViewCollector'));}
export function seal(value,key,aad='market-view-vault-v1'){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
 return {version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
}
export function unseal(doc,key,aad='market-view-vault-v1'){
 if(doc?.version!==1||typeof doc.data!=='string'||doc.data.length>128*1024*1024)throw new Error('Invalid encrypted vault');
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(doc.iv,'base64'));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(doc.tag,'base64'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(doc.data,'base64')),decipher.final()]).toString());
}
export function portableSeal(value,password){if(password.length<12)throw new Error('Use a master passphrase of at least 12 characters, not a short PIN.');const salt=randomBytes(16),key=scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});return {version:1,kdf:'scrypt-32768-8-1',salt:salt.toString('base64'),payload:seal(value,key,'market-view-portable-v1')};}
export function portableOpen(doc,password){if(doc?.version!==1||doc.kdf!=='scrypt-32768-8-1'||Buffer.from(doc.salt||'','base64').length!==16)throw new Error('Invalid transfer bundle');return unseal(doc.payload,scryptSync(password,Buffer.from(doc.salt,'base64'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024}),'market-view-portable-v1');}
export async function atomicJSON(path,value){await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});const tmp=path+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,path);}
export function credential(operation,target,value){
 if(process.platform!=='win32')throw new Error('Unattended vault unlocking requires Windows Credential Manager.');
 if(!/^MarketView\/Collector\/[a-f0-9]{16}$/.test(target))throw new Error('Invalid collector credential target');
 return new Promise((resolvePromise,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('wincred.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';
  child.stdout.on('data',b=>{out+=b;if(out.length>10000)child.kill();});child.stderr.resume();child.on('error',()=>reject(new Error('Windows Credential Manager helper unavailable.')));
  child.on('exit',code=>code===0?resolvePromise(out.trim()):reject(new Error('Windows Credential Manager operation failed.')));child.stdin.end(JSON.stringify({operation,target,value}));
 });
}
export class Vault{
 constructor(home,{credentials=credential}={}){this.home=outsideRepo(home);this.path=join(this.home,'secrets.enc.json');this.credentials=credentials;this.target='MarketView/Collector/'+createHash('sha256').update(this.home.toLowerCase()).digest('hex').slice(0,16);}
 async open(create=false){let encoded=await this.credentials('get',this.target);if(!encoded){if(!create)throw new Error('Run collector init to create this machine vault.');encoded=randomBytes(32).toString('base64');await this.credentials('set',this.target,encoded);}this.key=Buffer.from(encoded,'base64');if(this.key.length!==32)throw new Error('Invalid vault key');try{this.data=unseal(JSON.parse(await readFile(this.path,'utf8')),this.key);}catch(e){if(e.code!=='ENOENT')throw new Error('Could not unlock the collector vault.');this.data={version:1,accounts:{}};}return this;}
 async save(){await atomicJSON(this.path,seal(this.data,this.key));}
}
