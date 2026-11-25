// Viewer-side live prices through the price relay Worker. Saved Drive data is never changed:
// quotes only overlay the in-memory snapshot used for calculations.
// Timed refresh is opt-in, pauses while the tab is hidden, stops outside market hours,
// and falls back to on-demand after a fixed number of fetches so Groww is not polled forever.
export const LIVE_MODES=Object.freeze([
 {id:'demand',label:'On demand',short:'Manual'},
 {id:'10s',label:'Every 10 sec',short:'10s',interval:10000,max:30},
 {id:'1m',label:'Every 1 min',short:'1m',interval:60000,max:30},
 {id:'10m',label:'Every 10 min',short:'10m',interval:600000,max:12},
]);
const num=x=>typeof x==='number'&&Number.isFinite(x);
const SLUG=/^[a-z0-9][a-z0-9_-]{0,119}$/,SYMBOL=/^[A-Z0-9&_.-]{1,24}$/;

export function marketHours(now=new Date()){
 const ist=new Date(+now+330*60000),day=ist.getUTCDay(),minute=ist.getUTCHours()*60+ist.getUTCMinutes();
 return day>0&&day<6&&minute>=555&&minute<930;
}
export function holdingSlugs(snapshots=[]){
 return [...new Set(snapshots.flatMap(s=>s.tables?.holdings||[]).filter(r=>num(r.qty)&&r.qty>0).map(r=>String(r.groww_slug||'').toLowerCase()).filter(s=>SLUG.test(s)))].sort();
}
// Slug plus exchange symbol where known (the relay prices symbols through Yahoo; without one it
// can only try Groww). One entry per stock across all accounts.
export function holdingItems(snapshots=[]){
 const out=new Map();
 for(const r of snapshots.flatMap(s=>s.tables?.holdings||[])){
  const slug=String(r.groww_slug||'').toLowerCase();if(!(num(r.qty)&&r.qty>0)||!SLUG.test(slug))continue;
  const symbol=typeof r.symbol==='string'&&SYMBOL.test(r.symbol)&&['NSE','BSE'].includes(r.exchange)?r.symbol:null;
  if(!out.has(slug)||(symbol&&!out.get(slug).symbol))out.set(slug,{slug,exchange:symbol?r.exchange:null,symbol});
 }
 return [...out.values()].sort((a,b)=>a.slug.localeCompare(b.slug));
}
const itemParam=i=>i.symbol?i.slug+':'+i.exchange+':'+i.symbol:i.slug;
// Returns new snapshot objects; the originals (and anything cached from them) stay untouched.
export function applyQuotes(snapshots,quotes){
 if(!quotes?.size)return snapshots;
 return snapshots.map(s=>{
  const rows=s.tables?.holdings;if(!rows)return s;let changed=false;
  const holdings=rows.map(r=>{const q=quotes.get(String(r.groww_slug||'').toLowerCase());if(!q)return r;changed=true;return {...r,ltp:q.ltp,current_value:num(r.qty)?q.ltp*r.qty:r.current_value};});
  return changed?{...s,tables:{...s.tables,holdings}}:s;
 });
}

