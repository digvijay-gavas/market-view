import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../worker/price-proxy.js';
import {LivePrices,applyQuotes,holdingSlugs,marketHours} from '../src/live-prices.js';

const ORIGIN='https://digvijay-gavas.github.io';
function groww(calls,{status=200}={}){
 return async url=>{calls.push(url);if(status!==200)return new Response('',{status,headers:{'retry-after':'120'}});
  if(url.includes('search_id/'))return Response.json({header:{nseScriptCode:url.split('/').pop().toUpperCase(),isin:'X'}});
  return Response.json({ltp:101.5,dayChangePerc:1.2});};
}
const req=(path,origin=ORIGIN,method='GET')=>new Request('https://relay.example'+path,{method,headers:origin?{Origin:origin}:{}});

test('relay returns quotes with CORS only for allowed origins',async()=>{
 const calls=[],res=await handle(req('/quotes?slugs=abc-ltd,xyz'),{},{cache:null,fetcher:groww(calls),now:()=>new Date('2026-11-24T05:00:00Z')});
 assert.equal(res.status,200);assert.equal(res.headers.get('access-control-allow-origin'),ORIGIN);
 const body=await res.json();assert.equal(body.quotes.length,2);assert.equal(body.quotes[0].ltp,101.5);assert.equal(body.quotes[0].exchange,'NSE');
 const denied=await handle(req('/quotes?slugs=abc','https://evil.example'),{},{cache:null,fetcher:groww([])});
 assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
});
test('relay rejects bad input and stops on rate limiting',async()=>{
 for(const path of ['/quotes','/quotes?slugs=../etc','/quotes?slugs='+Array.from({length:151},(_,i)=>'s'+i).join(','),'/other'])
  assert.ok([400,404].includes((await handle(req(path),{},{cache:null,fetcher:groww([])})).status));
 const calls=[],body=await (await handle(req('/quotes?slugs=a,b,c,d,e,f,g,h'),{},{cache:null,fetcher:groww(calls,{status:429})})).json();
 assert.equal(body.retryAfter,120);assert.equal(body.quotes.length,0);assert.equal(body.failures.length,8);assert.ok(calls.length<=4,'no new upstream calls after throttling');
});
test('relay serves repeat requests from the edge cache',async()=>{
 const store=new Map(),cache={match:async r=>store.get(r.url)?.clone(),put:async(r,v)=>{store.set(r.url,v);}},calls=[];
 await handle(req('/quotes?slugs=abc'),{},{cache,fetcher:groww(calls)});await handle(req('/quotes?slugs=abc'),{},{cache,fetcher:groww(calls)});
 assert.equal(calls.length,2);
});

const snapshots=[{partition:'a',tables:{holdings:[{groww_slug:'abc',qty:2,ltp:90,current_value:180},{groww_slug:'gone',qty:0,ltp:1,current_value:0}]}}];
test('quotes overlay a copy of the snapshots and never touch the originals',()=>{
 assert.deepEqual(holdingSlugs(snapshots),['abc']);
 const out=applyQuotes(snapshots,new Map([['abc',{ltp:100}]]));
 assert.equal(out[0].tables.holdings[0].current_value,200);assert.equal(snapshots[0].tables.holdings[0].ltp,90);
 assert.equal(applyQuotes(snapshots,new Map()),snapshots);
});
test('market hours are 09:15 to 15:30 IST on weekdays',()=>{
 assert.equal(marketHours(new Date('2026-11-24T03:45:00Z')),true);assert.equal(marketHours(new Date('2026-11-24T10:00:00Z')),false);assert.equal(marketHours(new Date('2026-11-22T05:00:00Z')),false);
});

