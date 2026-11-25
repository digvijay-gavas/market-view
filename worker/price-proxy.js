// Cloudflare Worker: read-only price relay for the GitHub Pages viewer.
// Neither source sends CORS headers, so browsers cannot call them directly.
// Sources, in order: Yahoo Finance chart (needs the exchange symbol), then Groww's public
// price (Groww challenges Worker traffic since Nov 2026; kept in case that lifts).
// Each answer says which source priced each stock and why the others failed, so the viewer
// can log source reliability. A source that signals rate limiting is skipped for the rest of the call.
const SLUG=/^[a-z0-9][a-z0-9_-]{0,119}$/, SYMBOL=/^[A-Z0-9&_.-]{1,24}$/;
// Cloudflare's free plan allows 50 subrequests per invocation (fetches and cache calls).
// Each stock reserves its worst case before starting; stocks that do not fit are returned as
// `deferred` for the caller to send again.
const MAX_ITEMS=150, CONCURRENCY=4, BATCH=8, BUDGET=48, WORST_CASE=9;
const PRICE_TTL=10, INSTRUMENT_TTL=7*24*3600;
const DEFAULT_ORIGINS='https://digvijay-gavas.github.io,http://127.0.0.1:5174,http://localhost:5174';
const GROWW='https://groww.in/v1/api/stocks_data/v1/';
const YAHOO='https://query1.finance.yahoo.com/v8/finance/chart/';
const UA='MarketViewPriceRelay/1.1';

function cors(origin,allowed){
 const headers={'Vary':'Origin','X-Content-Type-Options':'nosniff'};
 if(allowed.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Max-Age':'86400'});
 return headers;
}
function json(body,status,headers){return new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json','Cache-Control':'no-store'}});}

class Throttled extends Error{constructor(retryAfter,status){super('UPSTREAM_THROTTLED');this.retryAfter=retryAfter;this.status=status;}}
class Upstream extends Error{constructor(code){super(code);this.code=code;}}

// Edge cache first; only a miss reaches the source. Shared across every viewer.
async function cachedJSON(url,ttl,{cache,fetcher,spend}){
 const key=new Request(url);
 if(cache){spend();const hit=await cache.match(key);if(hit)return hit.json();}
 spend();const response=await fetcher(url,{headers:{Accept:'application/json','User-Agent':UA}});
 if(response.status===429||response.status===403){const retry=Number(response.headers.get('retry-after'));throw new Throttled(Number.isFinite(retry)&&retry>0?Math.min(retry,3600):600,response.status);}
 if(!response.ok)throw new Upstream('HTTP_'+response.status);
 let body;try{body=await response.json();}catch{throw new Upstream('BAD_JSON');}
 if(cache){spend();await cache.put(key,new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+ttl}}));}
 return body;
}
const finite=x=>x!==null&&x!==''&&x!==undefined&&Number.isFinite(Number(x));

async function yahoo(item,deps,now){
 if(!item.symbol)throw new Upstream('NO_SYMBOL');
 const ticker=item.symbol+(item.exchange==='BSE'?'.BO':'.NS');
 let doc;try{doc=await cachedJSON(YAHOO+encodeURIComponent(ticker)+'?range=1d&interval=1d',PRICE_TTL,deps);}
 catch(error){if(error.code==='HTTP_404')throw new Upstream('NOT_FOUND');throw error;}
 const meta=doc?.chart?.result?.[0]?.meta;if(!meta)throw new Upstream('NOT_FOUND');
 const ltp=Number(meta.regularMarketPrice),prev=Number(meta.chartPreviousClose??meta.previousClose);
 if(!Number.isFinite(ltp)||ltp<=0)throw new Upstream('NO_PRICE');
 const at=Number(meta.regularMarketTime);
 return {groww_slug:item.slug,symbol:item.symbol,exchange:item.exchange,ltp,day_change_perc:Number.isFinite(prev)&&prev>0?Math.round((ltp/prev-1)*1e4)/100:null,
  fetched_at:now.toISOString(),quoted_at:Number.isFinite(at)&&at>0?new Date(at*1000).toISOString():null,source:'yahoo'};
}
async function groww(item,deps,now){
 let {symbol,exchange}=item;
 if(!symbol){
  const head=(await cachedJSON(GROWW+'company/search_id/'+encodeURIComponent(item.slug),INSTRUMENT_TTL,deps))?.header||{};
  symbol=head.nseScriptCode||head.bseScriptCode;exchange=head.nseScriptCode?'NSE':'BSE';
  if(!symbol)throw new Upstream('NO_SYMBOL');
 }
 const data=await cachedJSON(GROWW+'accord_points/exchange/'+exchange+'/segment/CASH/latest_prices_ohlc/'+encodeURIComponent(symbol),PRICE_TTL,deps);
 const ltp=Number(data?.ltp);if(!Number.isFinite(ltp)||ltp<=0)throw new Upstream('NO_PRICE');
 const at=Number(data?.tsInMillis);
 return {groww_slug:item.slug,symbol:String(symbol),exchange,ltp,day_change_perc:finite(data.dayChangePerc)?Number(data.dayChangePerc):null,
  fetched_at:now.toISOString(),quoted_at:Number.isFinite(at)&&at>0?new Date(at).toISOString():null,source:'groww'};
}
const SOURCES=[['yahoo',yahoo],['groww',groww]];

