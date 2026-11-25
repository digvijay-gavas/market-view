// Extra captures that ride along with a positions capture, in the same signed-in profile:
//  - BM: a subscribed smallcase's constituent weights (smallcases.groww.in, "Stocks & Weights").
//  - P&L: Groww's Stocks P&L export (current financial year; its open-lot table covers every
//    open holding regardless of range). The workbook is downloaded by Chrome and read by the
//    local collector from the path Chrome reports; the file is removed afterwards.
// Page functions below run inside the page (chrome.scripting) and must be self-contained.
export const SMALLCASE_URL=id=>'https://smallcases.groww.in/smallcase/'+encodeURIComponent(id)+'/stocks';
export const PNL_URL='https://groww.in/report/profit-loss/stocks?type=current-financial-year';

// True when this capture's quantities differ from the previous capture's (a buy, sell or new holding).
export function quantitiesChanged(previous,rows){
 if(!previous||!Array.isArray(rows))return false;
 const now=new Map(rows.filter(r=>r.qty>0).map(r=>[r.groww_slug,r.qty])),before=Object.entries(previous).filter(([,q])=>q>0);
 return now.size!==before.length||before.some(([slug,q])=>Math.abs((now.get(slug)??0)-q)>1e-9);
}
export function clickText(want){
 // Innermost visible element whose whole text is `want` (Groww/smallcase have no test hooks).
 const all=[...document.querySelectorAll('body *')].filter(e=>e.textContent.trim()===want&&e.getClientRects().length);
 const el=all.at(-1);if(!el)return false;
 const target=el.closest('button,a,[role="button"],[role="tab"]')||el;target.click();return true;
}
export function probeSmallcase(){
 const text=document.body?.innerText||'',visible=el=>el&&el.getClientRects().length>0;
 // Signed out: the header shows smallcase's Login button. Signed in without a subscription: the
 // constituents are replaced by "Invitation Required / Request Invite".
 const login=[...document.querySelectorAll('button[class*="LoginButton"]')].find(visible)||[...document.querySelectorAll('button')].find(b=>visible(b)&&b.textContent.trim()==='Login');
 return {host:location.hostname,ready:/Stocks & Weights/.test(text),rows:document.querySelectorAll('[class*="StocksWeights__constituent"]').length,signedOut:Boolean(login),
  notSubscribed:!login&&/Invitation Required|Request Invite/i.test(text),
  // Groww's one-time "Authorize SmallCase to access Groww API" screen grants order access: never approved by automation.
  consent:location.hostname==='groww.in'&&/Authorize\s+SmallCase/i.test(text),
  growwSignedOut:location.hostname==='groww.in'&&!/Authorize/i.test(text)&&/\bLog ?in\b/i.test(text)};
}
export function clickSmallcaseLogin(){
 const b=[...document.querySelectorAll('button[class*="LoginButton"]')].find(el=>el.getClientRects().length)||[...document.querySelectorAll('button')].find(el=>el.getClientRects().length&&el.textContent.trim()==='Login');
 if(!b)return false;b.click();return true;
}
export function scrollToBottom(){window.scrollTo(0,document.body.scrollHeight);}
// Port of the Market app's scripts/smallcase_extract.js (same rules, same failure mode:
// returns nothing rather than guessing if smallcase renames its row class).
export function extractSmallcase(){
 const txt=document.body.innerText.replace(/\s+\n/g,'\n');
 const pick=re=>{const m=txt.match(re);return m?m[1].trim():null;};
 const num=v=>{const f=parseFloat(String(v).replace(/,/g,''));return f===f?f:null;};
 const stocks=[];
 for(const el of document.querySelectorAll('[class*="StocksWeights__constituent"]')){
  const m=el.textContent.trim().match(/^(.+?)([\d]+(?:\.\d+)?)$/);if(!m)continue;
  let segment=null;const group=el.parentElement;if(group){const head=group.textContent.trim().match(/^([A-Za-z &]+?)[\d]+(?:\.\d+)?/);if(head)segment=head[1].trim();}
  stocks.push({name:m[1].trim(),weight:num(m[2]),segment});
 }
 return {id:(location.pathname.match(/smallcase\/([A-Z0-9_]+)/i)||[])[1]||null,name:pick(/\n([^\n]+?)\nSubscribed\n/)||pick(/^([^\n]+?)\nManaged by/m),publisher:pick(/Managed by ([^\n]+)/),
  subscribed:/\bSubscribed\b/.test(txt),last_rebalance:pick(/Last Rebalance\n([^\n]+)/),next_rebalance:pick(/Next Rebalance\n([^\n]+)/),stocks};
}
export function probePnl(){
 const text=document.body?.innerText||'';
 return {ready:/Realised P&L|Select date range/.test(text)&&/Download/.test(text),pin:/Groww PIN|Enter PIN|Forgot Groww PIN/i.test(text),signedOut:/\bLog ?in\b|\bSign ?up\b/i.test(text)&&!/Realised P&L/.test(text)};
}