function controller(overrides={}){
 const timers=[],requests=[];
 const live=new LivePrices({endpoint:'https://relay.example/',slugs:()=>['abc'],marketOpen:()=>true,visible:()=>true,setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimer:()=>{},
  fetcher:async url=>{requests.push(url);return Response.json({quotes:[{groww_slug:'abc',ltp:100+requests.length}],failures:[]});},...overrides});
 return {live,timers,requests,async fire(){const t=timers.shift();await t.fn();}};
}
test('on demand fetches once and never schedules',async()=>{
 const c=controller();await c.live.fetchNow();assert.equal(c.requests.length,1);assert.equal(c.timers.length,0);assert.equal(c.live.quotes.get('abc').ltp,101);
 assert.match(c.requests[0],/^https:\/\/relay\.example\/quotes\?items=abc$/);
});
test('timed refresh stops after its allowance and switches to on demand',async()=>{
 const c=controller();c.live.setMode('10s');await new Promise(r=>setImmediate(r));
 for(let i=0;i<29;i++){assert.equal(c.timers[0].ms,10000);await c.fire();}
 assert.equal(c.requests.length,30);assert.equal(c.live.mode,'demand');assert.equal(c.timers.length,0);assert.match(c.live.note,/Auto-stopped after 30/);
});
test('timed refresh waits while hidden, refuses outside market hours and backs off when throttled',async()=>{
 let visible=false;const hidden=controller({visible:()=>visible});hidden.live.setMode('1m');await new Promise(r=>setImmediate(r));
 assert.equal(hidden.requests.length,0);assert.equal(hidden.live.remaining,30);visible=true;await hidden.fire();assert.equal(hidden.requests.length,1);
 const closed=controller({marketOpen:()=>false});closed.live.setMode('10m');assert.equal(closed.live.mode,'demand');assert.equal(closed.requests.length,0);
 const throttled=controller({fetcher:async()=>Response.json({quotes:[],failures:['abc'],retryAfter:600})});throttled.live.setMode('10s');await new Promise(r=>setImmediate(r));
 assert.equal(throttled.live.mode,'demand');assert.match(throttled.live.note,/Source busy/);
});
test('without a relay URL live prices stay off',async()=>{
 const c=controller({endpoint:''});assert.equal(c.live.enabled,false);assert.equal(await c.live.fetchNow(),false);assert.equal(c.requests.length,0);
});

test('relay handles at most 8 slugs per call and defers the rest',async()=>{
 const calls=[],slugs=Array.from({length:20},(_,i)=>'s'+i),body=await (await handle(req('/quotes?slugs='+slugs.join(',')),{},{cache:null,fetcher:groww(calls)})).json();
 assert.equal(body.quotes.length,8);assert.deepEqual(body.deferred,slugs.slice(8));assert.equal(body.failures.length,0);assert.equal(calls.length,16);
});
test('viewer sends batches of 8 and re-sends deferred slugs',async()=>{
 const slugs=Array.from({length:20},(_,i)=>'s'+i),sent=[];
 const live=new LivePrices({endpoint:'https://relay.example',slugs:()=>slugs,fetcher:async url=>{
  const batch=new URL(url).searchParams.get('items').split(',');sent.push(batch.length);
  // Relay that only manages 5 per call this time.
  return Response.json({quotes:batch.slice(0,5).map(s=>({groww_slug:s,ltp:10})),failures:[],deferred:batch.slice(5)});
 }});
 assert.equal(await live.fetchNow(),true);assert.equal(live.quotes.size,20);assert.equal(live.error,'');assert.ok(sent.every(n=>n<=8));
});

