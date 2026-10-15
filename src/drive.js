import {SNAPSHOT, newestValid, validateSnapshot, confirmationAt} from './model.js';
const API='https://www.googleapis.com/drive/v3';
const FOLDER='application/vnd.google-apps.folder';
const escapeQuery=s=>s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
const idPattern=/^[A-Za-z0-9_-]+$/;
export function folderId(input) {
  const value=input.trim();
  if(idPattern.test(value)) return value;
  try { const u=new URL(value); if(u.hostname==='drive.google.com') {const id=u.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] || u.searchParams.get('id');if(id&&idPattern.test(id)) return id;} } catch {}
  throw new Error('Paste a Google Drive folder link or folder ID.');
}
export class DriveReader {
  // Native browser fetch requires the Window receiver when stored as a method.
  constructor(token,{fetcher=globalThis.fetch.bind(globalThis),signal}={}) { this.token=token;this.fetcher=fetcher;this.signal=signal; }
  async get(path,params={}) {
    const url=new URL(API+path);for(const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
    let response;
    for(let attempt=0;attempt<3;attempt++) {
      try {
        response=await this.fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${this.token}`},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:this.signal});
      } catch(error) {
        if(error.name==='AbortError'||this.signal?.aborted)throw error;
        if(attempt===2) {
          const operation=path==='/files'?'folder listing':params.alt==='media'?'file download':'folder/file metadata';
          throw Object.assign(new Error(`The browser could not fetch Drive ${operation} after 3 attempts. Check the connection or browser network restrictions, then retry.`),{fatal:true});
        }
        await new Promise(resolve=>setTimeout(resolve,400*2**attempt));
        continue;
      }
      if(![429,500,502,503,504].includes(response.status)||attempt===2)break;
      await new Promise(resolve=>setTimeout(resolve,400*2**attempt));
    }
    if(response.status===401) throw Object.assign(new Error('Google access expired. Disconnect and connect again.'),{authExpired:true});
    if(!response.ok) {
      // Do not reflect Drive error bodies or request URLs (which can contain private IDs).
      const message=response.status===403?'Drive denied access. Check the account, read-only consent, and that Drive API is enabled.':response.status===404?'Folder or file unavailable to this Google account.':`Drive request failed (HTTP ${response.status}). Try refreshing.`;
      throw Object.assign(new Error(message),{fatal:true});
    }
    return params.alt==='media'?response.text():response.json();
  }
  async list(q) {
    const files=[];let pageToken;
    do {
      const data=await this.get('/files',{q:`trashed = false and (${q})`,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,parents)',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(pageToken?{pageToken}:{})});
      if(data.incompleteSearch)throw new Error('Drive returned an incomplete folder search. Paste the folder ID instead.');
      files.push(...data.files);pageToken=data.nextPageToken;
    }while(pageToken);
    return files;
  }
  children(ids) {return this.list(ids.map(id=>`'${escapeQuery(id)}' in parents`).join(' or '));}
  async findStores() {return this.list(`name = 'market-data' and mimeType = '${FOLDER}'`);}
  async readJSON(file) {const text=await this.get('/files/'+encodeURIComponent(file.id),{alt:'media',supportsAllDrives:'true'});return JSON.parse(text);}
  async load(rootId,onProgress=()=>{}) {
    const warnings=[];
    onProgress('Reading Drive folder metadata…');
    const root=await this.get('/files/'+encodeURIComponent(rootId),{fields:'id,name,mimeType,trashed',supportsAllDrives:'true'});
    if(root.mimeType!==FOLDER||root.trashed)throw new Error('Choose a Drive folder, not a file.');
    onProgress('Listing store folders…');
    const rootChildren=await this.children([rootId]);
    const datasets=new Map();
    for(const f of rootChildren.filter(f=>f.mimeType===FOLDER)) {const ids=datasets.get(f.name)||[];ids.push(f.id);datasets.set(f.name,ids);}
    // Check the published contract before interpreting source data.
    if(!datasets.has('_schema'))throw new Error('This folder has no _schema folder. Choose the root of the Market data store.');
    const schemaFiles=await this.children(datasets.get('_schema'));
    const catalogs=schemaFiles.filter(f=>f.name==='catalog.json').sort((a,b)=>a.id.localeCompare(b.id));
    if(!catalogs.length)throw new Error('The store catalog is missing.');
    onProgress('Reading store catalog…');
    const catalog=await this.readJSON(catalogs[0]);
    if(catalog.store_version!==1||catalog.datasets?.['groww.live_holdings']?.version!==1||catalog.datasets['groww.live_holdings'].semantics!=='latest')throw new Error('This store version is not supported. Expected Market v1 holdings snapshots.');
    const snapshots=[],dividends=[],logs=[];let reportAccounts=[];
    const skip=()=>warnings.push('Skipped an invalid, unsupported or incomplete snapshot; a valid older capture may be shown.');
    for(const dataset of ['groww.live_holdings','groww.dividend_report','groww.pnl_report']) {
      if(!datasets.has(dataset))continue;
      const partitions=await this.children(datasets.get(dataset));
      const groups=new Map();
      for(const p of partitions.filter(p=>p.mimeType===FOLDER)) {if(!/^[a-z0-9_-]+$/.test(p.name))continue;const ids=groups.get(p.name)||[];ids.push(p.id);groups.set(p.name,ids);}
      if(dataset==='groww.pnl_report') {reportAccounts=[...groups.keys()];continue;}
      for(const [partition,ids] of groups) {
        onProgress(`Reading ${dataset==='groww.live_holdings'?'holdings':'dividends'} · ${partition}…`);
        const files=(await this.children(ids)).filter(f=>SNAPSHOT.test(f.name));
        if(dataset==='groww.live_holdings') {
          const doc=await newestValid(files,f=>this.readJSON(f),dataset,partition,skip);
          if(doc)snapshots.push(doc);else warnings.push(`No readable holdings capture for ${partition}; account excluded from totals.`);
        } else {
          if(catalog.datasets?.[dataset]?.version!==1||catalog.datasets[dataset].semantics!=='cumulative') {warnings.push('Dividend report schema is unsupported; credits omitted.');continue;}
          const hashes=new Set();
          for(const f of files.sort((a,b)=>a.id.localeCompare(b.id)))try {
            const doc=validateSnapshot(await this.readJSON(f),dataset,partition);
            if(!hashes.has(doc.content_hash)){dividends.push(doc);hashes.add(doc.content_hash);}
          }catch(e){if(e.authExpired||e.fatal)throw e;skip();}
        }
      }
    }
    if(datasets.has('_log')) {
      for(const f of (await this.children(datasets.get('_log'))).filter(f=>f.name.endsWith('.jsonl'))) {
        const text=await this.get('/files/'+encodeURIComponent(f.id),{alt:'media',supportsAllDrives:'true'});
        for(const line of text.split('\n')) if(line.trim())try{logs.push(JSON.parse(line));}catch{warnings.push('An incomplete confirmation log entry was ignored.');}
      }
    }
    for(const s of snapshots) {
      s.confirmedAt=confirmationAt(s,logs);
      const age=(Date.now()-Date.parse(s.confirmedAt))/36e5;
      const maxAge=catalog.datasets['groww.live_holdings'].max_age_hours;
      if(typeof maxAge==='number'&&age>maxAge)warnings.push(`${s.partition}: last confirmed over ${maxAge} hours ago. Saved prices may be stale.`);
      if(Date.parse(s.confirmedAt)>Date.now()+300000)warnings.push(`${s.partition}: confirmation timestamp is in the future; check the writer's clock.`);
    }
    const missing=reportAccounts.filter(a=>!snapshots.some(s=>s.partition===a));
    if(missing.length)warnings.push(`Report-only accounts excluded (no holdings capture): ${missing.join(', ')}. This reader does not reconstruct lots from P&L workbooks.`);
    if(!snapshots.length)throw new Error('No readable holdings snapshots in this store. Publish groww.live_holdings captures from Market first.');
    return {root,snapshots,dividends,warnings:[...new Set(warnings)],loadedAt:new Date().toISOString()};
  }
}
