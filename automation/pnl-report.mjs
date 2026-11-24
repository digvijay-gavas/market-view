// Groww "Stocks P&L" export → groww.pnl_report tables (same shape the Market app published).
// Ported from the Market app's Python parser: tables are found by their header row, not offsets.
import {readWorkbook} from './xlsx.mjs';

const TRADE_REALISED=['stock name','isin','quantity','buy date','buy price','buy value','sell date'];
const TRADE_UNREALISED=['stock name','isin','quantity','buy date','buy price','buy value','closing date'];
const SCRIP_UNREALISED=['stock name','isin','quantity','avg buy price','buy value','closing price'];
const norm=v=>v==null?'':String(v).trim().toLowerCase();
function findHeader(rows,signature){
 for(let i=0;i<rows.length;i++){const cells=(rows[i]||[]).slice(0,signature.length).map(norm);if(cells.length===signature.length&&cells.every((c,k)=>c.startsWith(signature[k])))return i;}
 return null;
}
function table(rows,header,ncols){
 const out=[];let start=header+1;
 // Groww leaves an empty row under each header (the Python reader never saw it).
 while(start<rows.length&&!(rows[start]||[]).some(v=>v!=null&&v!==''))start++;
 for(const row of rows.slice(start)){const first=norm(row?.[0]);if(!first||first==='total'||first==='grand total'||first.startsWith('disclaimer'))break;out.push(Array.from({length:ncols},(_,i)=>row[i]??null));}
 return out;
}
const iso=(y,m,d)=>{const t=Date.UTC(y,m-1,d),s=new Date(t).toISOString().slice(0,10);return Number.isFinite(t)&&s===`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`?s:null;};
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export function toDate(v){
 if(v==null||v==='')return null;
 // Excel serial day (1900 system, days since 1899-12-30).
 if(typeof v==='number'){if(v<20000||v>80000)return null;return new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000).toISOString().slice(0,10);}
 const s=String(v).trim();let m;
 if((m=s.match(/^(\d{2})-(\d{2})-(\d{4})$/)))return iso(+m[3],+m[2],+m[1]);
 if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})/)))return iso(+m[1],+m[2],+m[3]);
 if((m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)))return iso(+m[3],+m[2],+m[1]);
 if((m=s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/))&&MONTHS.includes(m[2].toLowerCase()))return iso(+m[3],MONTHS.indexOf(m[2].toLowerCase())+1,+m[1]);
 return null;
}
// Groww writes '#NUM!' into divide-by-zero percent cells.
export function toNumber(v){
 if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;
 const s=String(v).replace(/[,₹]/g,'').trim();if(!s||s.startsWith('#'))return null;const n=Number(s);return Number.isFinite(n)?n:null;
}
function banner(rows){
 const meta={};
 for(const row of rows.slice(0,12)){
  if(!row?.length)continue;const label=norm(row[0]),value=row[1];
  if(label.startsWith('name')&&value)meta.account_name=String(value).trim();
  else if(label.includes('client code')&&value!=null)meta.client_code=typeof value==='number'?String(Math.round(value)):String(value).trim();
  else if(label.startsWith('p&l statement')){const found=String(row[0]).match(/\d{2}-\d{2}-\d{4}/g)||[];if(found.length===2){meta.period_start=toDate(found[0]);meta.period_end=toDate(found[1]);}}
 }
 return meta;
}
const rowsOf=(data,cols,numbers,dates)=>data.map(r=>{const o=Object.fromEntries(cols.map((c,i)=>[c,r[i]]));for(const c of numbers)o[c]=toNumber(o[c]);for(const c of dates)o[c]=toDate(o[c]);o.stock_name=String(o.stock_name??'').trim();o.isin=String(o.isin??'').trim();if(o.remark!==undefined)o.remark=o.remark==null?null:String(o.remark);return o;});

export function parsePnlReport(buf){
 const sheets=readWorkbook(buf),trade=sheets['Trade Level'],scrip=sheets['Scrip Level'];
 if(!trade||!scrip)throw new Error('PNL_REPORT_UNRECOGNISED');
 const meta=banner(trade);
 const lotCols=['stock_name','isin','quantity','buy_date','buy_price','buy_value','closing_date','closing_price','closing_value','unrealised_pnl','remark'];
 const realisedCols=['stock_name','isin','quantity','buy_date','buy_price','buy_value','sell_date','sell_price','sell_value','realised_pnl','remark'];
 const scripCols=['stock_name','isin','quantity','avg_buy_price','buy_value','closing_price','closing_value','unrealised_pnl','unrealised_pnl_pct'];
 const h=findHeader(trade,TRADE_UNREALISED),r=findHeader(trade,TRADE_REALISED),s=findHeader(scrip,SCRIP_UNREALISED);
 if(h===null)throw new Error('PNL_REPORT_UNRECOGNISED');
 const open_lots=rowsOf(table(trade,h,11),lotCols,['quantity','buy_price','buy_value','closing_price','closing_value','unrealised_pnl'],['buy_date','closing_date']);
 const realised=r===null?[]:rowsOf(table(trade,r,11),realisedCols,['quantity','buy_price','buy_value','sell_price','sell_value','realised_pnl'],['buy_date','sell_date']);
 // Groww writes the percent column as a fraction; store it as a percent.
 const scrip_holdings=s===null?[]:rowsOf(table(scrip,s,9),scripCols,scripCols.slice(2),[]).map(x=>({...x,unrealised_pnl_pct:x.unrealised_pnl_pct==null?null:x.unrealised_pnl_pct*100}));
 let asOf=open_lots.map(l=>l.closing_date).filter(Boolean).sort().at(-1)||null;
 if(!asOf)for(const row of scrip){if(row?.[0]&&norm(row[0]).includes('holdings as on')){asOf=toDate(String(row[0]).match(/\d{2}-\d{2}-\d{4}/)?.[0]);break;}}
 if(open_lots.some(l=>!l.isin||!l.stock_name))throw new Error('PNL_REPORT_UNRECOGNISED');
 return {asOf,meta:{client_code:meta.client_code??null,account_name:meta.account_name??null,period_start:meta.period_start??null,period_end:meta.period_end??null},tables:{open_lots,realised,scrip_holdings}};
}
