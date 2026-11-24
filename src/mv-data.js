// market-view's own data, kept in a `market-view-data` folder inside the shared market-data folder.
// The Market app owns the datasets at the top level (groww.pnl_report, smallcase.constituents, …);
// market-view never writes those. Its captures live here, in its own format, and the viewer
// reads both sources, using whichever is newer.
export const MV_FOLDER='market-view-data';
// Written once into the folder (and as its Drive description) so the Market app, and people
// browsing Drive, can tell this folder is not theirs to change.
export const MV_OWNER_FILE='_OWNER_market-view.json';
export const MV_OWNER_NOTE="Owned by market-view (repo: market-view). The Market app (repo: market) must not write, move or delete anything in this folder; it may read it. Formats here are market-view's own and may change with market-view releases.";
export const MV_OWNER_DOC=Object.freeze({owner:'market-view',purpose:'market-view collector and viewer data: positions, prices, position changes, P&L lots, BM weights, run status and the dashboard cache.',rules:MV_OWNER_NOTE,datasets:['_schema','portfolio.positions','portfolio.position_changes','market.prices','pnl.lots','bm.weights'],files:['_market-view-dashboard-cache.json','_market-view-collector-status.json']});
export const MV_DATASETS=Object.freeze({
 // Open purchase lots from Groww's P&L export: what XIRR needs, nothing more.
 'pnl.lots':{version:1,semantics:'latest',partition:'account',max_age_hours:24*8},
 // Constituent target weights of a subscribed smallcase (BM). Each change is a new file, so the
 // folder doubles as rebalance history.
 'bm.weights':{version:1,semantics:'latest',partition:'smallcase',max_age_hours:48},
});
// Everything the viewer reads from market-view-data (positions and prices moved here from the root).
export const MV_SOURCES=Object.freeze(['_schema','portfolio.positions','market.prices','pnl.lots','bm.weights']);
const number=x=>typeof x==='number'&&Number.isFinite(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x);

export function validateMv(doc,dataset){
 if(dataset==='pnl.lots'){
  if(!Array.isArray(doc.tables?.lots))throw new Error('Invalid P&L lots');
  for(const l of doc.tables.lots)if(!l||typeof l.isin!=='string'||!l.isin||typeof l.stock_name!=='string'||!number(l.quantity)||l.quantity<=0||!number(l.buy_value)||l.buy_value<0||!day(l.buy_date))throw new Error('Invalid P&L lot');
  return doc;
 }
 if(dataset==='bm.weights'){
  if(typeof doc.meta?.id!=='string'||doc.meta.id.toLowerCase()!==doc.partition||!Array.isArray(doc.tables?.stocks)||!doc.tables.stocks.length)throw new Error('Invalid BM weights');
  for(const s of doc.tables.stocks)if(!s||typeof s.name!=='string'||!s.name.trim()||!number(s.weight)||s.weight<0||s.weight>100)throw new Error('Invalid BM weight');
  const total=doc.tables.stocks.reduce((t,s)=>t+s.weight,0);if(Math.abs(total-100)>1.5)throw new Error('BM weights do not add up to 100');
  return doc;
 }
 throw new Error('Unknown market-view dataset');
}
// Shapes the rest of the viewer already understands.
export function lotsAsReport(doc){
 return {...doc,dataset:'groww.pnl_report',source_folder:MV_FOLDER,tables:{open_lots:doc.tables.lots.map(l=>({stock_name:l.stock_name,isin:l.isin,quantity:l.quantity,buy_date:l.buy_date,buy_price:l.buy_price??null,buy_value:l.buy_value}))}};
}
export function weightsAsSmallcase(doc){
 return {...doc,dataset:'smallcase.constituents',source_folder:MV_FOLDER,tables:{stocks:doc.tables.stocks.map(s=>({name:s.name,weight:s.weight,segment:s.segment??null}))}};
}
// Collector side: parsed Groww export → pnl.lots tables.
export function lotsFromReport(parsed){
 return {asOf:parsed.asOf,meta:{period_start:parsed.meta.period_start,period_end:parsed.meta.period_end,source:'groww-pnl-export'},
  tables:{lots:parsed.tables.open_lots.filter(l=>number(l.quantity)&&l.quantity>0).map(l=>({stock_name:l.stock_name,isin:l.isin,quantity:l.quantity,buy_date:l.buy_date,buy_price:l.buy_price,buy_value:l.buy_value}))}};
}
// Collector side: scraped smallcase page → bm.weights tables.
export function weightsFromPage(page){
 const iso=rebalanceDate(page.last_rebalance);
 return {asOf:iso,meta:{id:String(page.id).toUpperCase(),name:page.name||null,manager:page.publisher||null,last_rebalance:iso,next_rebalance:rebalanceDate(page.next_rebalance)},
  tables:{stocks:page.stocks.map(s=>({name:String(s.name).trim(),weight:s.weight,segment:s.segment||null}))}};
}
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
// '18 Sep, 2026' → '2026-09-18', as smallcase prints its rebalance dates.
export function rebalanceDate(text){
 const m=String(text||'').trim().match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]*,? (\d{4})$/);if(!m)return null;
 const month=MONTHS.indexOf(m[2].toLowerCase());if(month<0)return null;
 const d=new Date(Date.UTC(+m[3],month,+m[1]));return d.getUTCDate()===+m[1]?d.toISOString().slice(0,10):null;
}
