import {bmRows} from './bm.js';
import {DriveDashboardCache,READ_SCOPE,CACHE_SCOPE,makeDriveCache,cacheAge,reuseSharedCache} from './drive-cache.js';
import {oauthConfig,PRICE_PROXY_URL} from './config.js';
import {LivePrices,LIVE_MODES,applyQuotes,holdingSlugs} from './live-prices.js';
import {raceScale,raceProgress,shortAgo,accountColors,donutSlices} from './charts.js';
import {decryptClientId} from './pin.js';
import {RefreshSchedule} from './refresh.js';
import {PortfolioCache,samePortfolio} from './cache.js';
import {buildPortfolio,numeric} from './model.js';
import {DriveReader,folderId} from './drive.js';
import {restoreClientId,saveClientId,restoreSelection,saveSelection} from './preferences.js';
import {restoreSession,saveSession,clearSession} from './session.js';
const $=id=>document.getElementById(id);
$('client-id').value=oauthConfig?'':restoreClientId();
$('client-id').addEventListener('input',()=>{if(!oauthConfig)saveClientId($('client-id').value.trim());});
const money=x=>numeric(x)?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(x):'Unavailable';
const pct=x=>numeric(x)?`${x>=0?'+':''}${x.toFixed(2)}%`:'—';
const number=x=>numeric(x)?new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(x):'—';
const stamp=x=>x?new Date(x).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'Unknown';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
let reader=null,token=null,expiry=0,expireTimer=null,controller=null,store=null,selectedRoot=null,generation=0,busy=false;
let bmFilter='all',cloudCache=null,cacheSavedAt=null,cacheMessage='';
let activeView='overview',sourcePage=0,warningPage=0,allocationPage=0,currentWarnings=[],sessionRemembered=false,portfolioCache=null,selectedAccounts=null,selectionRoot=null;
const loading=(message,value=0)=>{$('load-progress').hidden=false;$('loading-bar').value=value;status(message);};
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
const live=new LivePrices({endpoint:PRICE_PROXY_URL,slugs:()=>store?holdingSlugs(store.snapshots):[],onChange:renderLive});
let liveView={source:null,version:-1,snapshots:null},liveRendered=0;
// Live quotes overlay the loaded snapshots in memory only; store (and the Drive/browser caches) keep saved prices.
function liveSnapshots(){if(!store||!live.quotes.size)return null;if(liveView.source!==store.snapshots||liveView.version!==live.version)liveView={source:store.snapshots,version:live.version,snapshots:applyQuotes(store.snapshots,live.quotes)};return liveView.snapshots;}
const ago=at=>{const s=Math.max(0,(Date.now()-Date.parse(at))/1000);return s<60?'just now':s<3600?Math.floor(s/60)+'m ago':s<86400?Math.floor(s/3600)+'h ago':Math.floor(s/86400)+'d ago';};
// One compact line replaces the long freshness sentence: how old prices and positions are.
function freshnessTimes(){
 if(!store)return {};const selected=selectedSnapshots(),progressive=(store.progressiveSources||[]).filter(s=>selected.some(a=>a.partition===s.account));
 const positions=progressive.map(s=>s.positionsAt).concat(selected.filter(s=>!progressive.some(p=>p.account===s.partition)).map(s=>s.captured_at||s.confirmedAt)).filter(Boolean).sort()[0];
 const saved=progressive.map(s=>s.pricesFrom).filter(Boolean).sort()[0]||positions;
 return {positions,prices:live.lastAt&&live.quotes.size?live.lastAt:saved,livePrices:Boolean(live.lastAt&&live.quotes.size)};
}
function renderAgo(){
 const t=freshnessTimes(),parts=[];
 if(t.prices)parts.push((t.livePrices?'Live prices ':'Prices ')+ago(t.prices));
 if(t.positions)parts.push('Positions '+ago(t.positions));
 if(live.remaining!=null)parts.push(live.remaining+' left');
 if(live.note)parts.push(live.note);if(live.error)parts.push(live.error);
 if(!live.enabled)parts.push('Live prices off');
 $('live-status').textContent=parts.join(' · ');$('live-status').classList.toggle('error',Boolean(live.error));
 $('live-status').title=[t.prices&&'Prices: '+stamp(t.prices)+(t.livePrices?' (live overlay, not saved)':''),t.positions&&'Positions: '+stamp(t.positions)].filter(Boolean).join('\n');
}
function renderLive(){
 for(const b of $('live-mode').children){b.setAttribute('aria-checked',String(b.dataset.mode===live.mode));b.disabled=!live.enabled;}
 $('live-fetch').disabled=!live.enabled||live.busy||!store;$('live-fetch').classList.toggle('spinning',live.busy);
 renderAgo();
 if(liveRendered!==live.version){liveRendered=live.version;render();}
}
function clearData() {
  $('load-progress').hidden=true;document.documentElement.classList.remove('initial-loading');
  bmFilter='all';cloudCache=null;cacheSavedAt=null;cacheMessage='';$('cache-state').textContent='';
  generation++;selectionRoot=null;selectedAccounts=null;controller?.abort();controller=null;reader=null;store=null;selectedRoot=null;busy=false;live.clear();$('live-bar').hidden=true;$('topbar-pill').hidden=false;
  $('dashboard').hidden=true;$('folder-panel').hidden=true;
  document.documentElement.classList.remove('app-loaded');currentWarnings=[];sourcePage=warningPage=allocationPage=0;showView('overview');
  for(const id of ['source-pages','warning-pages','data-alert','overview-detail'])$(id).replaceChildren();
  $('back-portfolio').hidden=true;
  for(const id of ['positions','stats','allocation','largest','provenance','warnings','folder-results'])$(id).replaceChildren();
  $('account-options').replaceChildren();$('account-panel').hidden=true;$('account-button').setAttribute('aria-expanded','false');$('account-button').textContent='All accounts ▾';$('folder-id').value='';$('search').value='';$('freshness').textContent='';$('store-name').textContent='Portfolio';
  $('bm-note').textContent='';
  $('holdings-title').textContent='Holdings';$('table-note').textContent='';
  for(const id of ['refresh','load-folder','find-folders'])$(id).disabled=false;
}
function disconnect(message='Disconnected. Portfolio data has been cleared.') {
  refreshSchedule.stop();clearTimeout(expireTimer);portfolioCache?.clear();portfolioCache=null;clearSession();clearData();token=null;expiry=0;sessionRemembered=false;$('disconnect').hidden=true;$('connect-panel').hidden=false;$('connect').disabled=false;status(message);
}
$('disconnect').addEventListener('click',()=>{closeAppMenu();disconnect();});
// The logo opens a small menu (Disconnect lives there to keep the top bar compact).
function closeAppMenu(){$('app-menu').hidden=true;$('brand-button').setAttribute('aria-expanded','false');}
$('brand-button').addEventListener('click',event=>{event.stopPropagation();if($('disconnect').hidden){location.href='./';return;}const open=$('app-menu').hidden;$('app-menu').hidden=!open;$('brand-button').setAttribute('aria-expanded',String(open));if(open)$('disconnect').focus();});
document.addEventListener('click',event=>{if(!$('app-menu').hidden&&!event.target.closest('.app-menu'))closeAppMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('app-menu').hidden){closeAppMenu();$('brand-button').focus();}});
$('connect').addEventListener('click',()=>{
  // Every authorization is an account switch boundary. Clear old data before opening Google.
  disconnect('Opening Google account selection…');
  const clientId=$('client-id').value.trim();
  if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))return status('Enter the public client ID of a Google Web application OAuth client.',true);
  if(!window.google?.accounts?.oauth2)return status('Google Identity Services did not load. Check your connection or browser content blocker, then try again.',true);
  $('connect').disabled=true;const attempt=generation;
  const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:READ_SCOPE+($('drive-cache-opt').checked?' '+CACHE_SCOPE:''),include_granted_scopes:false,
    callback:response=>{
      if(attempt!==generation)return;
      $('connect').disabled=false;
      if(response.error||!response.access_token)return status('Google authorization was not completed. Try connecting again.',true);
      if(!google.accounts.oauth2.hasGrantedAllScopes(response,READ_SCOPE)&&!google.accounts.oauth2.hasGrantedAllScopes(response,CACHE_SCOPE))return status('Drive read-only permission is required to read the existing store.',true);
      activateSession({clientId,accessToken:response.access_token,expiresAt:Date.now()+Number(response.expires_in||3600)*1000,rootId:'',sharedCacheWriter:$('drive-cache-opt').checked&&google.accounts.oauth2.hasGrantedAllScopes(response,CACHE_SCOPE)});
      status('Connected. Finding your Market data…');findFolders(true);
    },error_callback:()=>{if(attempt===generation){$('connect').disabled=false;status('The Google popup was closed or blocked. Allow popups and try again.',true);}}
  });
  try {client.requestAccessToken({prompt:'select_account'});}catch{ $('connect').disabled=false;status('Could not open Google authorization. Check this site’s authorized JavaScript origin in Google Cloud.',true); }
});
async function action(work) {
  if(busy)return;
  if(!reader||Date.now()>=expiry){disconnect('Connect to Google Drive to continue.');return;}
  const attempt=generation;busy=true;
  document.documentElement.classList.toggle('initial-loading',!store);loading('Finding your saved portfolio…',5);
  for(const id of ['refresh','load-folder','find-folders'])$(id).disabled=true;
  try {await work(attempt);}catch(e){if(attempt!==generation||e.name==='AbortError')return;if(e.authExpired)disconnect(e.message);else {if(!store)$('folder-panel').hidden=false;status(e.message||'Could not load Drive data.',true);}}
  finally{if(attempt===generation){busy=false;$('load-progress').hidden=true;document.documentElement.classList.remove('initial-loading');for(const id of ['refresh','load-folder','find-folders'])$(id).disabled=false;}}
}
function displayStore(result,id,views){
 if(views)calculations.set(result,new Map(views));
 store=result;selectedRoot=id;sourcePage=warningPage=allocationPage=0;
 if(selectionRoot!==id){selectedAccounts=restoreSelection($('client-id').value.trim(),id);selectionRoot=id;}
 renderAccountPicker();
 $('folder-panel').hidden=true;$('folder-results').replaceChildren();render();
}
function cacheStatus(message){cacheMessage=message;$('cache-state').textContent=(cacheSavedAt?'Dashboard cached '+cacheAge(cacheSavedAt)+' · ':'')+message;}
async function openFolder(id,force=false) {
 if(busy)return false;
 let succeeded=false;
 if(selectedRoot!==id){refreshSchedule.stop();live.clear();store=null;cacheSavedAt=null;$('dashboard').hidden=true;$('back-portfolio').hidden=true;}
 await action(async attempt=>{
  const cache=portfolioCache,drive=reader,cloud=cloudCache;
  let cached=await cache?.get('portfolio:'+id),saved=null;
  if(attempt!==generation)return;
  const publish=async()=>{
   const views=calculations.get(store)||new Map();
   if(!views.has('null'))views.set('null',buildPortfolio(store.snapshots,store.dividends,'',store.reports||[],store.smallcases||[]));
   await cloud.save(id,makeDriveCache(store,views));
  };
  try{
   const root=await drive.get('/files/'+encodeURIComponent(id),{fields:'id,name,mimeType,trashed',supportsAllDrives:'true'});
   if(root.trashed||root.mimeType!=='application/vnd.google-apps.folder')throw Object.assign(new Error('Source folder unavailable.'),{accessDenied:true});
   if(attempt!==generation)return;
   try{saved=await cloud.load(id);}catch(error){if(error.authExpired||error.name==='AbortError')throw error;}
   if(attempt!==generation)return;
   if(saved&&(!cached||Date.parse(saved.store.loadedAt)>=Date.parse(cached.loadedAt))){cached=saved.store;cacheSavedAt=saved.savedAt;}else if(cached)saved=null;
   if(cached){displayStore(cached,id,saved?.views);cacheSavedAt=cacheSavedAt||cached.loadedAt;cacheStatus('Checking snapshot metadata in background…');$('load-progress').hidden=true;}
   else status('Loading saved portfolio files…');
   let signature=await drive.snapshotSignature(id);if(attempt!==generation)return;
   if(reuseSharedCache(cached?{store:cached}:null,{signature})){
    if(cloud.writeEnabled&&!reuseSharedCache(saved,{signature}))await publish();
    if(attempt!==generation)return;
    await cache?.set('portfolio:'+id,cached);if(attempt!==generation)return;
    rememberSession();succeeded=true;refreshSchedule.succeeded();
    cacheStatus(saved?'Shared cache · snapshot inputs unchanged.':'Saved calculation · snapshot inputs unchanged.');
    status('Checked snapshot metadata. Reused the existing calculations.');return;
   }
   if(saved&&!cloud.writeEnabled&&!force){
    rememberSession();succeeded=true;refreshSchedule.succeeded();
    cacheStatus('New snapshots available · waiting for an editor to update the shared cache.');
    status('Showing dated shared cache. Refresh snapshots can calculate a local view now.');return;
   }
   const read=()=>drive.load(id,(message,value)=>{if(attempt===generation&&!cached)loading(message,value);});
   let result=await read();if(attempt!==generation)return;
   let after=await drive.snapshotSignature(id);if(attempt!==generation)return;
   // If collection raced this read, retry using cached bodies and do not publish a mixed set.
   if(signature!==after){signature=after;result=await read();if(attempt!==generation)return;after=await drive.snapshotSignature(id);if(attempt!==generation)return;}
   result.sourceSignature=signature&&signature===after?signature:null;
   await cache?.set('portfolio:'+id,result);if(attempt!==generation)return;
   if(!cached||!samePortfolio(cached,result))displayStore(result,id);else{store.loadedAt=result.loadedAt;store.sourceSignature=result.sourceSignature;render();}
   rememberSession();succeeded=true;refreshSchedule.succeeded();cacheSavedAt=result.loadedAt;
   status('Calculated current snapshot set. Saved capture prices; no live quotes.');
   if(cloud.writeEnabled&&result.sourceSignature){
    try{await publish();if(attempt===generation)cacheStatus('Shared cache saved for this snapshot set.');}
    catch(error){if(attempt!==generation)return;if(error.authExpired||error.name==='AbortError')throw error;cacheStatus(error.cacheReadOnly?'Calculated · a folder editor must publish the shared cache.':'Calculated · shared cache save failed; retry on refresh.');}
   }else cacheStatus(!result.sourceSignature?'Sources changed or revision metadata missing · not published.':'Calculated locally · an editor can publish this snapshot set for everyone.');
  }catch(error){
   if(attempt!==generation)throw error;if(error.authExpired)throw error;
   if(error.accessDenied){store=null;$('dashboard').hidden=true;document.documentElement.classList.remove('app-loaded');await cache?.clear();portfolioCache=null;cacheSavedAt=null;}
   else if(cached&&store){cacheStatus('Update failed · showing dated cached data. Retry with Refresh snapshots.');status('Showing saved dashboard; Drive check failed.',true);return;}
   throw error;
  }
 });return succeeded;
}
async function findFolders(openUnique=false){
 let target=null;const started=generation;
 await action(async attempt=>{
  status('Finding folders named market-data…');const folders=await reader.findStores();if(attempt!==generation)return;
  $('folder-results').replaceChildren();
  for(const folder of folders){const button=text('button',`${folder.name} · ${folder.id.slice(-6)}`);button.addEventListener('click',()=>openFolder(folder.id));$('folder-results').append(button);}
  if(openUnique&&folders.length===1)target=folders[0].id;
  status(folders.length?`Found ${folders.length} folder(s). Choose the intended store. If names repeat, use its exact Drive link.`:'No folder named market-data found. Paste a folder link shared with this Google account.');
 });
 if(target&&started===generation)await openFolder(target);
}
$('find-folders').addEventListener('click',()=>findFolders());
$('load-folder').addEventListener('click',()=>{try{openFolder(folderId($('folder-id').value));}catch(e){status(e.message,true);}});
$('refresh').addEventListener('click',()=>{if(selectedRoot)openFolder(selectedRoot,true);});
$('live-mode').replaceChildren(...LIVE_MODES.map(m=>{const b=text('button',m.short);b.type='button';b.dataset.mode=m.id;b.setAttribute('role','radio');b.title=m.label+(m.max?` (stops after ${m.max})`:'');b.addEventListener('click',()=>live.setMode(m.id));return b;}));
setInterval(()=>{if(store)renderAgo();},30000);
$('live-fetch').addEventListener('click',()=>live.fetchNow());
renderLive();
$('change-folder').addEventListener('click',()=>{$('folder-panel').hidden=false;$('dashboard').hidden=true;$('back-portfolio').hidden=false;});
$('back-portfolio').addEventListener('click',()=>{if(store){$('folder-panel').hidden=true;$('dashboard').hidden=false;}});
$('search').addEventListener('input',renderPositions);
document.addEventListener('visibilitychange',()=>{if(token&&Date.now()>=expiry)disconnect('Google access expired. Connect again.');});
window.addEventListener('pageshow',event=>{if(event.persisted&&token&&Date.now()>=expiry-10000)disconnect('Google access expired. Connect again to continue.');});
function bar(container,name,value,share,colour='') {
  const row=text('div','','bar-row');const label=text('div','','bar-label');label.append(text('span',name),text('span',`${money(value)} · ${numeric(share)?share.toFixed(1)+'%':'—'}`));
  const track=text('div','','bar-track'),fill=text('div','',`bar-fill ${colour}`);fill.style.width=`${Math.max(0,Math.min(100,share||0))}%`;track.append(fill);row.append(label,track);container.append(row);
}
const calculations=new WeakMap();
function current(){const liveSnaps=liveSnapshots(),owner=liveSnaps||store;let accounts=calculations.get(owner);if(!accounts){accounts=new Map();calculations.set(owner,accounts);}const key=JSON.stringify(selectedAccounts);if(!accounts.has(key))accounts.set(key,buildPortfolio(liveSnaps||store.snapshots,store.dividends,selectedAccounts??'',store.reports||[],store.smallcases||[]));return accounts.get(key);}
function selectedSnapshots(){return store.snapshots.filter(s=>selectedAccounts===null||selectedAccounts.includes(s.partition));}
function render() {
  if(!store)return;const p=current();$('dashboard').hidden=false;document.documentElement.classList.add('app-loaded');$('store-name').textContent=store.root.name;
  const selected=selectedSnapshots();
  const dates=[...new Set(selected.map(s=>s.as_of||'unknown'))].sort();
  // Price and position age now live in the top bar; only the empty-selection hint stays here.
  $('freshness').textContent=selected.length?'':'No accounts selected';$('freshness').hidden=Boolean(selected.length);
  $('live-bar').hidden=false;$('topbar-pill').hidden=true;renderLive();
  const warnings=[...store.warnings];
  if(dates.length>1)warnings.push('Combined totals mix capture dates; see each account below.');
  if(p.incomplete)warnings.push(`${p.incomplete} holding(s) have missing value or cost inputs. Affected totals and weights are unavailable.`);
  if(p.dividendAccounts.length&&p.dividendAccounts.length<p.accounts.length)warnings.push('Dividend coverage is partial: some selected accounts have no saved dividend reports.');
  for(const x of p.xirrExcluded||[])warnings.push(`XIRR leaves out ${x.name} (${x.account}): ${x.reason}.`);
  currentWarnings=warnings;
  $('data-alert').hidden=!warnings.length;$('data-alert').textContent=warnings.length?`${warnings.length} data warning${warnings.length===1?'':'s'} · Saved prices may be stale. See the Data tab.`:'';
  $('overview-detail').textContent=selected.length===0?'Choose one or more accounts to see your portfolio.':`${money(p.otherHoldingsValue)} in other holdings. Cash (LIQUIDCASE) and gold (GOLDCASE) are shown separately and included in total value. ${p.positions.length} holdings across ${p.accounts.length} accounts.`;
  $('stats').replaceChildren();
  const stats=[['CURRENT VALUE',money(p.value),''],['INVESTED',money(p.cost),'Cost of the captured holdings'],['OPEN HOLDINGS XIRR',numeric(p.xirr)?pct(p.xirr):'Unavailable',numeric(p.xirr)?(p.xirrExcluded?.length&&p.xirrCoverage?`Covers ${p.xirrCoverage.included} of ${p.xirrCoverage.total} holdings · see Data`:'Annualised · excludes sales/dividends'):p.xirrReason],['CASH EQUIVALENT',money(p.cashEquivalent),'LIQUIDCASE · '+(numeric(p.cashWeight)?p.cashWeight.toFixed(1)+'% of total':'weight unavailable')],['GOLD',money(p.goldValue),'GOLDCASE'],['DIVIDEND CREDITS',money(p.dividends),p.dividendAccounts.length?'Saved reports · separate from P&L':'No saved reports for these accounts']];
  for(const [label,value,note]of stats){
    const cash=label==='CASH EQUIVALENT',gold=label==='GOLD',c=text('section','',cash?'stat cash-stat':gold?'stat gold-stat':label==='CURRENT VALUE'?'stat value-stat':'stat');
    c.append(text('p',label,'eyebrow'),text('strong',value,label==='UNREALISED P&L'?(p.pnl<0?'loss':'gain'):label==='OPEN HOLDINGS XIRR'&&numeric(p.xirr)?(p.xirr<0?'loss':'gain'):''));
    if(label==='CURRENT VALUE'){
      const detail=text('div','','value-return');
      detail.append(text('span','Unrealised P&L','return-label'));
      const amounts=text('span','',numeric(p.pnl)?(p.pnl<0?'return-amount loss':'return-amount gain'):'return-amount');
      amounts.append(text('span',money(p.pnl)),text('span',numeric(p.returnPct)?`(${pct(p.returnPct)})`:'','return-percent'));
      detail.append(amounts);c.append(detail);
    }else if(cash||gold){
      const weight=gold?p.goldWeight:p.cashWeight;
      c.setAttribute('aria-label',gold?'GOLDCASE gold':'LIQUIDCASE cash equivalent');
      const detail=text('p','','fine cash-detail');
      detail.append(text('span',numeric(weight)?weight.toFixed(1)+'%':'—','cash-share'),text('span',numeric(weight)?'of portfolio':'share unavailable'));
      c.append(detail);
    }else c.append(text('p',note,'fine'));
    $('stats').append(c);
  }
  renderDetails();
  renderPositions();
}
function renderPositions(){
 if(!store)return;const p=current(),query=$('search').value;
 const rows=bmRows(p,bmFilter,query);$('positions').replaceChildren();
 const pending=p.accounts.length?(p.bm.pending||[]).length:0,removed=p.positions.filter(r=>r.bmState==='removed').length,missing=(p.bm.pending||[]).filter(r=>r.bmState==='missing').length;
 for(const [filter,label,count]of [['all','All holdings',p.positions.length],['bm','BM',p.bm.matched+pending||0],['missing','Not held',p.accounts.length?missing:0],['removed','Removed',removed]]){
  const b=$('filter-'+filter);b.textContent=label+' '+count;b.setAttribute('aria-pressed',String(bmFilter===filter));
 }
 const labels=['Quantity','Invested','Value','Unrealised','Return','Portfolio %','BM target','BM current','BM diff.'];
 for(const r of rows){
  const tr=document.createElement('tr');tr.className='holding-row '+r.bmState;
  const name=text('td','','holding-name');name.append(text('strong',r.name));
  if(r.bmState!=='other'){
   const label={member:'BM',missing:'Not held',unresolved:'Match unclear',removed:'Removed from BM'}[r.bmState];
   name.append(text('span',label,'bm-badge '+r.bmState));
  }
  name.append(text('small',r.bmState==='unresolved'?'Needs an exact instrument match':r.placeholder?'Not held in selected accounts':r.accounts.join(' · '),'fine'));
  if(r.removedSince)name.append(text('small','Absent from BM since '+r.removedSince.slice(0,10),'fine'));
  tr.append(name);
  const share=n=>numeric(n)?n.toFixed(1)+'%':'—';
  const values=[number(r.quantity),r.placeholder?'—':money(r.cost),r.placeholder?'—':money(r.value),r.placeholder?'—':money(r.pnl),pct(r.returnPct),share(r.weight),share(r.bmTarget),share(r.bmWeight),numeric(r.bmDrift)?`${r.bmDrift>=0?'+':''}${r.bmDrift.toFixed(1)} pp`:'—'];
  for(const [i,v]of values.entries()){const cell=text('td',v,i===3||i===4?(r.pnl<0?'loss':'gain'):'');cell.dataset.label=labels[i];tr.append(cell);}
  $('positions').append(tr);
 }
 if(!rows.length){const tr=document.createElement('tr'),td=text('td',!p.accounts.length?'Choose one or more accounts.':bmFilter==='removed'&&!p.bm.historyAvailable?'Removal history unavailable. Publish an older BM capture to identify removed holdings.':'No matching entries.');td.colSpan=10;tr.append(td);$('positions').append(tr);}
 $('holdings-title').textContent=bmFilter==='all'?'Holdings · '+p.positions.length:'BM · '+rows.length;
 $('bm-note').textContent=p.bm.available?`BM rebalance ${p.bm.asOf||'unknown'} · saved ${stamp(p.bm.capturedAt)}. Targets cover the full current BM lineup. Current % uses BM holdings only. ${p.bm.historyAvailable?'Removed badges use saved membership history.':'No older BM capture: removals cannot be identified.'}`:p.bm.reason;
 $('table-note').textContent=`${rows.length} entries · Not-held placeholders never affect portfolio totals. Difference = current − target (percentage points).`;
}
for(const filter of ['all','bm','missing','removed'])$('filter-'+filter).addEventListener('click',()=>{bmFilter=filter;renderPositions();});

