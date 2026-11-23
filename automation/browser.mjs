import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {reusableProfile} from './profiles.mjs';
import {HOLDINGS_URL,probePage,extractHoldings} from '../extension/holdings.js';
export {HOLDINGS_URL,probePage,extractHoldings};
export function collectorError(code){const error=new Error(code);error.code=code;return error;}
export function filterState(state){return {cookies:(state.cookies||[]).filter(c=>/(^|\.)groww\.in$/i.test(c.domain.replace(/^\./,''))),origins:(state.origins||[]).filter(o=>{try{const u=new URL(o.origin);return u.protocol==='https:'&&/(^|\.)groww\.in$/i.test(u.hostname);}catch{return false;}})};}
export async function openProfile(home,id,options={}){
 if(!/^[a-z0-9_-]+$/.test(id))throw collectorError('INVALID_ACCOUNT');
 // Reuse an explicitly selected collector directory, never the normal Chrome root.
 const path=options.profilePath?await reusableProfile(options.profilePath):join(home,'profiles',id);await mkdir(path,{recursive:true,mode:0o700});
 delete process.env.PWDEBUG;delete process.env.DEBUG;
 const {chromium}=await import('playwright');
 let context;
 try{context=await chromium.launchPersistentContext(path,{channel:options.channel||'chrome',headless:options.headless!==false,viewport:{width:1440,height:1000},timeout:30000,args:['--disable-background-networking',...(options.profilePath?['--profile-directory=Default']:[])]});}
 catch(error){if(options.profilePath)throw collectorError('PROFILE_BUSY_OR_UNAVAILABLE');throw error;}
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
 const context=await openProfile(home,account.id,{...options,profilePath:account.profileDirectory,restore:secret.restore?secret.storageState:null});
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
