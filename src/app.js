import {PortfolioCache,samePortfolio} from './cache.js';
import {buildPortfolio,numeric} from './model.js';
import {DriveReader,folderId} from './drive.js';
import {restoreClientId,saveClientId} from './preferences.js';
import {restoreSession,saveSession,clearSession} from './session.js';
const $=id=>document.getElementById(id);
$('client-id').value=restoreClientId();
$('client-id').addEventListener('input',()=>saveClientId($('client-id').value.trim()));
const money=x=>numeric(x)?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(x):'Unavailable';
const pct=x=>numeric(x)?`${x>=0?'+':''}${x.toFixed(2)}%`:'—';
const number=x=>numeric(x)?new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(x):'—';
const stamp=x=>x?new Date(x).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'Unknown';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
let reader=null,token=null,expiry=0,expireTimer=null,controller=null,store=null,selectedRoot=null,generation=0,busy=false;
let activeView='overview',sourcePage=0,warningPage=0,allocationPage=0,currentWarnings=[],sessionRemembered=false,portfolioCache=null;
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
function clearData() {
  generation++;controller?.abort();controller=null;reader=null;store=null;selectedRoot=null;busy=false;
  $('dashboard').hidden=true;$('folder-panel').hidden=true;
  document.documentElement.classList.remove('app-loaded');currentWarnings=[];sourcePage=warningPage=allocationPage=0;showView('overview');
  for(const id of ['source-pages','warning-pages','allocation-pages','data-alert','overview-detail'])$(id).replaceChildren();
  $('back-portfolio').hidden=true;
  for(const id of ['positions','stats','allocation','largest','provenance','warnings','folder-results'])$(id).replaceChildren();
  $('account').replaceChildren(new Option('Combined accounts',''));$('folder-id').value='';$('search').value='';$('freshness').textContent='';$('store-name').textContent='Portfolio';
  $('holdings-title').textContent='Holdings';$('table-note').textContent='';
  for(const id of ['refresh','load-folder','find-folders'])$(id).disabled=false;
}
function disconnect(message='Disconnected. Portfolio data has been cleared.') {
  clearTimeout(expireTimer);portfolioCache?.clear();portfolioCache=null;clearSession();clearData();token=null;expiry=0;sessionRemembered=false;$('disconnect').hidden=true;$('connect-panel').hidden=false;$('connect').disabled=false;status(message);
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
      activateSession({clientId,accessToken:response.access_token,expiresAt:Date.now()+Number(response.expires_in||3600)*1000,rootId:''});
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
  try {await work(attempt);}catch(e){if(attempt!==generation||e.name==='AbortError')return;if(e.authExpired)disconnect(e.message);else {if(!store)$('folder-panel').hidden=false;status(e.message||'Could not load Drive data.',true);}}
  finally{if(attempt===generation){busy=false;for(const id of ['refresh','load-folder','find-folders'])$(id).disabled=false;}}
}
function displayStore(result,id){
 store=result;selectedRoot=id;sourcePage=warningPage=allocationPage=0;
 $('account').replaceChildren(new Option('Combined accounts',''));
 for(const snapshot of [...store.snapshots].sort((a,b)=>a.partition.localeCompare(b.partition)))$('account').add(new Option(snapshot.partition,snapshot.partition));
 $('folder-panel').hidden=true;$('folder-results').replaceChildren();render();
}
async function openFolder(id) {
 if(busy)return;
 if(selectedRoot!==id){store=null;$('dashboard').hidden=true;$('back-portfolio').hidden=true;
  for(const key of ['positions','stats','allocation','largest','provenance','warnings'])$(key).replaceChildren();
  $('account').replaceChildren(new Option('Combined accounts',''));$('search').value='';
 }
 await action(async attempt=>{
  const cache=portfolioCache;
  const cached=await cache?.get('portfolio:'+id);
  if(attempt!==generation)return;
  if(cached){displayStore(cached,id);status('Showing cached portfolio. Checking Google Drive for changes…');}
  else status('Opening the Drive store…');
  try{
   const result=await reader.load(id,message=>{if(attempt===generation&&!cached)status(message);});
   if(attempt!==generation)return;
   await cache?.set('portfolio:'+id,result);
   if(attempt!==generation)return;
   if(!cached||!samePortfolio(cached,result))displayStore(result,id);
   else {store.loadedAt=result.loadedAt;$('freshness').textContent=$('freshness').textContent.replace(/ · Read .*/,` · Read ${stamp(result.loadedAt)}`);}
   rememberSession();
   status('Checked Google Drive. Saved capture prices; no live quotes.'+(cache?.disabled?' Browser cache unavailable.':'')+(sessionRemembered?'':' Refresh will require reconnecting.'));
  }catch(error){
   if(attempt!==generation)throw error;
   if(error.authExpired)throw error;
   // A denied or deleted root must never leave cached private values on screen.
   if(error.accessDenied){store=null;$('dashboard').hidden=true;document.documentElement.classList.remove('app-loaded');await cache?.clear();portfolioCache=null;}
   else if(cached){status('Showing cached data from '+stamp(cached.loadedAt)+'. Drive check failed; this data may be out of date.',true);return;}
   throw error;
  }
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
$('change-folder').addEventListener('click',()=>{$('folder-panel').hidden=false;$('dashboard').hidden=true;$('back-portfolio').hidden=false;});
$('back-portfolio').addEventListener('click',()=>{if(store){$('folder-panel').hidden=true;$('dashboard').hidden=false;}});
$('account').addEventListener('change',render);$('search').addEventListener('input',renderPositions);
document.addEventListener('visibilitychange',()=>{if(token&&Date.now()>=expiry)disconnect('Google access expired. Connect again.');});
window.addEventListener('pageshow',event=>{if(event.persisted&&token&&Date.now()>=expiry-10000)disconnect('Google access expired. Connect again to continue.');});
function bar(container,name,value,share,colour='') {
  const row=text('div','','bar-row');const label=text('div','','bar-label');label.append(text('span',name),text('span',`${money(value)} · ${numeric(share)?share.toFixed(1)+'%':'—'}`));
  const track=text('div','','bar-track'),fill=text('div','',`bar-fill ${colour}`);fill.style.width=`${Math.max(0,Math.min(100,share||0))}%`;track.append(fill);row.append(label,track);container.append(row);
}
const calculations=new WeakMap();
function current(){let accounts=calculations.get(store);if(!accounts){accounts=new Map();calculations.set(store,accounts);}const account=$('account').value;if(!accounts.has(account))accounts.set(account,buildPortfolio(store.snapshots,store.dividends,account));return accounts.get(account);}
function render() {
  if(!store)return;const p=current();$('dashboard').hidden=false;document.documentElement.classList.add('app-loaded');$('store-name').textContent=store.root.name;
  const selected=store.snapshots.filter(s=>!$('account').value||s.partition===$('account').value);
  const dates=[...new Set(selected.map(s=>s.as_of||'unknown'))].sort();
  $('freshness').textContent=`Saved prices: ${dates.join(' · ')} · Read ${stamp(store.loadedAt)}`;
  const warnings=[...store.warnings];
  if(dates.length>1)warnings.push('Combined totals mix capture dates; see each account below.');
  if(p.incomplete)warnings.push(`${p.incomplete} holding(s) have missing value or cost inputs. Affected totals and weights are unavailable.`);
  if(p.dividendAccounts.length&&p.dividendAccounts.length<p.accounts.length)warnings.push('Dividend coverage is partial: some selected accounts have no saved dividend reports.');
  currentWarnings=warnings;
  $('data-alert').hidden=!warnings.length;$('data-alert').textContent=warnings.length?`${warnings.length} data warning${warnings.length===1?'':'s'} · Saved prices may be stale. See the Data tab.`:'';
  $('overview-detail').textContent=`${money(p.otherHoldingsValue)} in other holdings; LIQUIDCASE is shown separately as your cash equivalent and remains included in total value. ${p.positions.length} holdings across ${p.accounts.length} account${p.accounts.length===1?'':'s'}. Saved as of ${dates.join(' · ')}.`;
  $('stats').replaceChildren();
  const stats=[['CAPTURED MARKET VALUE',money(p.value),`${p.positions.length} holdings · ${p.accounts.length} accounts`],['INVESTED',money(p.cost),'Cost of the captured holdings'],['UNREALISED P&L',money(p.pnl),pct(p.returnPct)],['CASH EQUIVALENT',money(p.cashEquivalent),'LIQUIDCASE · '+(numeric(p.cashWeight)?p.cashWeight.toFixed(1)+'% of total':'weight unavailable')],['SAVED DIVIDEND CREDITS',money(p.dividends),p.dividendAccounts.length?'All available report dates · separate from P&L':'No saved reports for these accounts']];
  for(const [label,value,note]of stats){
    const cash=label==='CASH EQUIVALENT',c=text('section','',cash?'stat cash-stat':'stat');
    c.append(text('p',label,'eyebrow'),text('strong',value,label==='UNREALISED P&L'?(p.pnl<0?'loss':'gain'):''));
    if(cash){
      c.setAttribute('aria-label','LIQUIDCASE cash equivalent');
      const detail=text('p','','fine cash-detail');
      detail.append(text('span',numeric(p.cashWeight)?p.cashWeight.toFixed(1)+'%':'—','cash-share'),text('span',numeric(p.cashWeight)?'of portfolio':'share unavailable'));
      c.append(detail);
    }else c.append(text('p',note,'fine'));
    $('stats').append(c);
  }
  renderDetails();
  renderPositions();
}
function renderPositions(){
  if(!store)return;const p=current(),query=$('search').value.trim().toLowerCase();$('positions').replaceChildren();
  const rows=p.positions.filter(r=>`${r.name} ${r.key}`.toLowerCase().includes(query));
  for(const r of rows){const tr=document.createElement('tr');const name=text('td','');name.append(text('strong',r.name),text('small',r.accounts.join(' · '),'fine'));tr.append(name);for(const [i,v]of [number(r.quantity),money(r.cost),money(r.value),money(r.pnl),pct(r.returnPct),numeric(r.weight)?r.weight.toFixed(1)+'%':'—'].entries())tr.append(text('td',v,i===3||i===4?(r.pnl<0?'loss':'gain'):''));$('positions').append(tr);}
  if(!rows.length){const tr=document.createElement('tr'),td=text('td',p.positions.length?'No matching holdings.':'This account was captured with no holdings.');td.colSpan=7;tr.append(td);$('positions').append(tr);}
  $('holdings-title').textContent=`Holdings · ${p.positions.length}`;$('table-note').textContent=`Showing ${rows.length} of ${p.positions.length}. Grouped by the source’s exact Groww slug; no guessed symbol matching. A dash or “Unavailable” means the inputs are missing.`;
}

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
function renderDetails(){
 if(!store)return;const p=current(),small=innerWidth<700||innerHeight<650,sourceSize=small?1:3,warningSize=small?1:2,chartSize=small?3:5;
 allocationPage=pageControls('allocation-pages',allocationPage,Math.ceil(p.accounts.length/chartSize),page=>{allocationPage=page;renderDetails();});
 $('allocation').replaceChildren();for(const a of p.accounts.slice(allocationPage*chartSize,(allocationPage+1)*chartSize))bar($('allocation'),a.name,a.value,numeric(p.value)&&p.value>0&&numeric(a.value)?a.value/p.value*100:null);
 $('largest').replaceChildren();for(const r of p.positions.slice(0,5))bar($('largest'),r.name,r.value,r.weight,'violet');
 const selected=store.snapshots.filter(s=>!$('account').value||s.partition===$('account').value);
 sourcePage=pageControls('source-pages',sourcePage,Math.ceil(selected.length/sourceSize),page=>{sourcePage=page;renderDetails();});
 $('provenance').replaceChildren();for(const s of selected.slice(sourcePage*sourceSize,(sourcePage+1)*sourceSize)){
  const card=text('div','','source-entry');card.append(text('strong',s.partition));
  const data=text('div','','source-facts');for(const [label,value]of [['Holdings / prices',s.as_of||'Unknown'],['Captured',stamp(s.captured_at)],['Confirmed',stamp(s.confirmedAt)]]){const fact=text('div','');fact.append(text('span',label),text('span',value));data.append(fact);}card.append(data);$('provenance').append(card);
 }
 $('warnings-card').hidden=!currentWarnings.length;$('warnings').hidden=!currentWarnings.length;
 warningPage=pageControls('warning-pages',warningPage,Math.ceil(currentWarnings.length/warningSize),page=>{warningPage=page;renderDetails();});
 $('warnings').replaceChildren(...currentWarnings.slice(warningPage*warningSize,(warningPage+1)*warningSize).map(w=>text('p',w)));
}
window.addEventListener('resize',()=>{if(store){sourcePage=warningPage=allocationPage=0;renderDetails();}});

for(const [button,card]of [['show-accounts','account-chart'],['show-largest','largest-chart']])$(button).addEventListener('click',()=>{
 for(const [b,c]of [['show-accounts','account-chart'],['show-largest','largest-chart']]){$(b).setAttribute('aria-pressed',String(b===button));$(c).classList.toggle('chart-current',c===card);}
});

function rememberSession(){
 sessionRemembered=saveSession({clientId:$('client-id').value.trim(),accessToken:token,expiresAt:expiry,rootId:selectedRoot||'',cacheScope:portfolioCache?.scope});
}
function activateSession(session){
 token=session.accessToken;expiry=session.expiresAt;selectedRoot=session.rootId||null;
 portfolioCache=new PortfolioCache(session.cacheScope||crypto.randomUUID(),expiry);
 controller=new AbortController();reader=new DriveReader(token,{signal:controller.signal,cache:portfolioCache});rememberSession();
 clearTimeout(expireTimer);expireTimer=setTimeout(()=>disconnect('Google access expired. Connect again to continue.'),Math.max(0,expiry-Date.now()-10000));
 $('connect-panel').hidden=true;$('disconnect').hidden=false;$('folder-panel').hidden=false;
}
const previousSession=restoreSession($('client-id').value.trim());
if(previousSession){
 activateSession(previousSession);
 if(previousSession.rootId){$('folder-panel').hidden=true;status('Restoring your dashboard from Google Drive…');openFolder(previousSession.rootId);}
 else status('Google session restored. Choose your Market folder.');
}
