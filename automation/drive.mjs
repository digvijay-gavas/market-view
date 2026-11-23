import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {hostname} from 'node:os';
import {DriveReader} from '../src/drive.js';
import {buildPortfolio,validateSnapshot,SNAPSHOT,newestValid} from '../src/model.js';
import {canonical,hashJSON} from '../src/progressive.js';
import {DriveDashboardCache,makeDriveCache} from '../src/drive-cache.js';
export const DATASETS={
 'portfolio.positions':{version:1,semantics:'latest',partition:'account',hash_ignore_meta:[],max_age_hours:36},
 'market.prices':{version:1,semantics:'latest',partition:'shared',hash_ignore_meta:[],max_age_hours:1},
 'portfolio.position_changes':{version:1,semantics:'cumulative',partition:'account',hash_ignore_meta:[]}
};
export async function accessToken(secret,{fetcher=fetch}={}){
 if(!secret?.refresh_token||!secret.client_id)throw new Error('GOOGLE_LOGIN_REQUIRED');
 const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:secret.refresh_token,client_id:secret.client_id,...(secret.client_secret?{client_secret:secret.client_secret}:{})}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('GOOGLE_LOGIN_REQUIRED');const data=await response.json();if(typeof data.access_token!=='string')throw new Error('GOOGLE_LOGIN_REQUIRED');return data.access_token;
}
export class FileBodyCache{
 constructor(home){this.home=join(home,'file-cache');}
 async get(key){try{return JSON.parse(await readFile(join(this.home,encodeURIComponent(key)+'.json'),'utf8'));}catch{return null;}}
 async set(key,value){await mkdir(this.home,{recursive:true,mode:0o700});await writeFile(join(this.home,encodeURIComponent(key)+'.json'),JSON.stringify(value),{mode:0o600});}
}
export class Publisher extends DriveReader{
 constructor(token,rootId,options={}){super(token,options);this.rootId=rootId;this.mutateFetch=options.fetcher||fetch;}
 async mutation(path,{method='POST',body,upload=false}={}){
  const url='https://www.googleapis.com/'+(upload?'upload/drive/v3':'drive/v3')+path;
  const response=await this.mutateFetch(url,{method,headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:this.signal||AbortSignal.timeout(30000),credentials:'omit'});
  if(!response.ok)throw new Error('DRIVE_WRITE_FAILED');return response.json();
 }
 async folder(name,parent){
  const found=(await this.children([parent])).filter(f=>f.name===name&&f.mimeType==='application/vnd.google-apps.folder').sort((a,b)=>a.id.localeCompare(b.id))[0];
  if(found)return found.id;return (await this.mutation('/files?supportsAllDrives=true&fields=id',{body:{name,mimeType:'application/vnd.google-apps.folder',parents:[parent]}})).id;
 }
 async jsonFile(name,parent,doc,{immutable=false}={}){
  const files=(await this.children([parent])).filter(f=>f.name===name).sort((a,b)=>a.id.localeCompare(b.id));let file=files[0];
  if(file&&immutable)return file.id;
  const created=!file;
  if(!file)file=await this.mutation('/files?supportsAllDrives=true&fields=id',{body:{name:'.pending-'+process.pid+'-'+Date.now()+'.tmp',mimeType:'application/json',parents:[parent]}});
  await this.mutation('/files/'+encodeURIComponent(file.id)+'?uploadType=media&supportsAllDrives=true&fields=id',{upload:true,method:'PATCH',body:doc});
  if(created)await this.mutation('/files/'+encodeURIComponent(file.id)+'?supportsAllDrives=true&fields=id',{method:'PATCH',body:{name}});
  return file.id;
 }
 async ensureCatalog(){
  const id=await this.folder('_schema',this.rootId),files=(await this.children([id])).filter(f=>f.name==='catalog.json');
  const existing=files.length?await this.readJSON(files[0]):{store_version:1,datasets:{'groww.live_holdings':{version:1,semantics:'latest',max_age_hours:24}}};
  if(existing.store_version!==1)throw new Error('STORE_SCHEMA_UNSUPPORTED');let changed=!files.length;
  for(const [name,schema]of Object.entries(DATASETS)){if(existing.datasets[name]&&existing.datasets[name].version!==1)throw new Error('STORE_SCHEMA_UNSUPPORTED');if(!existing.datasets[name]){existing.datasets[name]=schema;changed=true;}}
  if(changed)await this.jsonFile('catalog.json',id,existing);return existing;
 }
 async latest(dataset,partition){
  const roots=(await this.children([this.rootId])).filter(f=>f.name===dataset&&f.mimeType==='application/vnd.google-apps.folder');if(!roots.length)return null;
  const parts=(await this.children(roots.map(f=>f.id))).filter(f=>f.name===partition&&f.mimeType==='application/vnd.google-apps.folder');if(!parts.length)return null;
  const files=(await this.children(parts.map(f=>f.id))).filter(f=>SNAPSHOT.test(f.name));return newestValid(files,f=>this.readJSON(f),dataset,partition);
 }
 async publish(dataset,partition,tables,meta={},at=new Date()){
  if(!/^[a-z0-9_-]+$/.test(partition))throw new Error('INVALID_PARTITION');
  if(![...Object.keys(DATASETS),'groww.live_holdings'].includes(dataset))throw new Error('INVALID_DATASET');
  const doc={store_version:1,schema_version:1,dataset,partition,source:dataset==='market.prices'?'market':'groww',method:dataset==='market.prices'?'api':'scrape',captured_at:at.toISOString(),as_of:new Date(+at+330*60000).toISOString().slice(0,10),writer:hostname().toLowerCase().replace(/[^a-z0-9_-]/g,'-'),producer:'market-view-collector/1',meta,tables};
  doc.content_hash=await hashJSON(Object.fromEntries(['dataset','schema_version','partition','as_of','meta','tables'].map(k=>[k,doc[k]])));
  if(dataset!=='portfolio.position_changes')validateSnapshot(doc,dataset,partition);
  const previous=dataset==='portfolio.position_changes'?null:await this.latest(dataset,partition);
  const same=previous&&JSON.stringify(canonical({as_of:previous.as_of,meta:previous.meta,tables:previous.tables}))===JSON.stringify(canonical({as_of:doc.as_of,meta:doc.meta,tables:doc.tables}));
  if(same)return {doc:previous,changed:false};
  const folder=await this.folder(partition,await this.folder(dataset,this.rootId));const stamp=doc.captured_at.replace(/[-:]/g,'').slice(0,15)+'Z';
  const name=stamp+'__'+doc.content_hash.slice(7,19)+'.json';await this.jsonFile(name,folder,doc,{immutable:true});return {doc,changed:true};
 }
 async compileCache(){
  const signature=await this.snapshotSignature(this.rootId),cache=new DriveDashboardCache(this.token,{signal:this.signal,writeEnabled:true,fetcher:this.fetcher});
  const previous=await cache.load(this.rootId);
  if(signature&&previous?.store.sourceSignature===signature)return {reused:true};
  const store=await this.load(this.rootId),after=await this.snapshotSignature(this.rootId);
  if(!signature||signature!==after)throw new Error('SOURCE_CHANGED_DURING_COMPILE');
  store.sourceSignature=signature;const views=new Map([['null',buildPortfolio(store.snapshots,store.dividends,'',store.reports||[],store.smallcases||[])]]);
  await cache.save(this.rootId,makeDriveCache(store,views));return {reused:false};
 }
 async status(doc){await this.jsonFile('_market-view-collector-status.json',this.rootId,doc);}
}
