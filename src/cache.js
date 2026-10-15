// IndexedDB contains portfolio data, never Google credentials. Scope is random per sign-in.
export class PortfolioCache {
 constructor(scope,expiresAt,{indexedDB=globalThis.indexedDB}={}){this.scope=scope;this.expiresAt=expiresAt;this.indexedDB=indexedDB;this.active=true;this.disabled=false;}
 async database(){
  if(!this.active||this.disabled||Date.now()>=this.expiresAt)return null;
  if(!this.opening)this.opening=new Promise(resolve=>{
   try{const request=this.indexedDB.open('marketView.portfolio',1);
    request.onupgradeneeded=()=>{const entries=request.result.createObjectStore('entries',{keyPath:['scope','key']});entries.createIndex('scope','scope');};
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();
     const tx=db.transaction('entries','readwrite'),cursor=tx.objectStore('entries').openCursor();
     cursor.onsuccess=()=>{const row=cursor.result;if(row){if(row.value.expiresAt<=Date.now())row.delete();row.continue();}};
     tx.oncomplete=()=>resolve(db);tx.onerror=tx.onabort=()=>resolve(db);
    };
    request.onerror=request.onblocked=()=>{this.disabled=true;resolve(null);};
   }catch{this.disabled=true;resolve(null);}
  });
  return this.opening;
 }
 async get(key){return this.run('readonly',store=>store.get([this.scope,key]),row=>row?.expiresAt>Date.now()?row.value:null);}
 async set(key,value){return this.run('readwrite',store=>store.put({scope:this.scope,key,value,expiresAt:this.expiresAt}),()=>true);}
 async run(mode,operation,read){
  const db=await this.database();if(!db||!this.active)return null;
  return new Promise(resolve=>{try{const tx=db.transaction('entries',mode),request=operation(tx.objectStore('entries'));let result=null;
   request.onsuccess=()=>{result=read(request.result);};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>{this.disabled=true;resolve(null);};
  }catch{this.disabled=true;resolve(null);}});
 }
 async clear(){
  const db=await (this.opening||this.database());this.active=false;if(!db)return;
  await new Promise(resolve=>{try{const tx=db.transaction('entries','readwrite'),entries=tx.objectStore('entries');const request=entries.openCursor();
   request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(cursor.value.scope===this.scope||cursor.value.expiresAt<=Date.now())cursor.delete();cursor.continue();};
   tx.oncomplete=tx.onabort=tx.onerror=()=>resolve();
  }catch{resolve();}});
 }
}
export function fileRevision(file){
 // No trustworthy revision metadata means no reuse; names alone are insufficient.
 return file.version?`version:${file.version}`:file.md5Checksum?`md5:${file.md5Checksum}`:file.modifiedTime?`modified:${file.modifiedTime}:${file.size??''}`:null;
}

export function samePortfolio(left,right){
 return ['root','snapshots','dividends','reports','warnings'].every(key=>JSON.stringify(left?.[key])===JSON.stringify(right?.[key]));
}
