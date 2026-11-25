const finite=x=>typeof x==='number'&&Number.isFinite(x);
export async function jsonGet(url,{fetcher=fetch,token}={}){
 const response=await fetcher(url,{headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token,'X-API-VERSION':'1.0'}:{'User-Agent':'MarketViewCollector/1.0'})},signal:AbortSignal.timeout(15000),credentials:'omit'});
 if(!response.ok){const error=new Error('PRICE_HTTP_'+response.status);error.code=error.message;const retry=Number(response.headers.get('retry-after'));error.retryAfterMs=Number.isFinite(retry)?Math.min(3600000,Math.max(60000,retry*1000)):600000;throw error;}
 return response.json();
}
// Yahoo Finance chart quote for an NSE/BSE symbol (cross-check and fallback for Groww).
export async function yahooQuote(m,{fetcher=fetch}={}){
 const ticker=m.symbol+(m.exchange==='BSE'?'.BO':'.NS');
 const doc=await jsonGet('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(ticker)+'?range=1d&interval=1d',{fetcher});
 const meta=doc?.chart?.result?.[0]?.meta,ltp=Number(meta?.regularMarketPrice),at=Number(meta?.regularMarketTime);
 if(!Number.isFinite(ltp)||ltp<=0)throw Object.assign(new Error('PRICE_RESPONSE_INVALID'),{code:'PRICE_RESPONSE_INVALID'});
 return {ltp,quoted_at:Number.isFinite(at)&&at>0?new Date(at*1000).toISOString():null};
}
export function universe(positions){return [...new Map(positions.flatMap(s=>s.tables.positions||[]).filter(r=>r.qty>0).map(r=>[r.groww_slug,r])).values()];}
export async function fetchQuotes(rows,{provider='groww-public',instruments={},token,previous=[],now=new Date(),fetcher=fetch,delay=ms=>new Promise(r=>setTimeout(r,ms)),crossCheck=true}={}){
 const out=new Map(previous.map(q=>[q.groww_slug,q])),failures=[],fresh=[];let stopped=false,retryAfterMs=0;
 const wanted=[...new Map(rows.map(r=>[r.groww_slug,r])).values()];
 // Symbols saved with the positions capture fill in what Groww's lookup has not.
 for(const row of wanted)if(!instruments[row.groww_slug]&&typeof row.symbol==='string'&&['NSE','BSE'].includes(row.exchange))instruments[row.groww_slug]={symbol:row.symbol,exchange:row.exchange,isin:null};
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
 // Cross-check every Groww price against Yahoo (logged for a later trust decision); Yahoo also
 // fills in any stock Groww could not price this run.
 const check=[];
 if(crossCheck)for(const row of wanted){
  const m=instruments[row.groww_slug];if(!m)continue;const g=fresh.find(q=>q.groww_slug===row.groww_slug);
  try{
   const y=await yahooQuote(m,{fetcher});
   check.push([row.groww_slug,g?.ltp??null,y.ltp,g?Math.round((y.ltp/g.ltp-1)*1e6)/1e4:null,y.quoted_at]);
   if(!g){const q={groww_slug:row.groww_slug,...m,ltp:y.ltp,fetched_at:now.toISOString(),quoted_at:y.quoted_at,source:'yahoo'};fresh.push(q);out.set(q.groww_slug,q);}
  }catch(error){check.push([row.groww_slug,g?.ltp??null,null,null,error.code||'ERROR']);if(['PRICE_HTTP_403','PRICE_HTTP_429'].includes(error.code))break;}
  await delay(200);
 }
 const slugs=new Set(wanted.map(r=>r.groww_slug)),succeeded=new Set(fresh.map(q=>q.groww_slug));return {check,quotes:[...out.values()].filter(q=>slugs.has(q.groww_slug)),fresh:fresh.length,failures:[...slugs].filter(slug=>!succeeded.has(slug)),instruments,stopped,retryAfterMs};
}
