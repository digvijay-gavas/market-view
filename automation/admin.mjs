import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {defaultHome,outsideRepo,atomicJSON} from './vault.mjs';
import {readJSON} from './worker.mjs';
import {protectHome} from './cli.mjs';
import {AdminService,safeCode} from './admin-service.mjs';

const MAX_BODY=32768;
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
function bodyJSON(req){return new Promise((resolveBody,reject)=>{
 let size=0,chunks=[],failed=false;
 req.on('data',chunk=>{if(failed)return;size+=chunk.length;if(size>MAX_BODY){failed=true;chunks=[];reject(Object.assign(new Error('REQUEST_TOO_LARGE'),{status:413}));}else chunks.push(chunk);});
 req.on('end',()=>{if(failed)return;try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||Array.isArray(data)||typeof data!=='object')throw new Error();resolveBody(data);}catch{reject(Object.assign(new Error('INVALID_JSON'),{status:400}));}});
 req.on('error',()=>reject(new Error('REQUEST_FAILED')));
 });}
export function createAdminServer({service,key=randomBytes(32).toString('base64url')}={}){
 const session=randomBytes(32).toString('base64url');let origin;
 const server=createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   const address=server.address();origin='http://127.0.0.1:'+address.port;
   if(req.headers.host!=='127.0.0.1:'+address.port)return send(403,{error:'LOCAL_HOST_REQUIRED'});
   const url=new URL(req.url,origin);
   if(req.method==='GET'&&assets.has(url.pathname)){
    const [file,mime]=assets.get(url.pathname);res.writeHead(200,{...headers,'Content-Type':mime});res.end(await readFile(new URL('admin-ui/'+file,import.meta.url)));return;
   }
   if(req.method==='POST'&&req.headers.origin!==origin)return send(403,{error:'LOCAL_ORIGIN_REQUIRED'});
   if(req.method==='GET'&&url.pathname==='/api/alive'){
    if(!equal(req.headers['x-admin-key'],key))return send(403,{error:'ADMIN_SESSION_REQUIRED'});return send(200,{ready:true});
   }
   if(req.method==='POST'&&url.pathname==='/api/session'){
    if(!equal(req.headers['x-admin-key'],key))return send(403,{error:'ADMIN_SESSION_REQUIRED'});
    res.setHeader('Set-Cookie','market_view_admin='+session+'; HttpOnly; SameSite=Strict; Path=/');return send(200,{ready:true});
   }
   const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('market_view_admin='))?.slice('market_view_admin='.length);
   if(!equal(cookie,session)||req.headers['x-collector-admin']!=='1')return send(403,{error:'ADMIN_SESSION_REQUIRED'});
   if(req.method==='GET'&&url.pathname==='/api/status')return send(200,await service.status());
   if(req.method==='POST'&&url.pathname==='/api/action'){
    if(req.headers['content-type']?.split(';')[0]!=='application/json')return send(415,{error:'JSON_REQUIRED'});
    if(Number(req.headers['content-length']||0)>MAX_BODY)return send(413,{error:'REQUEST_TOO_LARGE'});
    const input=await bodyJSON(req),actions={initialize:'initialize',pin:'savePin','add-account':'addAccount',folder:'saveRoot',enroll:'enroll',google:'connectGoogle',confirm:'confirm',cancel:'cancel',start:'startSchedule',pause:'pause',fetch:'fetchNow'};
    if(!Object.hasOwn(actions,input.action))return send(400,{error:'UNKNOWN_ACTION'});
    const result=await service[actions[input.action]](input);return send(200,{ok:true,job:result?.id?result:undefined});
   }
   return send(404,{error:'NOT_FOUND'});
  }catch(error){return send(error.status||400,{error:safeCode(error)});}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;
 return {server,key,get url(){return 'http://127.0.0.1:'+server.address().port;},async close(){await service.close?.();server.closeAllConnections();await new Promise(resolveClose=>server.close(resolveClose));}};
}
function openBrowser(url){if(process.platform==='win32')execFile('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true},()=>{});}
export async function startAdmin({home=defaultHome(),port=5186,open=true,openUrl=openBrowser}={}){
 home=outsideRepo(home);await protectHome(home);const instanceFile=join(home,'admin-instance.json');
 const app=createAdminServer({service:new AdminService(home)});
 try{await new Promise((resolveListen,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolveListen);});}
 catch(error){
  if(error.code!=='EADDRINUSE')throw error;const existing=await readJSON(instanceFile,null);
  if(existing?.port!==port||typeof existing.key!=='string')throw new Error('ADMIN_PORT_IN_USE');
  const response=await fetch('http://127.0.0.1:'+port+'/api/alive',{headers:{'X-Admin-Key':existing.key},signal:AbortSignal.timeout(3000),redirect:'error'});
  if(!response.ok)throw new Error('ADMIN_PORT_IN_USE');if(open)openUrl('http://127.0.0.1:'+port+'/#'+existing.key);return null;
 }
 await atomicJSON(instanceFile,{port:app.server.address().port,key:app.key,pid:process.pid});if(open)openUrl(app.url+'/#'+app.key);
 let closing=false;const shutdown=async()=>{if(closing)return;closing=true;await app.close();await unlink(instanceFile).catch(()=>{});};
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);return app;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)startAdmin({open:!process.argv.includes('--no-open')}).catch(error=>{console.error(safeCode(error));process.exitCode=1;});
