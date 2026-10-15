import {buildPortfolio,numeric} from './model.js';
import {DriveReader,folderId} from './drive.js';
const $=id=>document.getElementById(id);
const money=x=>numeric(x)?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(x):'Unavailable';
const pct=x=>numeric(x)?`${x>=0?'+':''}${x.toFixed(2)}%`:'—';
const number=x=>numeric(x)?new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(x):'—';
const stamp=x=>x?new Date(x).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'Unknown';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
let reader=null,token=null,expiry=0,expireTimer=null,controller=null,store=null,selectedRoot=null,generation=0,busy=false;
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
function clearData() {
  generation++;controller?.abort();controller=null;reader=null;store=null;selectedRoot=null;busy=false;
  $('dashboard').hidden=true;$('folder-panel').hidden=true;
  for(const id of ['positions','stats','allocation','largest','provenance','warnings','folder-results'])$(id).replaceChildren();
  $('account').replaceChildren(new Option('Combined accounts',''));$('folder-id').value='';$('search').value='';$('freshness').textContent='';$('store-name').textContent='Portfolio';
  $('holdings-title').textContent='Holdings';$('table-note').textContent='';
  for(const id of ['refresh','load-folder','find-folders'])$(id).disabled=false;
}
function disconnect(message='Disconnected. Portfolio data has been cleared.') {
  clearTimeout(expireTimer);clearData();token=null;expiry=0;$('disconnect').hidden=true;$('connect-panel').hidden=false;$('connect').disabled=false;status(message);
}
$('disconnect').addEventListener('click',()=>disconnect());
$('connect').addEventListener('click',()=>{
  // Every authorization is an account switch boundary. Clear old data before opening Google.
  disconnect('Opening Google account selection…');
  const clientId=$('client-id').value.trim();
  if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))return status('Enter the public client ID of a Google Web application OAuth client.',true);
  if(!window.google?.accounts?.oauth2)return status('Google Identity Services did not load. Check your connection or browser content blocker, then try again.',true);
  $('connect').disabled=true;const attempt=generation;
  const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:'https://www.googleapis.com/auth/drive.readonly',include_granted_scopes:false,
    callback:response=>{
      if(attempt!==generation)return;
      $('connect').disabled=false;
      if(response.error||!response.access_token)return status('Google authorization was not completed. Try connecting again.',true);
      if(!google.accounts.oauth2.hasGrantedAllScopes(response,'https://www.googleapis.com/auth/drive.readonly'))return status('Drive read-only permission is required to read the existing store.',true);
      token=response.access_token;expiry=Date.now()+Number(response.expires_in||3600)*1000;
      controller=new AbortController();reader=new DriveReader(token,{signal:controller.signal});
      expireTimer=setTimeout(()=>disconnect('Google access expired. Connect again to choose your account.'),Math.max(0,expiry-Date.now()-10000));
      $('connect-panel').hidden=true;$('disconnect').hidden=false;$('folder-panel').hidden=false;
      status('Connected. Choose the Market folder accessible to this Google account.');
    },error_callback:()=>{if(attempt===generation){$('connect').disabled=false;status('The Google popup was closed or blocked. Allow popups and try again.',true);}}
  });
  try {client.requestAccessToken({prompt:'select_account'});}catch{ $('connect').disabled=false;status('Could not open Google authorization. Check this site’s authorized JavaScript origin in Google Cloud.',true); }
});
async function action(work) {
  if(busy)return;
  if(!reader||Date.now()>=expiry){disconnect('Connect to Google Drive to continue.');return;}
  const attempt=generation;busy=true;
  for(const id of ['refresh','load-folder','find-folders'])$(id).disabled=true;
  try {await work(attempt);}catch(e){if(attempt!==generation||e.name==='AbortError')return;if(e.authExpired)disconnect(e.message);else status(e.message||'Could not load Drive data.',true);}
  finally{if(attempt===generation){busy=false;for(const id of ['refresh','load-folder','find-folders'])$(id).disabled=false;}}
}
async function openFolder(id) {
  if(busy)return;
  // Drop the previous folder's data before requesting another one.
  store=null;$('dashboard').hidden=true;
  for(const key of ['positions','stats','allocation','largest','provenance','warnings'])$(key).replaceChildren();
  $('account').replaceChildren(new Option('Combined accounts',''));$('search').value='';
  await action(async attempt=>{
    status('Opening the Drive store…');
    const result=await reader.load(id,message=>{if(attempt===generation)status(message);});
    if(attempt!==generation)return;
    store=result;selectedRoot=id;
    for(const s of [...store.snapshots].sort((a,b)=>a.partition.localeCompare(b.partition)))$('account').add(new Option(s.partition,s.partition));
    $('folder-panel').hidden=true;$('folder-results').replaceChildren();render();status('Loaded from Google Drive. Values reflect saved capture prices; no live quotes.');
  });
}
$('find-folders').addEventListener('click',()=>action(async attempt=>{
  status('Finding folders named market-data…');const folders=await reader.findStores();if(attempt!==generation)return;
  $('folder-results').replaceChildren();
  for(const f of folders){const b=text('button',`${f.name} · ${f.id.slice(-6)}`);b.addEventListener('click',()=>openFolder(f.id));$('folder-results').append(b);}
  status(folders.length?`Found ${folders.length} folder(s). Choose the intended store. If names repeat, use its exact Drive link.`:'No folder named market-data found. Paste a folder link shared with this Google account.');
}));
$('load-folder').addEventListener('click',()=>{try{openFolder(folderId($('folder-id').value));}catch(e){status(e.message,true);}});
$('refresh').addEventListener('click',()=>{if(selectedRoot)openFolder(selectedRoot);});
$('change-folder').addEventListener('click',()=>{$('folder-panel').hidden=false;});
$('account').addEventListener('change',render);$('search').addEventListener('input',renderPositions);
document.addEventListener('visibilitychange',()=>{if(token&&Date.now()>=expiry)disconnect('Google access expired. Connect again.');});
window.addEventListener('pagehide',()=>disconnect());
window.addEventListener('pageshow',event=>{if(event.persisted)disconnect('Connect again after restoring this page.');});
function bar(container,name,value,share,colour='') {
  const row=text('div','','bar-row');const label=text('div','','bar-label');label.append(text('span',name),text('span',`${money(value)} · ${numeric(share)?share.toFixed(1)+'%':'—'}`));
  const track=text('div','','bar-track'),fill=text('div','',`bar-fill ${colour}`);fill.style.width=`${Math.max(0,Math.min(100,share||0))}%`;track.append(fill);row.append(label,track);container.append(row);
}
function current(){return buildPortfolio(store.snapshots,store.dividends,$('account').value);}
function render() {
  if(!store)return;const p=current();$('dashboard').hidden=false;$('store-name').textContent=store.root.name;
  const selected=store.snapshots.filter(s=>!$('account').value||s.partition===$('account').value);
  const dates=[...new Set(selected.map(s=>s.as_of||'unknown'))].sort();
  $('freshness').textContent=`Holdings / saved prices: ${dates.join(' · ')} · Read from Drive ${stamp(store.loadedAt)} · Times shown in your browser’s timezone`;
  const warnings=[...store.warnings];
  if(dates.length>1)warnings.push('Combined totals mix capture dates; see each account below.');
  if(p.incomplete)warnings.push(`${p.incomplete} holding(s) have missing value or cost inputs. Affected totals and weights are unavailable.`);
  if(p.dividendAccounts.length&&p.dividendAccounts.length<p.accounts.length)warnings.push('Dividend coverage is partial: some selected accounts have no saved dividend reports.');
  $('warnings').hidden=!warnings.length;$('warnings').replaceChildren(...warnings.map(w=>text('p',w)));
  $('stats').replaceChildren();
  const stats=[['CAPTURED MARKET VALUE',money(p.value),`${p.positions.length} holdings · ${p.accounts.length} accounts`],['INVESTED',money(p.cost),'Cost of the captured holdings'],['UNREALISED P&L',money(p.pnl),pct(p.returnPct)],['TOP 5 WEIGHT',numeric(p.top5)?p.top5.toFixed(1)+'%':'—','Share of captured market value'],['SAVED DIVIDEND CREDITS',money(p.dividends),p.dividendAccounts.length?'All available report dates · separate from P&L':'No saved reports for these accounts']];
  for(const [label,value,note]of stats){const c=text('section','','stat');c.append(text('p',label,'eyebrow'),text('strong',value,label==='UNREALISED P&L'?(p.pnl<0?'loss':'gain'):''),text('p',note,'fine'));$('stats').append(c);}
  $('allocation').replaceChildren();for(const a of p.accounts)bar($('allocation'),a.name,a.value,numeric(p.value)&&p.value>0&&numeric(a.value)?a.value/p.value*100:null);
  $('largest').replaceChildren();for(const r of p.positions.slice(0,5))bar($('largest'),r.name,r.value,r.weight,'violet');
  const table=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');
  for(const label of ['Account','Holdings / prices as of','Captured','Last confirmed','Positions'])tr.append(text('th',label));head.append(tr);table.append(head);
  const body=document.createElement('tbody');for(const s of selected){const row=document.createElement('tr');for(const value of [s.partition,s.as_of||'Unknown',stamp(s.captured_at),stamp(s.confirmedAt),String(s.tables.holdings.length)])row.append(text('td',value));body.append(row);}table.append(body);$('provenance').replaceChildren(table);
  renderPositions();
}
function renderPositions(){
  if(!store)return;const p=current(),query=$('search').value.trim().toLowerCase();$('positions').replaceChildren();
  const rows=p.positions.filter(r=>`${r.name} ${r.key}`.toLowerCase().includes(query));
  for(const r of rows){const tr=document.createElement('tr');const name=text('td','');name.append(text('strong',r.name),text('small',r.accounts.join(' · '),'fine'));tr.append(name);for(const [i,v]of [number(r.quantity),money(r.cost),money(r.value),money(r.pnl),pct(r.returnPct),numeric(r.weight)?r.weight.toFixed(1)+'%':'—'].entries())tr.append(text('td',v,i===3||i===4?(r.pnl<0?'loss':'gain'):''));$('positions').append(tr);}
  if(!rows.length){const tr=document.createElement('tr'),td=text('td',p.positions.length?'No matching holdings.':'This account was captured with no holdings.');td.colSpan=7;tr.append(td);$('positions').append(tr);}
  $('holdings-title').textContent=`Holdings · ${p.positions.length}`;$('table-note').textContent=`Showing ${rows.length} of ${p.positions.length}. Grouped by the source’s exact Groww slug; no guessed symbol matching. A dash or “Unavailable” means the inputs are missing.`;
}
