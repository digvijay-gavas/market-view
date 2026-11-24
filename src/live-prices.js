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
const SLUG=/^[a-z0-9][a-z0-9_-]{0,119}$/;

export function marketHours(now=new Date()){
 const ist=new Date(+now+330*60000),day=ist.getUTCDay(),minute=ist.getUTCHours()*60+ist.getUTCMinutes();
 return day>0&&day<6&&minute>=555&&minute<930;
}
export function holdingSlugs(snapshots=[]){
 return [...new Set(snapshots.flatMap(s=>s.tables?.holdings||[]).filter(r=>num(r.qty)&&r.qty>0).map(r=>String(r.groww_slug||'').toLowerCase()).filter(s=>SLUG.test(s)))].sort();
}
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
 constructor({endpoint,slugs,onChange=()=>{},fetcher=(...a)=>globalThis.fetch(...a),now=()=>new Date(),setTimer=globalThis.setTimeout.bind(globalThis),clearTimer=globalThis.clearTimeout.bind(globalThis),visible=()=>globalThis.document?.visibilityState!=='hidden',marketOpen=marketHours,chunk=8}){
  Object.assign(this,{endpoint:String(endpoint||'').replace(/\/+$/,''),slugs,onChange,fetcher,now,setTimer,clearTimer,visible,marketOpen,chunk});
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
  const slugs=this.slugs();if(!slugs.length){this.error='No holdings to price.';this.notify();return false;}
  this.busy=true;this.error='';this.retryAfter=0;this.notify();
  let fresh=0,failed=0;
  try{
   // Small batches: the relay handles only a few slugs per call and returns the rest as `deferred`.
   const queue=[...slugs];
   while(queue.length){
    const batch=queue.splice(0,this.chunk);
    const response=await this.fetcher(this.endpoint+'/quotes?slugs='+encodeURIComponent(batch.join(',')),{credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error('Price relay returned '+response.status+'.');
    const body=await response.json();
    for(const q of body.quotes||[])if(typeof q?.groww_slug==='string'&&num(q.ltp)&&q.ltp>0){this.quotes.set(q.groww_slug,q);fresh++;}
    failed+=(body.failures||[]).length;
    if(body.retryAfter){this.retryAfter=body.retryAfter;failed+=queue.length+(body.deferred||[]).length;break;}
    const deferred=(body.deferred||[]).filter(s=>batch.includes(s));
    if(deferred.length===batch.length){failed+=deferred.length+queue.length;break;}  // no progress: stop, don't loop
    queue.unshift(...deferred);
   }
   if(fresh){this.version++;this.lastAt=this.now().toISOString();}
   if(failed)this.error=`${failed} price${failed===1?'':'s'} unavailable`;
   return fresh>0;
  }catch(error){this.error='Price fetch failed';return false;}
  finally{this.busy=false;this.notify();}
 }
 stop(){this.clearTimer(this.timer);this.timer=null;this.mode='demand';this.count=0;}
 clear(){this.stop();this.quotes=new Map();this.version++;this.lastAt=null;this.note='';this.error='';}
}