export class LivePrices{
 constructor({endpoint,slugs,items,onLog=()=>{},onChange=()=>{},fetcher=(...a)=>globalThis.fetch(...a),now=()=>new Date(),setTimer=globalThis.setTimeout.bind(globalThis),clearTimer=globalThis.clearTimeout.bind(globalThis),visible=()=>globalThis.document?.visibilityState!=='hidden',marketOpen=marketHours,chunk=8}){
  Object.assign(this,{endpoint:String(endpoint||'').replace(/\/+$/,''),items:items||(()=>(slugs?.()||[]).map(slug=>({slug,exchange:null,symbol:null}))),onLog,onChange,fetcher,now,setTimer,clearTimer,visible,marketOpen,chunk});
  this.mode='demand';this.quotes=new Map();this.version=0;this.count=0;this.busy=false;this.lastAt=null;this.note='';this.error='';this.timer=null;
 }
 get enabled(){return Boolean(this.endpoint);}
 get modeInfo(){return LIVE_MODES.find(m=>m.id===this.mode);}
 get remaining(){const m=this.modeInfo;return m.max?Math.max(0,m.max-this.count):null;}
 notify(){this.onChange(this);}
 setMode(id){
  const mode=LIVE_MODES.find(m=>m.id===id);if(!mode)return;
  this.clearTimer(this.timer);this.timer=null;this.mode=id;this.count=0;this.note='';
  if(mode.interval){
   if(!this.marketOpen(this.now())){this.toDemand('Market closed');return;}
   this.tick();
  }else this.notify();
 }
 toDemand(note){this.clearTimer(this.timer);this.timer=null;this.mode='demand';this.count=0;this.note=note;this.notify();}
 schedule(){const m=this.modeInfo;if(m.interval)this.timer=this.setTimer(()=>this.tick(),m.interval);}
 async tick(){
  this.timer=null;const m=this.modeInfo;if(!m.interval)return;
  if(!this.marketOpen(this.now())){this.toDemand('Market closed');return;}
  // A hidden tab does not use up the fetch allowance; it just waits for the next slot.
  if(!this.visible()){this.schedule();return;}
  const ok=await this.fetchNow();if(this.mode!==m.id)return;
  this.count++;
  if(this.retryAfter){this.toDemand('Source busy, back to manual');return;}
  if(this.count>=m.max){this.toDemand(`Auto-stopped after ${m.max}`);return;}
  this.notify();this.schedule();
 }
 async fetchNow(){
  if(!this.enabled||this.busy)return false;
  const items=this.items();if(!items.length){this.error='No holdings to price.';this.notify();return false;}
  this.busy=true;this.error='';this.missed=[];this.retryAfter=0;this.notify();
  let fresh=0,failed=0;const started=Date.now(),bySlug=new Map(items.map(i=>[i.slug,i]));
  // One log entry per fetch: which source priced each stock and why others failed (reliability record).
  const log={at:this.now().toISOString(),mode:this.mode,requested:items.length,withSymbol:items.filter(i=>i.symbol).length,calls:0,bySource:{},quotes:[],failed:[],reasons:{},throttled:{},error:null};
  try{
   // Small batches: the relay handles only a few stocks per call and returns the rest as `deferred`.
   const queue=[...items];
   while(queue.length){
    const batch=queue.splice(0,this.chunk),slugs=batch.map(i=>i.slug);
    const response=await this.fetcher(this.endpoint+'/quotes?items='+encodeURIComponent(batch.map(itemParam).join(',')),{credentials:'omit',cache:'no-store'});
    log.calls++;
    if(!response.ok)throw new Error('Price relay returned '+response.status+'.');
    const body=await response.json();
    for(const q of body.quotes||[])if(typeof q?.groww_slug==='string'&&num(q.ltp)&&q.ltp>0){
     this.quotes.set(q.groww_slug,q);fresh++;const source=typeof q.source==='string'?q.source:'unknown';
     log.bySource[source]=(log.bySource[source]||0)+1;log.quotes.push([q.groww_slug,source,q.ltp,q.quoted_at||null]);
    }
    for(const slug of body.failures||[]){failed++;log.failed.push(slug);}
    if(body.reasons&&typeof body.reasons==='object')Object.assign(log.reasons,body.reasons);
    if(body.throttled&&typeof body.throttled==='object')Object.assign(log.throttled,body.throttled);
    if(body.retryAfter){this.retryAfter=body.retryAfter;const rest=[...queue.map(i=>i.slug),...(body.deferred||[])];failed+=rest.length;log.failed.push(...rest);break;}
    const deferred=(body.deferred||[]).filter(s=>slugs.includes(s));
    if(deferred.length===batch.length){const rest=[...deferred,...queue.map(i=>i.slug)];failed+=rest.length;log.failed.push(...rest);break;}  // no progress: stop, don't loop
    queue.unshift(...deferred.map(s=>bySlug.get(s)));
   }
   if(fresh){this.version++;this.lastAt=this.now().toISOString();}
   // Stocks no live source priced keep the saved price from the PC collector (if any); the page
   // decides how to word that. Only a fetch that priced nothing at all counts as an error.
   this.missed=[...new Set(log.failed)];
   if(failed&&!fresh)this.error='No live prices this time';
   return fresh>0;
  }catch(error){this.error='Price fetch failed';log.error=String(error?.message||error).slice(0,200);return false;}
  finally{this.busy=false;log.ms=Date.now()-started;this.lastLog=log;try{this.onLog(log);}catch{}this.notify();}
 }
 stop(){this.clearTimer(this.timer);this.timer=null;this.mode='demand';this.count=0;}
 clear(){this.stop();this.missed=[];this.quotes=new Map();this.version++;this.lastAt=null;this.note='';this.error='';}
}
