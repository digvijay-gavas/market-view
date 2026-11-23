import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
export const HOLDINGS_URL='https://groww.in/stocks/user/holdings';
export function probePage(){
 const text=document.body?.innerText||'',rows=[...document.querySelectorAll('tr[class*="holdingRow_tablerow"]')];
 return {rows:rows.filter(r=>!/Loading/i.test(r.textContent)).length,pending:rows.filter(r=>/Loading/i.test(r.textContent)).length,pin:/Groww PIN|Enter PIN|Forgot Groww PIN/i.test(text),rejected:/incorrect pin|invalid pin|wrong pin/i.test(text),challenge:/captcha|verify.*otp|enter.*otp|verification code|security check/i.test(text),signedOut:/\bLog ?in\b|\bSign ?up\b/i.test(text),empty:/no holdings|don.t have any holding|do not have any holding|start investing/i.test(text),busy:document.querySelectorAll('[class*="loader"],[class*="shimmer"],[class*="skeleton"]').length};
}
export function extractHoldings(){
 const rx=/^(.+?)([\d,]+)\s*shares\s*Avg\.\s*₹\s*([\d,]+\.\d+)\s*₹\s*([\d,]+\.\d{2})\s*([-+]?[\d,.]+)\s*\(([-+]?[\d.]+)%\)\s*([-+]?)₹\s*([\d,]+\.\d{2})\s*([-+]?[\d.]+)%\s*₹\s*([\d,]+\.\d{2})\s*₹\s*([\d,]+\.\d{2})/;
 const nodes=[...document.querySelectorAll('tr[class*="holdingRow_tablerow"]')],number=s=>Number(s.replace(/,/g,'')),rows=[];
 for(const node of nodes){const m=node.textContent.replace(/\s+/g,' ').trim().match(rx),a=node.querySelector('a[href*="/stocks/"]');if(!m||!a)return {error:'PARTIAL_HOLDINGS'};
  const slug=a.getAttribute('href').split('/stocks/')[1].split(/[?#]/)[0];
  rows.push({groww_slug:slug,name:m[1].trim(),qty:number(m[2]),avg_price:number(m[3]),reference_price:number(m[4]),reference_value:number(m[10]),invested:number(m[11])});
 }
 const expected=(document.body.innerText.match(/HOLDINGS\s*\((\d+)\)/i)||[])[1];
 if(!rows.length||expected!==undefined&&Number(expected)!==rows.length)return {error:'PARTIAL_HOLDINGS'};
 return {rows};
}
export function collectorError(code){const error=new Error(code);error.code=code;return error;}
export function filterState(state){return {cookies:(state.cookies||[]).filter(c=>/(^|\.)groww\.in$/i.test(c.domain.replace(/^\./,''))),origins:(state.origins||[]).filter(o=>{try{const u=new URL(o.origin);return u.protocol==='https:'&&/(^|\.)groww\.in$/i.test(u.hostname);}catch{return false;}})};}
export async function openProfile(home,id,options={}){
 if(!/^[a-z0-9_-]+$/.test(id))throw collectorError('INVALID_ACCOUNT');
 // A dedicated user-data directory; never read or clone the ordinary Chrome profile.
 const path=join(home,'profiles',id);await mkdir(path,{recursive:true,mode:0o700});
 delete process.env.PWDEBUG;delete process.env.DEBUG;
 const {chromium}=await import('playwright');
 const context=await chromium.launchPersistentContext(path,{channel:options.channel||'chrome',headless:options.headless!==false,viewport:{width:1440,height:1000},timeout:30000,args:['--disable-background-networking']});
 context.setDefaultTimeout(10000);
 // Collection has no order-placement path. Also reject accidental mutation requests.
 await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(/(^|\.)groww\.in$/.test(url.hostname)&&req.method()!=='GET'&&/\/(?:order|orders|withdraw|withdrawal|transfer-funds)(?:\/|$)/i.test(url.pathname))return route.abort();return route.continue();});
 if(options.restore){for(const page of context.pages())await page.goto('about:blank');await context.setStorageState(filterState(options.restore));}
 return context;
}
export async function unlockPin(page,pin){
 const url=new URL(page.url());if(url.protocol!=='https:'||!/(^|\.)groww\.in$/.test(url.hostname)||!/^\d{4}$/.test(pin))throw collectorError('PIN_INPUT_CHANGED');
 const whole=page.locator('input[type="password"][maxlength="4"],input[inputmode="numeric"][maxlength="4"],input[aria-label*="PIN" i]');
 const split=page.locator('input[type="password"][maxlength="1"],input[inputmode="numeric"][maxlength="1"]');
 if(await whole.count()===1)await whole.fill(pin);else if(await split.count()===4){for(let i=0;i<4;i++)await split.nth(i).fill(pin[i]);}else throw collectorError('PIN_INPUT_CHANGED');
 const submit=page.getByRole('button',{name:/^(?:unlock|verify|continue|submit)(?: pin)?$/i});
 if(await submit.count()===1&&await submit.isEnabled())await submit.click();
}
export async function waitReady(page,{pin,timeoutMs=60000,interactive=false,onPinAttempt=async()=>{},delay=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 let attempted=false,quiet=0;const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){
  const p=await page.evaluate(probePage);
  if(p.rejected)throw collectorError('PIN_REJECTED');
  if(p.challenge&&!interactive)throw collectorError('AUTH_REQUIRED');
  if(p.pin){if(!attempted&&pin){attempted=true;await onPinAttempt();await unlockPin(page,pin);await delay(1500);continue;}if(!interactive&&attempted)throw collectorError('PIN_REJECTED');if(!interactive&&!pin)throw collectorError('PIN_REQUIRED');}
  else if(p.signedOut&&!interactive)throw collectorError('AUTH_REQUIRED');
  else if(p.rows&&!p.pending)return 'rows';
  else if(p.empty&&!p.busy&&!p.pending&&!p.pin&&!p.signedOut&&!p.challenge){if(++quiet>=3)return 'empty';}
  else quiet=0;
  await delay(1500);
 }
 throw collectorError('HOLDINGS_TIMEOUT');
}
export async function capturePositions(home,account,secret,options={}){
 if(!secret?.bound)throw collectorError('PROFILE_SETUP_REQUIRED');
 const context=await openProfile(home,account.id,{...options,restore:secret.restore?secret.storageState:null});
 try{
  const page=context.pages()[0]||await context.newPage();await page.goto(HOLDINGS_URL,{waitUntil:'domcontentloaded',timeout:30000});
  const ready=await waitReady(page,{pin:secret.pin,timeoutMs:options.timeoutMs||60000,onPinAttempt:options.onPinAttempt});
  let rows=[];
  if(ready!=='empty'){
   let previous=-1,stable=0;
   for(let n=0;n<30;n++){
    await page.evaluate(()=>{window.scrollTo(0,document.body.scrollHeight);for(const el of document.querySelectorAll('main,[class*="holdings"]'))if(el.scrollHeight>el.clientHeight)el.scrollTop=el.scrollHeight;});
    await page.waitForTimeout(800);const p=await page.evaluate(probePage);
    if(p.pin||p.challenge||p.signedOut)throw collectorError('AUTH_REQUIRED');
    if(p.rows===previous&&!p.pending){if(++stable>=3)break;}else stable=0;previous=p.rows;
    if(n===29)throw collectorError('PARTIAL_HOLDINGS');
   }
   const parsed=await page.evaluate(extractHoldings);if(parsed.error)throw collectorError(parsed.error);rows=parsed.rows;
  }
  const storageState=filterState(await context.storageState({indexedDB:true}));
  return {rows,storageState};
 }finally{await context.close();}
}
