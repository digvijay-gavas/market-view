// Small pure helpers for the Data "update race" and the Allocation donut.
// Account colours: dark-surface categorical steps validated with the dataviz checker
// (adjacent-pair CVD and normal-vision separation pass on #191d1f). Fixed order, never cycled.
export const ACCOUNT_COLORS=Object.freeze(['#3987e5','#d95926','#199e70','#c98500','#d55181','#9085e9']);
export const OTHER_COLOR='#6b7576';

const UNITS=[{id:'s',ms:1000,label:'sec'},{id:'m',ms:60000,label:'min'},{id:'h',ms:3600000,label:'hr'},{id:'d',ms:86400000,label:'day'}];
const STEPS=[1,2,3,5,6,10,12,15,20,30,60,90,120];

// Picks the unit from the oldest age, then a round scale with at most ~5 ticks.
export function raceScale(maxAgeMs){
 const age=Math.max(1000,Number.isFinite(maxAgeMs)?maxAgeMs:0);
 const unit=age<=90000?UNITS[0]:age<=90*60000?UNITS[1]:age<=48*3600000?UNITS[2]:UNITS[3];
 const units=Math.max(1,Math.ceil(age/unit.ms)),step=STEPS.find(s=>units/s<=3)||Math.ceil(units/3);
 const max=Math.ceil(units/step)*step,ticks=[];for(let t=max;t>=0;t-=step)ticks.push(t);
 return {unit:unit.id,unitLabel:unit.label,unitMs:unit.ms,max,maxMs:max*unit.ms,ticks};
}
// How far along the "race to now" an update is: 1 = just now, 0 = at the oldest edge of the scale.
export function raceProgress(ageMs,scale){return Math.min(1,Math.max(0,1-ageMs/scale.maxMs));}
export function shortAgo(ageMs){
 const s=Math.max(0,ageMs)/1000;
 return s<60?Math.floor(s)+'s ago':s<3600?Math.floor(s/60)+'m ago':s<86400?Math.floor(s/3600)+'h ago':Math.floor(s/86400)+'d ago';
}

// Stable colour per account name (alphabetical over all accounts in the store), so filtering never repaints.
export function accountColors(allNames){
 const map=new Map();[...new Set(allNames)].sort().forEach((n,i)=>map.set(n,i<ACCOUNT_COLORS.length?ACCOUNT_COLORS[i]:OTHER_COLOR));return map;
}

// Donut slices as SVG paths. Angles start at 12 o'clock and run clockwise.
export function donutSlices(values,{r=80,inner=52,cx=100,cy=100}={}){
 const total=values.reduce((s,v)=>s+(v>0?v:0),0);if(!(total>0))return [];
 let angle=-Math.PI/2;const out=[];
 for(const v of values){
  const share=v>0?v/total:0,sweep=share*Math.PI*2;
  if(share<=0){out.push({share:0,d:''});continue;}
  // A single 100% slice cannot be drawn as one arc; split it into two halves.
  const end=angle+Math.min(sweep,Math.PI*2-1e-6),large=sweep>Math.PI?1:0;
  const p=(rad,a)=>[cx+rad*Math.cos(a),cy+rad*Math.sin(a)].map(n=>n.toFixed(2)).join(' ');
  const d=`M ${p(r,angle)} A ${r} ${r} 0 ${large} 1 ${p(r,end)} L ${p(inner,end)} A ${inner} ${inner} 0 ${large} 0 ${p(inner,angle)} Z`;
  out.push({share,d});angle+=sweep;
 }
 return out;
}