// `items=slug:NSE:SYMBOL,slug2` (symbol optional) or the older `slugs=a,b`.
function parseItems(url){
 const raw=url.searchParams.get('items')??url.searchParams.get('slugs')??'';
 const out=new Map();
 for(const part of String(raw).split(',').map(s=>s.trim()).filter(Boolean)){
  const [slug,exchange,symbol]=part.split(':');const s=String(slug).toLowerCase();
  if(!SLUG.test(s))return null;
  if(exchange!==undefined&&(!['NSE','BSE'].includes(exchange)||!SYMBOL.test(symbol||'')))return null;
  if(!out.has(s))out.set(s,{slug:s,exchange:exchange||null,symbol:symbol||null});
 }
 return [...out.values()];
}

export async function handle(request,env={},deps={}){
 const allowed=String(env.ALLOWED_ORIGINS||DEFAULT_ORIGINS).split(',').map(s=>s.trim()).filter(Boolean);
 const origin=request.headers.get('Origin')||'',headers=cors(origin,allowed);
 if(request.method==='OPTIONS')return new Response(null,{status:allowed.includes(origin)?204:403,headers});
 if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405,headers);
 if(!allowed.includes(origin))return json({error:'ORIGIN_NOT_ALLOWED'},403,headers);
 const url=new URL(request.url);
 if(url.pathname!=='/quotes')return json({error:'NOT_FOUND'},404,headers);
 const items=parseItems(url);
 if(!items?.length||items.length>MAX_ITEMS)return json({error:'INVALID_ITEMS'},400,headers);
 const now=deps.now?.()||new Date();
 let budget=BUDGET;const base={cache:deps.cache===undefined?globalThis.caches?.default:deps.cache,fetcher:deps.fetcher||fetch};
 const work=items.slice(0,BATCH),deferred=items.slice(BATCH).map(i=>i.slug);
 const quotes=[],failures=[],reasons={},throttled={},sources={},attempted=new Set();let next=0;
 for(const [name]of SOURCES)sources[name]={ok:0,failed:0};
 await Promise.all(Array.from({length:Math.min(CONCURRENCY,work.length)},async()=>{
  while(next<work.length){
   const item=work[next++];
   if(budget<WORST_CASE){deferred.push(item.slug);continue;}
   budget-=WORST_CASE;let used=0;const d={...base,spend:()=>{used++;}};
   const tried=[];let quote=null;
   for(const [name,fn]of SOURCES){
    if(throttled[name]){tried.push(name+':SKIPPED');continue;}
    try{quote=await fn(item,d,now);sources[name].ok++;attempted.add(name);break;}
    catch(error){sources[name].failed++;if(error.code!=='NO_SYMBOL')attempted.add(name);
     if(error instanceof Throttled){throttled[name]={status:error.status,retryAfter:error.retryAfter};tried.push(name+':'+error.status);}
     else tried.push(name+':'+(error.code||'ERROR'));}
   }
   budget+=WORST_CASE-used;
   if(quote){quotes.push(quote);if(tried.length)reasons[item.slug]=tried.join(' ');}
   else{failures.push(item.slug);reasons[item.slug]=tried.join(' ');}
  }
 }));
 // Back off only when every source that could be used is rate limiting; one blocked source is
 // just a fallback miss.
 const allThrottled=attempted.size>0&&[...attempted].every(name=>throttled[name]);
 const retryAfter=allThrottled?Math.max(...Object.values(throttled).map(t=>t.retryAfter)):null;
 return json({quotes,failures,deferred,reasons,sources,throttled,retryAfter},200,headers);
}

export default {fetch:(request,env)=>handle(request,env)};
