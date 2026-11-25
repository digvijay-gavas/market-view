// Cloudflare Worker: read-only price relay for the GitHub Pages viewer.
// Groww's public price URLs send no CORS header, so browsers cannot call them directly.
// This relay only accepts stock slugs, caches hard, and stops at the first rate-limit signal.
const SLUG=/^[a-z0-9][a-z0-9_-]{0,119}$/;
// Cloudflare's free plan allows 50 subrequests per invocation. A slug costs up to 6
// (cache read, Groww fetch, cache write; for instrument and price), so one call handles at
// most BATCH slugs and returns the rest as `deferred` for the caller to send again.
const MAX_SLUGS=150, CONCURRENCY=4, BATCH=8;
const PRICE_TTL=10, INSTRUMENT_TTL=7*24*3600;
const DEFAULT_ORIGINS='https://digvijay-gavas.github.io,http://127.0.0.1:5174,http://localhost:5174';
const GROWW='https://groww.in/v1/api/stocks_data/v1/';

function cors(origin,allowed){
 const headers={'Vary':'Origin','X-Content-Type-Options':'nosniff'};
 if(allowed.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Max-Age':'86400'});
 return headers;
}
function json(body,status,headers){return new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json','Cache-Control':'no-store'}});}

class Throttled extends Error{constructor(retryAfter,status){super("UPSTREAM_THROTTLED");this.retryAfter=retryAfter;this.status=status;}}

// Edge cache first; only a miss reaches Groww. Shared across every viewer.
async function cachedJSON(url,ttl,{cache,fetcher}){
 const key=new Request(url);
 const hit=cache&&await cache.match(key);if(hit)return hit.json();
 const response=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'MarketViewPriceRelay/1.0'}});
 if(response.status===429||response.status===403){const retry=Number(response.headers.get('retry-after'));throw new Throttled(Number.isFinite(retry)&&retry>0?Math.min(retry,3600):600,response.status);}
 if(!response.ok)throw new Error('UPSTREAM_'+response.status);
 const body=await response.json();
 if(cache)await cache.put(key,new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+ttl}}));
 return body;
}

async function quote(slug,deps,now){
 const doc=await cachedJSON(GROWW+'company/search_id/'+encodeURIComponent(slug),INSTRUMENT_TTL,deps),head=doc?.header||{};
 const symbol=head.nseScriptCode||head.bseScriptCode,exchange=head.nseScriptCode?'NSE':'BSE';
 if(!symbol)return null;
 const data=await cachedJSON(GROWW+'accord_points/exchange/'+exchange+'/segment/CASH/latest_prices_ohlc/'+encodeURIComponent(symbol),PRICE_TTL,deps);
 const ltp=Number(data?.ltp);if(!Number.isFinite(ltp)||ltp<=0)return null;
 return {groww_slug:slug,symbol:String(symbol),exchange,ltp,day_change_perc:Number.isFinite(Number(data.dayChangePerc))?Number(data.dayChangePerc):null,fetched_at:now.toISOString()};
}

export async function handle(request,env={},deps={}){
 const allowed=String(env.ALLOWED_ORIGINS||DEFAULT_ORIGINS).split(',').map(s=>s.trim()).filter(Boolean);
 const origin=request.headers.get('Origin')||'',headers=cors(origin,allowed);
 if(request.method==='OPTIONS')return new Response(null,{status:allowed.includes(origin)?204:403,headers});
 if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405,headers);
 if(!allowed.includes(origin))return json({error:'ORIGIN_NOT_ALLOWED'},403,headers);
 const url=new URL(request.url);
 if(url.pathname!=='/quotes')return json({error:'NOT_FOUND'},404,headers);
 const slugs=[...new Set(String(url.searchParams.get('slugs')||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean))];
 if(!slugs.length||slugs.length>MAX_SLUGS||!slugs.every(s=>SLUG.test(s)))return json({error:'INVALID_SLUGS'},400,headers);
 const d={cache:deps.cache===undefined?globalThis.caches?.default:deps.cache,fetcher:deps.fetcher||fetch},now=deps.now?.()||new Date();
 const deferred=slugs.splice(BATCH);
 const quotes=[],failures=[];let retryAfter=0,upstream=null,next=0;
 // A few at a time; once Groww says slow down, every remaining slug is skipped.
 await Promise.all(Array.from({length:Math.min(CONCURRENCY,slugs.length)},async()=>{
  while(next<slugs.length){
   const slug=slugs[next++];
   if(retryAfter){failures.push(slug);continue;}
   try{const q=await quote(slug,d,now);q?quotes.push(q):failures.push(slug);}
   catch(error){failures.push(slug);if(error instanceof Throttled){retryAfter=error.retryAfter;upstream=error.status;}}
  }
 }));
 return json({quotes,failures,deferred,retryAfter:retryAfter||null,...(upstream?{upstream}:{})},200,headers);
}

export default {fetch:(request,env)=>handle(request,env)};