function showView(view,focus=false){
 activeView=view;
 for(const button of document.querySelectorAll('.view-tabs [role="tab"]')){
  const selected=button.id===`tab-${view}`;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  document.getElementById(button.getAttribute('aria-controls')).hidden=!selected;
  if(selected&&focus)button.focus();
 }
}
const viewButtons=[...document.querySelectorAll('.view-tabs [role="tab"]')];
for(const [index,button]of viewButtons.entries()){
 button.addEventListener('click',()=>showView(button.id.slice(4)));
 button.addEventListener('keydown',event=>{
  let next;if(event.key==='ArrowRight')next=(index+1)%viewButtons.length;else if(event.key==='ArrowLeft')next=(index+viewButtons.length-1)%viewButtons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=viewButtons.length-1;else return;
  event.preventDefault();showView(viewButtons[next].id.slice(4),true);
 });
}
function pageControls(id,page,count,onChange){
 const pages=Math.max(1,count);page=Math.min(page,pages-1);const container=$(id);container.replaceChildren();
 if(pages===1)return page;
 const previous=text('button','←'),next=text('button','→');previous.setAttribute('aria-label',`Previous ${id.split('-')[0]} page`);next.setAttribute('aria-label',`Next ${id.split('-')[0]} page`);
 previous.disabled=page===0;next.disabled=page===pages-1;
 previous.addEventListener('click',()=>onChange(page-1));next.addEventListener('click',()=>onChange(page+1));container.append(previous,text('span',`${page+1} / ${pages}`),next);return page;
}
const SVG='http://www.w3.org/2000/svg';
const svg=(tag,attrs={})=>{const e=document.createElementNS(SVG,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
const allAccountNames=()=>[...new Set(store.snapshots.map(s=>s.partition))];
// Allocation donut: every selected account with its share and value; colour follows the account name.
function renderDonut(p){
 const colors=accountColors(allAccountNames()),rows=p.accounts.filter(a=>numeric(a.value)&&a.value>0).sort((a,b)=>b.value-a.value),total=rows.reduce((t,a)=>t+a.value,0);
 const wrap=$('allocation');wrap.replaceChildren();
 if(!rows.length){wrap.append(text('p','No account values to chart.','fine'));return;}
 const chart=svg('svg',{viewBox:'0 0 200 200',class:'donut',role:'img','aria-label':'Account allocation: '+rows.map(a=>`${a.name} ${(a.value/total*100).toFixed(1)}%`).join(', ')});
 donutSlices(rows.map(a=>a.value)).forEach((slice,i)=>{if(!slice.d)return;const path=svg('path',{d:slice.d,fill:colors.get(rows[i].name),class:'donut-slice'});const tip=svg('title');tip.textContent=`${rows[i].name}: ${money(rows[i].value)} (${(slice.share*100).toFixed(1)}%)`;path.append(tip);chart.append(path);});
 const centre=svg('text',{x:100,y:96,'text-anchor':'middle',class:'donut-total'});centre.textContent=money(total);
 const caption=svg('text',{x:100,y:116,'text-anchor':'middle',class:'donut-caption'});caption.textContent=rows.length+' account'+(rows.length===1?'':'s');chart.append(centre,caption);
 const legend=text('ul','','donut-legend');
 for(const a of rows){const li=text('li','');const key=text('i','','donut-key');key.style.background=colors.get(a.name);li.append(key,text('span',a.name,'donut-name'),text('span',(a.value/total*100).toFixed(1)+'%','donut-share'),text('span',money(a.value),'donut-value'));legend.append(li);}
 wrap.append(chart,legend);
}
// Update race: how long ago each account's positions (bar) and prices (thin bar) were refreshed.
function renderRace(){
 const now=Date.now(),selected=selectedSnapshots(),rows=selected.map(s=>{
  const src=store.progressiveSources?.find(p=>p.account===s.partition),positionsAt=src?.positionsAt||s.captured_at||s.confirmedAt;
  const pricesAt=live.lastAt&&live.quotes.size?live.lastAt:(src?.pricesTo||src?.pricesFrom||positionsAt);
  return {name:s.partition,pos:Math.max(0,now-Date.parse(positionsAt)),price:Math.max(0,now-Date.parse(pricesAt)),positionsAt,pricesAt};
 }).filter(r=>Number.isFinite(r.pos)).sort((a,b)=>a.pos-b.pos);
 const race=$('race');race.replaceChildren();if(!rows.length){race.append(text('p','No accounts selected.','fine'));return;}
 const scale=raceScale(Math.max(...rows.map(r=>Math.max(r.pos,Number.isFinite(r.price)?r.price:0))));
 for(const r of rows){
  const row=text('div','','race-row');row.title=`${r.name}\nPositions: ${stamp(r.positionsAt)}\nPrices: ${stamp(r.pricesAt)}`;
  const track=text('div','','race-track'),bar=text('div','','race-bar'),price=text('div','','race-price');
  bar.style.width=(raceProgress(r.pos,scale)*100).toFixed(1)+'%';price.style.width=(raceProgress(Number.isFinite(r.price)?r.price:r.pos,scale)*100).toFixed(1)+'%';track.append(bar,price);
  const agoText=text('span','','race-ago');agoText.append(text('strong',shortAgo(r.pos)),text('small','prices '+shortAgo(Number.isFinite(r.price)?r.price:r.pos)));
  row.append(text('span',r.name,'race-name'),track,agoText);race.append(row);
 }
 const axis=text('div','','race-axis');for(const t of scale.ticks){const tick=text('span',t===0?'now':t+scale.unit);tick.style.left=((1-t/scale.max)*100).toFixed(1)+'%';axis.append(tick);}
 race.append(axis);
}
function renderDetails(){
 if(!store)return;const p=current(),small=innerWidth<700||innerHeight<650,sourceSize=small?1:3,warningSize=small?1:2;
 renderDonut(p);renderRace();
 $('largest').replaceChildren();for(const r of p.positions.slice(0,5))bar($('largest'),r.name,r.value,r.weight,'violet');
 const selected=selectedSnapshots();
 sourcePage=pageControls('source-pages',sourcePage,Math.ceil(selected.length/sourceSize),page=>{sourcePage=page;renderDetails();});
 $('provenance').replaceChildren();for(const s of selected.slice(sourcePage*sourceSize,(sourcePage+1)*sourceSize)){
  const card=text('div','','source-entry');card.append(text('strong',s.partition));
  const data=text('div','','source-facts');for(const [label,value]of (store.progressiveSources?.find(p=>p.account===s.partition)?[['Positions reconciled',stamp(store.progressiveSources.find(p=>p.account===s.partition).positionsAt)],['Prices fetched',stamp(store.progressiveSources.find(p=>p.account===s.partition).pricesFrom)],['Valuation date',s.as_of||'Mixed price dates']]:[['Holdings / prices',s.as_of||'Unknown'],['Captured',stamp(s.captured_at)],['Confirmed',stamp(s.confirmedAt)]])){const fact=text('div','');fact.append(text('span',label),text('span',value));data.append(fact);}card.append(data);$('provenance').append(card);
 }
 $('warnings-card').hidden=!currentWarnings.length;$('warnings').hidden=!currentWarnings.length;
 warningPage=pageControls('warning-pages',warningPage,Math.ceil(currentWarnings.length/warningSize),page=>{warningPage=page;renderDetails();});
 $('warnings').replaceChildren(...currentWarnings.slice(warningPage*warningSize,(warningPage+1)*warningSize).map(w=>text('p',w)));
}
window.addEventListener('resize',()=>{if(store){sourcePage=warningPage=allocationPage=0;renderDetails();}});

for(const [button,card]of [['show-accounts','account-chart'],['show-largest','largest-chart']])$(button).addEventListener('click',()=>{
 for(const [b,c]of [['show-accounts','account-chart'],['show-largest','largest-chart']]){$(b).setAttribute('aria-pressed',String(b===button));$(c).classList.toggle('chart-current',c===card);}
});

const refreshSchedule=new RefreshSchedule({
 interval:()=>store?.progressiveSources?.length?5*60*1000:4*60*60*1000,
 refresh:()=>selectedRoot?openFolder(selectedRoot):false,
 enabled:()=>Boolean(reader&&token&&Date.now()<expiry&&!busy&&navigator.onLine)
});
function resumeRefresh(){if(document.visibilityState==='visible')refreshSchedule.check();}
window.addEventListener('focus',resumeRefresh);window.addEventListener('online',resumeRefresh);window.addEventListener('pageshow',resumeRefresh);document.addEventListener('visibilitychange',resumeRefresh);
function renderAccountPicker(){
 const names=[...new Set(store.snapshots.map(s=>s.partition))].sort();
 const chosen=names.filter(name=>selectedAccounts===null||selectedAccounts.includes(name));
 $('account-button').textContent=selectedAccounts===null?'All accounts ▾':chosen.length===0?'Choose accounts ▾':chosen.length===1?chosen[0]+' ▾':chosen.length+' accounts ▾';
 $('account-button').title=chosen.join(', ');$('account-options').replaceChildren();
 for(const name of names){const label=text('label','','account-choice'),input=document.createElement('input');input.type='checkbox';input.value=name;input.checked=chosen.includes(name);
  input.addEventListener('change',()=>{
   const selected=[...$('account-options').querySelectorAll('input:checked')].map(input=>input.value);
   selectedAccounts=selected.length===names.length?null:selected.sort();persistAccountChoice();
   $('account-button').textContent=selectedAccounts===null?'All accounts ▾':!selected.length?'Choose accounts ▾':selected.length===1?selected[0]+' ▾':selected.length+' accounts ▾';
   $('account-button').title=selected.join(', ');sourcePage=warningPage=allocationPage=0;render();
  });label.append(input,text('span',name));$('account-options').append(label);
 }
}
function persistAccountChoice(){const saved=saveSelection($('client-id').value.trim(),selectedRoot,selectedAccounts);$('account-save-status').textContent=saved?'Selection saved':'Browser storage blocked; selection lasts for this page only.';}
function closeAccounts(){ $('account-panel').hidden=true;$('account-button').setAttribute('aria-expanded','false');}
$('account-button').addEventListener('click',()=>{const open=$('account-panel').hidden;$('account-panel').hidden=!open;$('account-button').setAttribute('aria-expanded',String(open));});
$('accounts-all').addEventListener('click',()=>{selectedAccounts=null;persistAccountChoice();renderAccountPicker();render();});
$('accounts-none').addEventListener('click',()=>{selectedAccounts=[];persistAccountChoice();renderAccountPicker();render();});
document.addEventListener('click',event=>{if(!event.target.closest('.account-picker'))closeAccounts();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('account-panel').hidden){closeAccounts();$('account-button').focus();}});

function rememberSession(){
 sessionRemembered=saveSession({clientId:$('client-id').value.trim(),accessToken:token,expiresAt:expiry,rootId:selectedRoot||'',cacheScope:portfolioCache?.scope,sharedCacheWriter:cloudCache?.writeEnabled===true});
}
function activateSession(session){
 token=session.accessToken;expiry=session.expiresAt;selectedRoot=session.rootId||null;
 portfolioCache=new PortfolioCache(session.cacheScope||crypto.randomUUID(),expiry);
 controller=new AbortController();cloudCache=new DriveDashboardCache(token,{signal:controller.signal,writeEnabled:session.sharedCacheWriter===true});reader=new DriveReader(token,{signal:controller.signal,cache:portfolioCache});rememberSession();
 clearTimeout(expireTimer);expireTimer=setTimeout(()=>disconnect('Google access expired. Connect again to continue.'),Math.max(0,expiry-Date.now()-10000));
 $('connect-panel').hidden=true;$('disconnect').hidden=false;$('folder-panel').hidden=false;
}
function initializePortfolio(){
 const previousSession=restoreSession($('client-id').value.trim());
 if(previousSession){
  activateSession(previousSession);
  if(previousSession.rootId){$('folder-panel').hidden=true;status('Restoring your dashboard from Google Drive…');openFolder(previousSession.rootId);}
  else findFolders(true);
 }else status('Connect Google Drive to load your Market data automatically.');
}
async function unlockApp(){
 if($('unlock').disabled)return;
 $('unlock').disabled=true;
 try{
  const clientId=await decryptClientId(oauthConfig,$('app-pin').value);
  $('app-pin').value='';$('client-id').value=clientId;$('client-id').readOnly=true;$('client-configuration').hidden=true;
  $('unlock-panel').hidden=true;$('connect-panel').hidden=false;initializePortfolio();
 }catch(error){$('app-pin').value='';status(error.message,true);$('app-pin').focus();}
 finally{$('unlock').disabled=false;}
}
$('unlock').addEventListener('click',unlockApp);$('app-pin').addEventListener('keydown',event=>{if(event.key==='Enter')unlockApp();});
if(oauthConfig){$('connect-panel').hidden=true;$('unlock-panel').hidden=false;status('Enter your app PIN to continue.');}
else initializePortfolio();
setInterval(()=>{if(store)cacheStatus(cacheMessage);},60000);
