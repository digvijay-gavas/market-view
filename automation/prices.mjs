const finite=x=>typeof x==='number'&&Number.isFinite(x);
export async function jsonGet(url,{fetcher=fetch,token}={}){
 const response=await fetcher(url,{headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token,'X-API-VERSION':'1.0'}:{'User-Agent':'MarketViewCollector/1.0'})},signal:AbortSignal.timeout(15000),credentials:'omit'});
 if(!response.ok){const error=new Error('PRICE_HTTP_'+response.status);error.code=error.message;const retry=Number(response.headers.get('retry-after'));error.retryAfterMs=Number.isFinite(retry)?Math.min(3600000,Math.max(60000,retry*1000)):600000;throw error;}
 return response.json();
}
export function universe(positions){return [...new Map(positions.flatMap(s=>s.tables.positions||[]).filter(r=>r.qty>0).map(r=>[r.groww_slug,r])).values()];}
export async function fetchQuotes(rows,{provider='groww-public',instruments={},token,previous=[],now=new Date(),fetcher=fetch,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const out=new Map(previous.map(q=>[q.groww_slug,q])),failures=[],fresh=[];let stopped=false,retryAfterMs=0;
 const wanted=[...new Map(rows.map(r=>[r.groww_slug,r])).values()];
 if(provider==='groww-api'&&!token)throw Object.assign(new Error('GROWW_API_TOKEN_REQUIRED'),{code:'GROWW_API_TOKEN_REQUIRED'});
 for(const row of wanted){
  if(instruments[row.groww_slug])continue;
  if(!/^[a-zA-Z0-9_-]+$/.test(row.groww_slug)){failures.push(row.groww_slug);continue;}
  try{
   const doc=await jsonGet('https://groww.in/v1/api/stocks_data/v1/company/search_id/'+encodeURIComponent(row.groww_slug),{fetcher});const head=doc.header||{};
   if(head.nseScriptCode||head.bseScriptCode)instruments[row.groww_slug]={symbol:String(head.nseScriptCode||head.bseScriptCode),exchange:head.nseScriptCode?'NSE':'BSE',isin:head.isin||null};
  }catch(error){if([403,429].some(code=>error.code==='PRICE_HTTP_'+code)){stopped=true;retryAfterMs=error.retryAfterMs;break;}}
  await delay(300);
 }
 if(provider==='groww-api'&&!stopped){
  const known=wanted.filter(r=>instruments[r.groww_slug]);
  for(let i=0;i<known.length;i+=50){
   const batch=known.slice(i,i+50),url=new URL('https://api.groww.in/v1/live-data/ltp');url.search=new URLSearchParams({segment:'CASH',exchange_symbols:batch.map(r=>{const m=instruments[r.groww_slug];return m.exchange+'_'+m.symbol;}).join(',')});
   try{const data=await jsonGet(url,{fetcher,token});if(data.status!=='SUCCESS')throw new Error('PRICE_RESPONSE_INVALID');for(const row of batch){const m=instruments[row.groww_slug],ltp=data.payload?.[m.exchange+'_'+m.symbol];if(finite(ltp)&&ltp>0){const q={groww_slug:row.groww_slug,...m,ltp,fetched_at:now.toISOString(),quoted_at:null,source:'groww-api'};fresh.push(q);out.set(q.groww_slug,q);}else failures.push(row.groww_slug);}}
   catch(error){retryAfterMs=error.retryAfterMs||retryAfterMs;failures.push(...batch.map(r=>r.groww_slug));break;}await delay(500);
  }
 }else if(!stopped){
  for(const row of wanted){const m=instruments[row.groww_slug];if(!m){failures.push(row.groww_slug);continue;}
   try{const url='https://groww.in/v1/api/stocks_data/v1/accord_points/exchange/'+m.exchange+'/segment/CASH/latest_prices_ohlc/'+encodeURIComponent(m.symbol);const data=await jsonGet(url,{fetcher});const ltp=Number(data.ltp);if(!Number.isFinite(ltp)||ltp<=0)throw new Error('PRICE_RESPONSE_INVALID');const q={groww_slug:row.groww_slug,...m,ltp,fetched_at:now.toISOString(),quoted_at:null,source:'groww-public'};fresh.push(q);out.set(q.groww_slug,q);}
   catch(error){failures.push(row.groww_slug);if([401,403,429].some(code=>error.code==='PRICE_HTTP_'+code)){retryAfterMs=error.retryAfterMs;stopped=true;break;}}await delay(300);
  }
 }
 const slugs=new Set(wanted.map(r=>r.groww_slug)),succeeded=new Set(fresh.map(q=>q.groww_slug));return {quotes:[...out.values()].filter(q=>slugs.has(q.groww_slug)),fresh:fresh.length,failures:[...slugs].filter(slug=>!succeeded.has(slug)),instruments,stopped,retryAfterMs};
}