// Yahoo chart stub: `prices` maps ticker -> ltp; anything else is 404.
function yahooAndGroww(calls,{prices={},growwStatus=429}={}){
 return async url=>{calls.push(url);
  if(url.includes('finance.yahoo.com')){const ticker=decodeURIComponent(url.split('/chart/')[1].split('?')[0]);if(!(ticker in prices))return new Response('{}',{status:404});
   return Response.json({chart:{result:[{meta:{regularMarketPrice:prices[ticker],chartPreviousClose:prices[ticker]/1.02,regularMarketTime:1795589392}}]}});}
  if(growwStatus!==200)return new Response('',{status:growwStatus});
  return Response.json({ltp:55,tsInMillis:1795589392000});};
}
test('relay prices symbols through Yahoo and falls back to Groww, reporting why',async()=>{
 const calls=[],res=await handle(req('/quotes?items='+encodeURIComponent('tips:NSE:TIPSMUSIC,mm:NSE:M&M,nse:BSE:544937,nosym')),{},{cache:null,fetcher:yahooAndGroww(calls,{prices:{'TIPSMUSIC.NS':773.45,'M&M.NS':3000}}),now:()=>new Date('2026-11-25T06:50:00Z')});
 const body=await res.json(),by=Object.fromEntries(body.quotes.map(q=>[q.groww_slug,q]));
 assert.equal(by.tips.source,'yahoo');assert.equal(by.tips.ltp,773.45);assert.equal(by.tips.quoted_at,'2026-11-25T06:49:52.000Z');assert.equal(by.tips.day_change_perc,2);
 assert.equal(by.mm.ltp,3000);
 assert.deepEqual(body.failures.sort(),['nosym','nse']);
 assert.equal(body.reasons.nse,'yahoo:NOT_FOUND groww:429');assert.equal(body.throttled.groww.status,429);
 assert.equal(body.retryAfter,null,'one blocked source is not a reason to back off');
 assert.ok(calls.some(u=>u.includes('544937.BO')));
});
test('relay falls back to Groww when Yahoo misses a stock',async()=>{
 const body=await (await handle(req('/quotes?items=x:NSE:XYZ'),{},{cache:null,fetcher:yahooAndGroww([],{growwStatus:200})})).json();
 assert.equal(body.quotes[0].source,'groww');assert.equal(body.quotes[0].ltp,55);assert.equal(body.reasons.x,'yahoo:NOT_FOUND');
});
test('relay rejects malformed symbols',async()=>{
 for(const items of ['a:NYSE:X','a:NSE:','a:NSE:bad sym'])assert.equal((await handle(req('/quotes?items='+encodeURIComponent(items)),{},{cache:null,fetcher:yahooAndGroww([])})).status,400);
});
test('viewer sends symbols and logs which source priced each stock',async()=>{
 const logs=[],sent=[];
 const live=new LivePrices({endpoint:'https://relay.example',items:()=>[{slug:'a',exchange:'NSE',symbol:'M&M'},{slug:'b',exchange:null,symbol:null}],onLog:e=>logs.push(e),fetcher:async url=>{
  sent.push(new URL(url).searchParams.get('items'));
  return Response.json({quotes:[{groww_slug:'a',ltp:10,source:'yahoo',quoted_at:'2026-11-25T06:49:52.000Z'}],failures:['b'],reasons:{b:'yahoo:NO_SYMBOL groww:429'},throttled:{groww:{status:429,retryAfter:600}},retryAfter:null,deferred:[]});
 }});
 assert.equal(await live.fetchNow(),true);assert.deepEqual(sent,['a:NSE:M&M,b']);
 assert.equal(logs.length,1);assert.deepEqual(logs[0].bySource,{yahoo:1});assert.deepEqual(logs[0].failed,['b']);assert.deepEqual(logs[0].quotes,[['a','yahoo',10,'2026-11-25T06:49:52.000Z']]);
 assert.equal(logs[0].withSymbol,1);assert.match(live.error,/1 live price unavailable \(saved prices used\)/);
});
test('holding items carry exchange symbols, preferring a row that has one',async()=>{
 const {holdingItems}=await import('../src/live-prices.js');
 const items=holdingItems([{tables:{holdings:[{groww_slug:'abc',qty:1}]}},{tables:{holdings:[{groww_slug:'abc',qty:2,exchange:'NSE',symbol:'ABC'},{groww_slug:'bad',qty:1,exchange:'NSE',symbol:'x y'}]}}]);
 assert.deepEqual(items,[{slug:'abc',exchange:'NSE',symbol:'ABC'},{slug:'bad',exchange:null,symbol:null}]);
});
