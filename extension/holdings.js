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
export function scrollHoldings(){window.scrollTo(0,document.body.scrollHeight);for(const el of document.querySelectorAll('main,[class*="holdings"]'))if(el.scrollHeight>el.clientHeight)el.scrollTop=el.scrollHeight;}
export function fillPinInPage(pin){
 if(location.protocol!=='https:'||location.hostname!=='groww.in'||!/^\d{4}$/.test(pin)||!/Groww PIN|Enter PIN|Forgot Groww PIN/i.test(document.body.innerText))return {error:'PIN_INPUT_CHANGED'};
 const visible=selector=>[...document.querySelectorAll(selector)].filter(el=>el.getClientRects().length&&!el.disabled);
 const whole=visible('input[type="password"][maxlength="4"],input[inputmode="numeric"][maxlength="4"],input[aria-label*="PIN" i]'),split=visible('input[type="password"][maxlength="1"],input[inputmode="numeric"][maxlength="1"]');
 const set=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
 if(whole.length===1)set(whole[0],pin);else if(split.length===4)split.forEach((el,i)=>set(el,pin[i]));else return {error:'PIN_INPUT_CHANGED'};
 const buttons=visible('button').filter(el=>/^(?:unlock|verify|continue|submit)(?: pin)?$/i.test(el.textContent.trim()));if(buttons.length===1)buttons[0].click();return {filled:true};
}
