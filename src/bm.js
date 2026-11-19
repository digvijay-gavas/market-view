import {instrumentIsins} from './instruments.js';

// Store.publish canonicalizes folder/envelope partitions to lowercase; meta.id keeps the source ID.
export const isBmPartition=value=>typeof value==='string'&&value.toLowerCase()==='bamimo_0002';

// Same company-name normalization as Market's BM reader; never substring/fuzzy match.
const key=name=>String(name||'').toLowerCase().replace(/-/g,' ').replace(/\b(ltd|limited|india|the|company|co|corp|corpn|industries|enterprises|technologies|services|systems|financial|finance)\b/g,' ').replace(/[^a-z0-9]/g,'');
const number=x=>typeof x==='number'&&Number.isFinite(x);
export function attachBm(positions, snapshots=[]) {
 const source=snapshots.find(s=>isBmPartition(s.partition));
 const unavailable=reason=>({positions:positions.map(p=>({...p,bmTarget:null,bmWeight:null,bmDrift:null})),bm:{available:false,reason}});
 if(!source)return unavailable('BM targets unavailable. No saved BM Focused Small Cap constituents capture (BAMIMO_0002).');
 const stocks=source.tables.stocks.filter(s=>number(s.weight)&&s.weight>0);
 if(!stocks.length)return unavailable('BM targets unavailable: the saved capture has no positive target weights.');
 const matches=new Map(), used=new Set(), ambiguous=[];
 for(const stock of stocks){
  const candidates=positions.filter(p=>stock.groww_slug?p.key===stock.groww_slug:stock.isin?instrumentIsins[p.key]===stock.isin:key(stock.name)&&(key(p.name)===key(stock.name)||key(p.key)===key(stock.name)));
  const sameName=stocks.filter(s=>key(s.name)===key(stock.name));
  if(candidates.length===1&&sameName.length===1&&!used.has(candidates[0].key)){
   matches.set(candidates[0].key,stock);used.add(candidates[0].key);
  }else if(candidates.length)ambiguous.push(stock.name);
 }
 // Match Market: compare target/current over the BM constituents actually held.
 const targetTotal=[...matches.values()].reduce((n,s)=>n+s.weight,0);
 const members=positions.filter(p=>matches.has(p.key));
 const value=members.every(p=>number(p.value))?members.reduce((n,p)=>n+p.value,0):null;
 const missing=stocks.filter(s=>![...matches.values()].includes(s)).map(s=>s.name);
 const rows=positions.map(p=>{
  const stock=matches.get(p.key),target=stock&&targetTotal>0?stock.weight/targetTotal*100:null;
  const weight=stock&&number(p.value)&&number(value)&&value>0?p.value/value*100:null;
  return {...p,bmTarget:target,bmWeight:weight,bmDrift:number(target)&&number(weight)?weight-target:null};
 });
 return {positions:rows,bm:{available:true,name:source.meta?.name||'BM Focused Small Cap',capturedAt:source.captured_at,asOf:source.as_of,matched:members.length,missing,ambiguous}};
}
