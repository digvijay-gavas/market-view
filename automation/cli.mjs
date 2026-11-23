#!/usr/bin/env node
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {Vault,defaultHome,outsideRepo,atomicJSON,portableSeal,portableOpen} from './vault.mjs';
import {run,readJSON,lock,validateConfig} from './worker.mjs';
import {openProfile,waitReady,filterState,HOLDINGS_URL} from './browser.mjs';
import {accessToken} from './drive.mjs';
import {DriveReader} from '../src/drive.js';
import {installTask} from './task.mjs';
const exec=promisify(execFile);
function option(args,key,fallback){const i=args.indexOf('--'+key);return i<0?fallback:args[i+1];}
export function secretPrompt(prompt){
 if(!process.stdin.isTTY)throw new Error('A real terminal is required for secret entry. Never pass PINs or master passphrases in command arguments.');
 process.stdout.write(prompt);let value='';process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolvePrompt,reject)=>{const done=(error)=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolvePrompt(value);};const onData=b=>{for(const c of b.toString()){if(c==='\r'||c==='\n')return done();if(c==='\u0003')return done(new Error('CANCELLED'));if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' '&&value.length<8192)value+=c;}};process.stdin.on('data',onData);});
}
async function confirm(text){const io=createInterface({input:process.stdin,output:process.stdout});try{return (await io.question(text+' [yes/no] ')).trim().toLowerCase()==='yes';}finally{io.close();}}
export async function protectHome(home){
 await mkdir(home,{recursive:true,mode:0o700});if(process.platform!=='win32')return;
 const output=(await exec('whoami.exe',['/user','/fo','csv','/nh'],{windowsHide:true})).stdout,sid=output.match(/S-1-\d+(?:-\d+)+/)?.[0];
 if(!sid)throw new Error('WINDOWS_IDENTITY_REQUIRED');await exec('icacls.exe',[home,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{windowsHide:true});
}
export async function googleLogin(client,vault,{signal}={}){
 const c=client.installed;if(!c?.client_id)throw new Error('Use a Desktop app Google OAuth client JSON.');
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(24).toString('base64url');
 const server=createServer();await new Promise(resolveServer=>server.listen(0,'127.0.0.1',resolveServer));
 const redirect='http://127.0.0.1:'+server.address().port+'/callback';
 const codePromise=new Promise((resolveCode,reject)=>{
  let timer;const finish=(error,code)=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);server.close();error?reject(error):resolveCode(code);};
  const cancel=()=>finish(new Error('CANCELLED'));timer=setTimeout(()=>finish(new Error('GOOGLE_LOGIN_TIMEOUT')),300000);signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted){cancel();return;}
  server.on('request',(req,res)=>{const url=new URL(req.url,redirect);if(url.pathname!=='/callback'||url.searchParams.get('state')!==state){res.writeHead(400);res.end('Invalid authorization callback.');return;}const code=url.searchParams.get('code');res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end(code?'Signed in. You can return to Collector Admin.':'Authorization was not completed.');finish(code?null:new Error('GOOGLE_LOGIN_REQUIRED'),code);});
 });
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:c.client_id,redirect_uri:redirect,response_type:'code',scope:'https://www.googleapis.com/auth/drive',access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
 if(process.platform==='win32')execFile('rundll32.exe',['url.dll,FileProtocolHandler',url.toString()],{windowsHide:true},()=>{});else console.log('Open this Google authorization URL:',url.toString());
 const code=await codePromise;const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret||'',code,redirect_uri:redirect,code_verifier:verifier,grant_type:'authorization_code'}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('GOOGLE_LOGIN_REQUIRED');const data=await response.json();if(!data.refresh_token)throw new Error('GOOGLE_OFFLINE_CONSENT_REQUIRED');
 vault.data.google={client_id:c.client_id,client_secret:c.client_secret||'',refresh_token:data.refresh_token};await vault.save();
}
export async function main(args=process.argv.slice(2)){
 const command=args[0]||'help',home=outsideRepo(option(args,'home',defaultHome())),configPath=join(home,'config.json');
 if(command==='admin'){const {startAdmin}=await import('./admin.mjs');await startAdmin({home});return;}
 if(command==='help'){console.log('collector init | import-google FILE | google-login CLIENT.json | pin ACCOUNT | login ACCOUNT | run [--force] [--positions-now] [--dry-run] | status | enable | disable | install | export FILE | import FILE\nAll commands accept --home PRIVATE_DIRECTORY. Secrets are entered through masked terminal prompts, never CLI arguments.');return;}
 if(command==='init'){
  if(await readJSON(configPath,null))throw new Error('CONFIG_ALREADY_EXISTS');await protectHome(home);
  const accounts=String(option(args,'accounts','self')).split(',').map(id=>({id:id.trim(),enabled:true}));
  const config=validateConfig({version:1,enabled:false,rootId:option(args,'root',''),accounts,schedule:{open:'09:15',close:'15:30',intervalSeconds:600,jitterSeconds:60},priceProvider:'groww-public',browserChannel:'chrome',legacyCompatibility:true});
  const vault=await new Vault(home).open(true);await vault.save();await atomicJSON(configPath,config);console.log('Initialized encrypted collector state:',home);return;
 }
 if(command==='scheduled'){const {managedRun}=await import('./managed.mjs');const result=await managedRun(home);console.log(JSON.stringify({ran:result.ran,reason:result.reason}));return;}
 if(command==='run'){const result=await run(home,{force:args.includes('--force'),positionsNow:args.includes('--positions-now'),dryRun:args.includes('--dry-run')});console.log(JSON.stringify({ran:result.ran,reason:result.reason,checkpoint:result.checkpoint},null,2));return;}
 if(command==='status'){const config=await readJSON(configPath,null),state=await readJSON(join(home,'state.json'),{});console.log(JSON.stringify({home,enabled:config?.enabled,rootConfigured:Boolean(config?.rootId),accounts:config?.accounts.map(a=>({id:a.id,state:state.blocked?.[a.id]||state.accounts?.[a.id]||'not_enrolled',lastPosition:state.positions?.[a.id]?.capturedAt})),lastRunAt:state.lastRunAt,nextRunAt:state.nextRunAt,lastError:state.lastError},null,2));return;}
 const config=validateConfig(await readJSON(configPath,null));
 if(command==='disable'){config.enabled=false;await atomicJSON(configPath,config);console.log('Collector disabled.');return;}
 const release=await lock(home);if(!release)throw new Error('COLLECTOR_BUSY');
 try{
  const vault=await new Vault(home).open();
  if(command==='import-google'){
   const source=JSON.parse(await readFile(outsideRepo(args[1]),'utf8'));if(!source.refresh_token||!source.client_id)throw new Error('GOOGLE_OFFLINE_CREDENTIALS_REQUIRED');
   vault.data.google={client_id:source.client_id,client_secret:source.client_secret||'',refresh_token:source.refresh_token};await vault.save();
   console.log('Google offline credentials imported into the encrypted vault.');
  }else if(command==='google-login'){
   await googleLogin(JSON.parse(await readFile(args[1],'utf8')),vault);console.log('Google offline credentials saved in the encrypted vault.');
  }else if(command==='pin'){
   const account=config.accounts.find(a=>a.id===args[1]);if(!account)throw new Error('UNKNOWN_ACCOUNT');const pin=await secretPrompt('Groww PIN for '+account.id+' (hidden): ');if(!/^\d{4}$/.test(pin))throw new Error('PIN_MUST_HAVE_FOUR_DIGITS');
   vault.data.accounts[account.id]||={};vault.data.accounts[account.id].pin=pin;await vault.save();console.log('PIN saved encrypted. Use login to verify the profile and clear any PIN block.');
  }else if(command==='login'){
   const account=config.accounts.find(a=>a.id===args[1]);if(!account)throw new Error('UNKNOWN_ACCOUNT');
   const secret=vault.data.accounts[account.id]||={};
   const context=await openProfile(home,account.id,{channel:config.browserChannel,headless:false,profilePath:account.profileDirectory,restore:!account.profileDirectory&&secret.restore?secret.storageState:null});
   try{const page=context.pages()[0]||await context.newPage();await page.goto(HOLDINGS_URL,{waitUntil:'domcontentloaded'});console.log('Sign in to Groww in the dedicated '+account.id+' profile. Complete any OTP yourself.');await waitReady(page,{interactive:true,timeoutMs:900000});
    if(!await confirm('Confirm that the visible Groww account belongs to '+account.id+'?'))throw new Error('ACCOUNT_NOT_CONFIRMED');
    secret.bound=true;secret.restore=false;secret.pinAttemptPending=false;secret.storageState=filterState(await context.storageState({indexedDB:true}));await vault.save();const state=await readJSON(join(home,'state.json'),{});if(state.blocked)delete state.blocked[account.id];await atomicJSON(join(home,'state.json'),state);console.log('Dedicated account profile enrolled.');
   }finally{await context.close();}
  }else if(command==='api-token'){
   vault.data.growwApi={token:await secretPrompt('Groww official API access token (hidden): ')};await vault.save();console.log('API token saved encrypted. Provider configuration remains in config.json.');
  }else if(command==='enable'){
   if(!config.rootId){const reader=new DriveReader(await accessToken(vault.data.google)),folders=await reader.findStores();if(folders.length!==1)throw new Error('SET_EXACT_ROOT_ID_IN_CONFIG');config.rootId=folders[0].id;}
   await accessToken(vault.data.google);config.enabled=true;await atomicJSON(configPath,config);console.log('Collector enabled. Positions need one-time account enrollment; shared quote refresh can reuse existing snapshots.');
  }else if(command==='install'){
   if(!config.enabled||!config.rootId||!vault.data.google?.refresh_token)throw new Error('ENABLE_COLLECTOR_FIRST');console.log('Installed task:',await installTask(home));
  }else if(command==='export'){
   const dest=outsideRepo(args[1]);const password=await secretPrompt('Transfer master passphrase (12+ characters, hidden): ');if(password!==await secretPrompt('Confirm passphrase (hidden): '))throw new Error('PASSPHRASES_DIFFER');
   await writeFile(dest,JSON.stringify(portableSeal({version:1,config:{...config,enabled:false},secrets:vault.data},password)),{mode:0o600,flag:'wx'});console.log('Encrypted transfer bundle created. Store it privately; do not upload it to market-data or Git.');
  }else if(command==='import'){
   if(Object.values(vault.data.accounts||{}).some(a=>a.bound)||vault.data.google)throw new Error('IMPORT_REQUIRES_NEW_EMPTY_VAULT');
   const password=await secretPrompt('Transfer master passphrase (hidden): ');const bundle=portableOpen(JSON.parse(await readFile(outsideRepo(args[1]),'utf8')),password);
   validateConfig(bundle.config);if(bundle.version!==1||!bundle.secrets?.accounts)throw new Error('INVALID_TRANSFER_BUNDLE');
   for(const account of bundle.config.accounts){delete account.profileDirectory;delete account.legacyProfileHint;}
   for(const secret of Object.values(bundle.secrets.accounts)){secret.restore=true;secret.pinAttemptPending=false;delete secret.extension;if(bundle.config.collectionMode==='extension')secret.bound=false;}
   vault.data=bundle.secrets;await vault.save();await atomicJSON(configPath,{...bundle.config,enabled:false});console.log('Transfer imported and re-encrypted for this Windows user. Fresh Groww login may still be required. Scheduling remains disabled.');
  }else throw new Error('UNKNOWN_COMMAND');
 }finally{await release();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{const message=/^[A-Z_]+$/.test(error.message||'')?error.message:'SETUP_OR_RUNTIME_ERROR';console.error(message);process.exitCode=1;});
