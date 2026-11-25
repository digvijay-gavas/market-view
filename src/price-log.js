// Price-source reliability log in market-view-data/_price-log (market-view's own folder).
// One JSON file per writer per IST day (viewer-<date>-<device>.json / collector-<date>.json), so
// devices never overwrite each other. Entries say which source priced each stock, how old the
// quote was and why other sources failed; collector entries also cross-check Yahoo against Groww.
// Only prices and source names are logged: no account names, quantities or values.
export const LOG_FOLDER='_price-log';
const FOLDER_TYPE='application/vnd.google-apps.folder';
const MAX_ENTRIES=400;
export const istDay=(date=new Date())=>new Date(+date+330*60000).toISOString().slice(0,10);
export function deviceId(storage=globalThis.localStorage){
 try{let id=storage.getItem('mv-device');if(!/^[a-z0-9]{8}$/.test(id||'')){id=Math.random().toString(36).slice(2,10).padEnd(8,'0');storage.setItem('mv-device',id);}return id;}
 catch{return 'nostore0';}
}
export function logFileName(kind,day,device){return kind+'-'+day+(device?'-'+device:'')+'.json';}
export function appendEntries(doc,entries,{kind,day}){
 const base=doc&&doc.version===1&&Array.isArray(doc.entries)?doc:{version:1,kind,day,entries:[]};
 return {...base,updatedAt:new Date().toISOString(),entries:[...base.entries,...entries].slice(-MAX_ENTRIES)};
}

// `drive` is a DriveDashboardCache (request/list/mvFolder). Writes only when it is write-enabled;
// otherwise entries are dropped (read-only logins cannot add files).
export class PriceLog{
 constructor({drive,rootId,kind='viewer',device=deviceId(),now=()=>new Date(),delayMs=4000,setTimer=globalThis.setTimeout?.bind(globalThis)}){
  Object.assign(this,{drive,rootId,kind,device,now,delayMs,setTimer});this.pending=[];this.timer=null;this.writing=null;this.lastError=null;
 }
 get enabled(){return Boolean(this.drive?.writeEnabled&&this.rootId);}
 add(entry){if(!this.enabled)return;this.pending.push(entry);if(!this.timer&&this.setTimer)this.timer=this.setTimer(()=>{this.timer=null;this.flush().catch(()=>{});},this.delayMs);}
 async folder(){
  if(this.folderId)return this.folderId;
  const mv=await this.drive.mvFolder(this.rootId);if(!mv)throw new Error('market-view-data folder missing');
  let found=(await this.drive.list("trashed = false and '"+mv.id+"' in parents and name = '"+LOG_FOLDER+"' and mimeType = '"+FOLDER_TYPE+"'"))[0];
  if(!found)found=await this.drive.request('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:LOG_FOLDER,parents:[mv.id],mimeType:FOLDER_TYPE,description:'market-view price-source reliability log (owned by market-view).'})});
  return this.folderId=found.id;
 }
 async flush(){
  if(this.writing)await this.writing.catch(()=>{});
  if(!this.pending.length||!this.enabled)return;
  const entries=this.pending.splice(0);
  this.writing=(async()=>{
   try{
    const day=istDay(this.now()),name=logFileName(this.kind,day,this.device),parent=await this.folder();
    let file=(await this.drive.list("trashed = false and '"+parent+"' in parents and name = '"+name+"'"))[0];
    const existing=file?await this.drive.request('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(file.id)+'?alt=media&supportsAllDrives=true').catch(()=>null):null;
    if(!file)file=await this.drive.request('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parents:[parent],mimeType:'application/json'})});
    const doc=appendEntries(existing,entries,{kind:this.kind,day});
    await this.drive.request('https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(file.id)+'?uploadType=media&fields=id&supportsAllDrives=true',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(doc)});
    this.lastError=null;
   }catch(error){this.lastError=String(error?.message||error);if(error?.authExpired)return;this.pending.unshift(...entries.slice(-50));}
  })();
  return this.writing;
 }
}
