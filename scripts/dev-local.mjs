// Local developer mode: the real viewer (live from src/, no build) with Google sign-in bypassed.
// Drive reads go through this server using the collector's saved Google credentials
// (%LOCALAPPDATA%\MarketViewCollector vault), so no OAuth popup or PIN is needed.
// Bound to 127.0.0.1 only. Never deployed: the production build does not include this file.
//
//   npm run dev:local                      http://127.0.0.1:5174/
//   MV_DEV_LATENCY=600 npm run dev:local   add ~600 ms per Drive call (to feel production speed)
//   MV_DEV_CACHE_WRITE=1 npm run dev:local allow saving the shared dashboard cache (off by default:
//                                          dev code must not overwrite the cache production reads)
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Vault,defaultHome} from '../automation/vault.mjs';
import {accessToken} from '../automation/drive.mjs';
import {PRICE_PROXY_URL} from '../src/config.js';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const port=Number(process.env.PORT||5174);
const latency=Math.max(0,Number(process.env.MV_DEV_LATENCY||0));
const cacheWrite=process.env.MV_DEV_CACHE_WRITE==='1';
const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};

const home=defaultHome();
let vault=null,token=null;
async function driveToken(force=false){
 if(token&&!force&&Date.now()<token.expiresAt)return token.value;
 vault??=await new Vault(home).open();
 token={value:await accessToken(vault.data.google),expiresAt:Date.now()+45*60000};
 return token.value;
}

// Runs before app.js: a stand-in for Google Identity Services, plus a fetch shim that sends
// googleapis.com calls to this server. The browser never holds a real Google token.
const stub=`(()=>{
 const READ='https://www.googleapis.com/auth/drive.readonly',WRITE=${cacheWrite};
 window.google={accounts:{oauth2:{
  initTokenClient:o=>({requestAccessToken:()=>setTimeout(()=>o.callback({access_token:'local-dev',expires_in:3600}))}),
  hasGrantedAllScopes:(r,scope)=>scope===READ||WRITE
 }}};
 const real=window.fetch.bind(window);
 window.fetch=(input,init)=>{const url=String(input instanceof Request?input.url:input);
  return real(url.startsWith('https://www.googleapis.com/')?'/dev-drive/'+url.slice(27):input,init);};
 document.addEventListener('DOMContentLoaded',()=>{
  document.body.insertAdjacentHTML('afterbegin','<p class="dev-banner" role="note">LOCAL DEV · sign-in bypassed · Drive via collector credentials'+(WRITE?' · shared cache WRITE on':' · read-only')+'</p>');
  const panel=document.getElementById('connect-panel'),id=document.getElementById('client-id');
  if(panel&&!panel.hidden){id.value='local-dev.apps.googleusercontent.com';id.dispatchEvent(new Event('input'));document.getElementById('connect').click();}
 });
})();`;

async function proxyDrive(req,res,path){
 const write=req.method!=='GET';
 if(!/^(upload\/)?drive\/v3\//.test(path)||(write&&!cacheWrite)||!['GET','POST','PATCH'].includes(req.method)){res.writeHead(403,{'Content-Type':'application/json'});return res.end('{"error":"local dev proxy: read-only"}');}
 const body=write?await new Promise(done=>{const parts=[];req.on('data',c=>parts.push(c));req.on('end',()=>done(Buffer.concat(parts)));}):undefined;
 if(latency)await new Promise(done=>setTimeout(done,latency));
 const send=async force=>fetch('https://www.googleapis.com/'+path,{method:req.method,body,headers:{Authorization:'Bearer '+await driveToken(force),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})}});
 let response=await send(false);if(response.status===401)response=await send(true);
 res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')||'application/json','Cache-Control':'no-store'});
 res.end(Buffer.from(await response.arrayBuffer()));
}

createServer(async(req,res)=>{
 try{
  // Only same-machine pages addressed to this server (blocks DNS-rebinding pages from using the proxy).
  if(!hosts.has(req.headers.host)){res.writeHead(421);return res.end('Wrong host');}
  const url=new URL(req.url,'http://'+req.headers.host),pathname=decodeURIComponent(url.pathname);
  if(pathname.startsWith('/dev-drive/'))return await proxyDrive(req,res,url.pathname.slice(11)+url.search);
  let body,type;
  if(pathname==='/'||pathname==='/index.html'){
   body=(await readFile(root+'/index.html','utf8')).replace('<script src="https://accounts.google.com/gsi/client" async defer></script>','<script src="./dev/stub.js"></script>').replace('__BUILD_VERSION__','local dev');type=types['.html'];
  }else if(pathname==='/dev/stub.js'){body=stub;type=types['.js'];}
  else if(pathname==='/src/config.js'){body=`export const PRICE_PROXY_URL=${JSON.stringify(process.env.MV_PRICE_PROXY_URL??PRICE_PROXY_URL)};\nexport const oauthConfig=null;\n`;type=types['.js'];}
  else{
   const file=resolve(root,'.'+pathname);
   if(!file.startsWith(root+sep+'src'+sep))throw new Error('Not served');
   body=await readFile(file);type=types[extname(file)]||'application/octet-stream';
  }
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(body);
 }catch(error){
  if(res.headersSent)return res.end();
  const login=/GOOGLE_LOGIN_REQUIRED|vault|Credential/i.test(error.message||'');
  res.writeHead(login?503:404,{'Content-Type':'text/plain'});res.end(login?'Collector Google credentials unavailable: connect Google in the collector admin first.':'Not found');
 }
}).listen(port,'127.0.0.1',()=>console.log(`Market View local dev (sign-in bypassed): http://127.0.0.1:${port}/${latency?` · +${latency} ms per Drive call`:''}${cacheWrite?' · shared cache WRITE enabled':''}`));
