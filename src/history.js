// Overview history chart: current value ÷ invested (1 = break-even) or open-holdings XIRR (%) per
// trading day, from market-view-data/_market-view-history.json (written by the collector).
export const HISTORY_FILE='_market-view-history.json';
const num=x=>typeof x==='number'&&Number.isFinite(x);
const DAY=/^\d{4}-\d{2}-\d{2}$/;

export function validHistory(doc){
 if(doc?.version!==1||!Array.isArray(doc.points))return null;
 const points=doc.points.filter(p=>DAY.test(p?.date)&&p.accounts&&typeof p.accounts==='object').sort((a,b)=>a.date.localeCompare(b.date));
 return {...doc,points};
}
// accounts: names to include (null = all accounts present in the history).
// A point is used only when every chosen account has data that day, so the line never jumps
// because an account's first capture joins the total.
export function historySeries(doc,accounts,metric='multiple'){
 if(!doc?.points?.length)return {points:[],reason:'No history recorded yet.'};
 const all=[...new Set(doc.points.flatMap(p=>Object.keys(p.accounts)))].sort();
 const chosen=accounts===null?all:accounts.filter(a=>all.includes(a));
 if(!chosen.length)return {points:[],reason:'No history for the chosen accounts.'};
 if(metric==='xirr'&&accounts!==null&&chosen.length>1&&chosen.length<all.length)return {points:[],reason:'XIRR history is kept for all accounts together or one account at a time.'};
 const key=metric==='xirr'?(chosen.length===all.length?'all':chosen[0]):null;
 const points=[];
 for(const p of doc.points){
  if(!chosen.every(a=>p.accounts[a]))continue;
  if(metric==='xirr'){const x=p.xirr?.[key];if(num(x?.rate))points.push({date:p.date,value:x.rate*100,coverage:x.coverage});continue;}
  let invested=0,value=0;for(const a of chosen){invested+=p.accounts[a].invested;value+=p.accounts[a].value;}
  if(invested>0)points.push({date:p.date,value:value/invested,invested,current:value});
 }
 const since=points[0]?.date;
 return {points,since,accounts:chosen,reason:points.length?'':'Not enough history yet.'};
}
// Chart geometry in a fixed viewBox; the caller turns it into SVG and handles hover.
// `base` is the reference line: 1 for the multiple (break-even), 0 for XIRR.
export function chartGeometry(points,{width=640,height=200,pad={l:44,r:12,t:12,b:24},base=0}={}){
 if(points.length<2)return null;
 const values=points.map(p=>p.value);let lo=Math.min(base,...values),hi=Math.max(base,...values);
 const span=hi-lo||1;lo-=span*0.08;hi+=span*0.08;
 const step=niceStep((hi-lo)/4),ticks=[];for(let t=Math.ceil(lo/step)*step;t<=hi+1e-9;t+=step)ticks.push(Math.round(t*1e4)/1e4);
 const t0=Date.parse(points[0].date),t1=Date.parse(points.at(-1).date);
 const x=d=>pad.l+(Date.parse(d)-t0)/(t1-t0||1)*(width-pad.l-pad.r),y=v=>pad.t+(hi-v)/(hi-lo)*(height-pad.t-pad.b);
 const xy=points.map(p=>[x(p.date),y(p.value)]);
 return {width,height,pad,ticks:ticks.map(v=>({v,y:y(v),base:Math.abs(v-base)<1e-9})),zero:y(base),xy,path:'M'+xy.map(([a,b])=>a.toFixed(1)+','+b.toFixed(1)).join('L'),
  months:monthTicks(points[0].date,points.at(-1).date).map(d=>({d,x:x(d)}))};
}
function niceStep(raw){const p=10**Math.floor(Math.log10(raw)),n=raw/p;return (n<=1?1:n<=2?2:n<=5?5:10)*p;}
function monthTicks(from,to){
 const out=[];let [y,m]=from.split('-').map(Number);m++;if(m>12){m=1;y++;}
 for(;;){const d=y+'-'+String(m).padStart(2,'0')+'-01';if(d>to)break;out.push(d);m++;if(m>12){m=1;y++;}}
 return out;
}
