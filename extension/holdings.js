export const HOLDINGS_URL='https://groww.in/stocks/user/holdings';
export function probePage(){
 const text=document.body?.innerText||'',rows=[...document.querySelectorAll('tr[class*="holdingRow_tablerow"]')];
 return {rows:rows.filter(r=>!/Loading/i.test(r.textContent)).length,pending:rows.filter(r=>/Loading/i.test(r.textContent)).length,pin:/Groww PIN|Enter PIN|Forgot Groww PIN/i.test(text),rejected:/incorrect pin|invalid pin|wrong pin/i.test(text),challenge:/captcha|verify.*otp|enter.*otp|verification code|security check/i.test(text),signedOut:/\bLog ?in\b|\bSign ?up\b/i.test(text),empty:/no holdings|don.t have any holding|do not have any holding|start investing/i.test(text),busy:document.querySelectorAll('[class*="loader"],[class*="shimmer"],[class*="skeleton"]').length};
}
export function extractHoldings(){
 const rx=/^(.+?)([\d,]+)\s*shares\s*Avg\.\s*₹\s*([\d,]+\.\d+)\s*₹\s*([\d,]+\.\d{2})\s*([-+]?[\d,.]+)\s*\(([-+]?[\d.]+)%\)\s*([-+]?)₹\s*([\d,]+\.\d{2})\s*([-+]?[\d.]+)%\s*₹\s*([\d,]+\.\d{2})\s*₹\s*([\d,]+\.\d{2})/;
 const nodes=[...document.querySelectorAll('tr[class*="holdingRow_tablerow"]')],number=s=>Number(s.replace(/,/g,'')),rows=[];
 // Failures say which check failed (counts and row position only; never holding data).
 for(const [index,node] of nodes.entries()){const m=node.textContent.replace(/\s+/g,' ').trim().match(rx),a=node.querySelector('a[href*="/stocks/"]');if(!m||!a)return {error:'PARTIAL_HOLDINGS',detail:{reason:!m?'row-format':'row-link',row:index+1,rows:nodes.length}};
  const slug=a.getAttribute('href').split('/stocks/')[1].split(/[?#]/)[0];
  rows.push({groww_slug:slug,name:m[1].trim(),qty:number(m[2]),avg_price:number(m[3]),reference_price:number(m[4]),reference_value:number(m[10]),invested:number(m[11])});
 }
 const expected=(document.body.innerText.match(/HOLDINGS\s*\((\d+)\)/i)||[])[1];
 if(!rows.length||expected!==undefined&&Number(expected)!==rows.length)return {error:'PARTIAL_HOLDINGS',detail:{reason:rows.length?'count-mismatch':'no-rows',rows:rows.length,expected:expected===undefined?null:Number(expected)}};
 return {rows};
}
export function scrollHoldings(){window.scrollTo(0,document.body.scrollHeight);for(const el of document.querySelectorAll('main,[class*="holdings"]'))if(el.scrollHeight>el.clientHeight)el.scrollTop=el.scrollHeight;}
export function fillPinInPage(pin){
 if(location.protocol!=='https:'||location.hostname!=='groww.in'||!/^\d{4}$/.test(pin)||!/Groww PIN|Enter PIN|Forgot Groww PIN/i.test(document.body.innerText))return {error:'PIN_INPUT_CHANGED'};
 const visible=selector=>[...document.querySelectorAll(selector)].filter(el=>el.getClientRects().length&&!el.disabled);
 const whole=visible('input[type="password"][maxlength="4"],input[inputmode="numeric"][maxlength="4"],input[aria-label*="PIN" i]'),split=visible('input[type="password"][maxlength="1"],input[inputmode="numeric"][maxlength="1"]');
 const set=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
 if(whole.length===1)set(whole[0],pin);else if(split.length===4)split.forEach((el,i)=>set(el,pin[i]));else return {error:'PIN_INPUT_CHANGED'};
 const buttons=visible('button').filter(el=>/^(?:unlock|verify|continue|submit)(?: pin)?$/i.test(el.textContent.trim()));if(buttons.length===1)buttons[0].click();return {filled:true};
}
// Holdings from the page's own response (kept by holdings-hook.js), priced from the rows that rendered.
// Rows Groww has not rendered yet get Groww's public last price (no sign-in, same origin).
// Runs in the page's MAIN world.
export async function holdingsFromResponse(){
 const kept=window.__mvHoldings;if(!kept||!Array.isArray(kept.holdings))return null;
 const num=s=>Number(String(s).replace(/,/g,''));
 const rx=/^(.+?)([\d,]+)\s*shares\s*Avg\.\s*₹\s*([\d,]+\.\d+)\s*₹\s*([\d,]+\.\d{2})\s*([-+]?[\d,.]+)\s*\(([-+]?[\d.]+)%\)\s*([-+]?)₹\s*([\d,]+\.\d{2})\s*([-+]?[\d.]+)%\s*₹\s*([\d,]+\.\d{2})\s*₹\s*([\d,]+\.\d{2})/;
 const shown=new Map();
 for(const node of document.querySelectorAll('tr[class*="holdingRow_tablerow"]')){const a=node.querySelector('a[href*="/stocks/"]'),m=node.textContent.replace(/\s+/g,' ').trim().match(rx);if(a&&m)shown.set(a.getAttribute('href').split('/stocks/')[1].split(/[?#]/)[0],{price:num(m[4]),value:num(m[10])});}
 const rows=[];let fetched=0;
 for(const h of kept.holdings){
  if(typeof h.slug!=='string'||!h.slug||typeof h.name!=='string'||!Number.isFinite(h.qty)||h.qty<=0||!Number.isFinite(h.avgPaise))return {error:'PARTIAL_HOLDINGS',detail:{reason:'row-format',row:rows.length+1,rows:kept.holdings.length}};
  const avg=h.avgPaise/100,invested=Math.round(h.qty*avg*100)/100;let price=shown.get(h.slug)?.price??null;
  if(price===null&&(h.nse||h.bse)){try{const ex=h.nse?'NSE':'BSE',r=await fetch('/v1/api/stocks_data/v1/accord_points/exchange/'+ex+'/segment/CASH/latest_prices_ohlc/'+encodeURIComponent(h.nse||h.bse),{credentials:'omit'});const ltp=r.ok?Number((await r.json())?.ltp):NaN;if(Number.isFinite(ltp)&&ltp>0){price=ltp;fetched++;}}catch{}}
  rows.push({groww_slug:h.slug,name:h.name,qty:h.qty,avg_price:avg,reference_price:price,reference_value:price===null?null:Math.round(price*h.qty*100)/100,invested});
 }
 const expected=(document.body.innerText.match(/HOLDINGS\s*\((\d+)\)/i)||[])[1];
 if(expected!==undefined&&Number(expected)!==rows.length)return {error:'PARTIAL_HOLDINGS',detail:{reason:'count-mismatch',rows:rows.length,expected:Number(expected)}};
 return {rows,source:'response',rendered:shown.size,priced:fetched};
}