const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function openTab(chromeApi,url,windowId){return chromeApi.tabs.create({url,active:false,...(Number.isInteger(windowId)?{windowId}:{})});}
async function run(chromeApi,tabId,func,args=[]){const r=await chromeApi.scripting.executeScript({target:{tabId},func,args});return r[0]?.result;}
async function loaded(chromeApi,tabId,host){const t=await chromeApi.tabs.get(tabId);return t.status==='complete'&&t.url?.startsWith(host)?t:null;}

export async function captureSmallcase(chromeApi,id,{delay=pause,timeoutMs=90000,windowId,now=Date.now}={}){
 const tab=await openTab(chromeApi,SMALLCASE_URL(id),windowId);
 try{
  const deadline=now()+timeoutMs;let tabbed=false,stable=0,previous=-1,loginClicked=false;
  while(now()<deadline){
   await delay(1500);const t=await chromeApi.tabs.get(tab.id);if(t.status!=='complete'||!/^https:\/\/(smallcases\.)?groww\.in\//.test(t.url||''))continue;
   const p=await run(chromeApi,tab.id,probeSmallcase);if(!p)continue;
   // smallcase signs in through Groww (OAuth using this profile's Groww session): click its Login once.
   if(p.consent)return {id,error:'SMALLCASE_CONSENT_REQUIRED'};if(p.growwSignedOut)return {id,error:'AUTH_REQUIRED'};
   if(p.host!=='smallcases.groww.in')continue;
   if(p.signedOut){if(loginClicked)return {id,error:'SMALLCASE_AUTH_REQUIRED'};loginClicked=true;await run(chromeApi,tab.id,clickSmallcaseLogin);await delay(4000);continue;}
   if(p.notSubscribed)return {id,error:'SMALLCASE_NOT_SUBSCRIBED'};
   // After sign-in smallcase may land on another page; return to the constituents page.
   if(loginClicked&&!t.url.includes('/smallcase/')){await chromeApi.tabs.update(tab.id,{url:SMALLCASE_URL(id)});continue;}
   if(!p.ready)continue;
   if(!tabbed){await run(chromeApi,tab.id,clickText,['Stocks & Weights']);tabbed=true;await delay(3000);await run(chromeApi,tab.id,clickText,['Understood']);continue;}
   await run(chromeApi,tab.id,scrollToBottom);
   if(p.rows&&p.rows===previous){if(++stable>=2){
    const page=await run(chromeApi,tab.id,extractSmallcase),total=(page?.stocks||[]).reduce((t,s)=>t+(s.weight||0),0);
    // Weights that do not add up mean a partial read; a partial read would understate every target.
    if(!page?.stocks?.length||Math.abs(total-100)>1.5)return {id,error:'SMALLCASE_PARTIAL'};
    return {id,page:{...page,id}};
   }}else stable=0;previous=p.rows;
  }
  return {id,error:'SMALLCASE_TIMEOUT'};
 }finally{await chromeApi.tabs.remove(tab.id).catch(()=>{});}
}

export async function capturePnl(chromeApi,{delay=pause,timeoutMs=150000,windowId,now=Date.now}={}){
 const tab=await openTab(chromeApi,PNL_URL,windowId);let listener;
 try{
  const deadline=now()+timeoutMs;let clickedAt=0,downloadId=null;
  // The file name is often unknown when a download is created; claim the first download that
  // starts after our click and check its final name once it completes.
  listener=item=>{if(clickedAt&&downloadId===null)downloadId=item.id;};chromeApi.downloads.onCreated.addListener(listener);
  while(now()<deadline){
   await delay(1500);
   if(downloadId!==null){
    const [item]=await chromeApi.downloads.search({id:downloadId});
    if(item?.state==='complete')return /PnL.*\.xlsx$/i.test(item.filename||'')?{path:item.filename,downloadId}:{error:'PNL_UNEXPECTED_FILE'};
    if(item?.state==='interrupted')return {error:'PNL_DOWNLOAD_FAILED'};continue;
   }
   if(clickedAt){if(now()-clickedAt>30000)return {error:'PNL_DOWNLOAD_NOT_STARTED'};continue;}
   if(!await loaded(chromeApi,tab.id,'https://groww.in/'))continue;
   const p=await run(chromeApi,tab.id,probePnl);
   if(p.pin||p.signedOut)return {error:'AUTH_REQUIRED'};
   if(p.ready){await delay(2000);if(await run(chromeApi,tab.id,clickText,['Download']))clickedAt=now();}
  }
  return {error:'PNL_TIMEOUT'};
 }finally{if(listener)chromeApi.downloads.onCreated.removeListener(listener);await chromeApi.tabs.remove(tab.id).catch(()=>{});}
}
// After the collector has read the workbook: delete it from disk and from Chrome's download list.
export async function discardDownload(chromeApi,downloadId){
 if(!Number.isInteger(downloadId))return;try{await chromeApi.downloads.removeFile(downloadId);}catch{}try{await chromeApi.downloads.erase({id:downloadId});}catch{}
}
