import {openHoldingsXirr} from './xirr.js';
// Market store v1 reader. All fixtures in tests are synthetic.
export const SNAPSHOT = /^\d{8}T\d{6}Z__[0-9a-f]{12}\.json$/;
export const numeric = x => typeof x === 'number' && Number.isFinite(x);
const sum = xs => xs.reduce((a,b) => a+b,0);
const total = xs => xs.every(numeric) ? sum(xs) : null;
export const percentage = (part, base) => numeric(part) && numeric(base) && base > 0 ? part / base * 100 : null;

export function validateSnapshot(doc, dataset, partition) {
  if (!doc || doc.store_version !== 1 || doc.schema_version !== 1 || doc.dataset !== dataset || doc.partition !== partition || !Number.isFinite(Date.parse(doc.captured_at)) || !/(Z|[+-]\d{2}:\d{2})$/.test(doc.captured_at) || !/^sha256:[0-9a-f]{64}$/.test(doc.content_hash) || (doc.as_of !== null && (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of))) || !doc.tables || typeof doc.tables !== 'object') throw new Error('Invalid or unsupported snapshot envelope');
  if(dataset==='groww.pnl_report'){
    if(!Array.isArray(doc.tables.open_lots))throw new Error('Missing open lots');
    for(const row of doc.tables.open_lots){if(!row||typeof row.isin!=='string'||!row.isin||typeof row.stock_name!=='string')throw new Error('Invalid purchase lot');for(const key of ['quantity','buy_value'])if(row[key]!=null&&(!numeric(row[key])||row[key]<0))throw new Error('Invalid purchase amount');}
    return doc;
  }
  const table = dataset === 'groww.live_holdings' ? 'holdings' : 'credits';
  if (!Array.isArray(doc.tables[table])) throw new Error(`Missing ${table} table`);
  for (const row of doc.tables[table]) {
    if (!row || typeof row !== 'object') throw new Error('Invalid table row');
    if (table === 'holdings') {
      if (typeof row.groww_slug !== 'string' || !row.groww_slug.trim() || typeof row.name !== 'string' || !('qty' in row) || !('invested' in row)) throw new Error('Invalid holdings row');
      for (const k of ['qty','avg_price','ltp','invested','current_value']) if (row[k] != null && (!numeric(row[k]) || row[k] < 0)) throw new Error(`Invalid holding ${k}`);
    } else {
      if (typeof row.isin !== 'string' || typeof row.ex_date !== 'string' || !numeric(row.amount) || !numeric(row.shares)) throw new Error('Invalid dividend credit');
    }
  }
  return doc;
}

export async function newestValid(files, read, dataset, partition, onSkip = () => {}) {
  const candidates = files.filter(f => SNAPSHOT.test(f.name)).sort((a,b) => b.name.localeCompare(a.name) || a.id.localeCompare(b.id));
  // Validate file time against envelope time; filename order must be trustworthy.
  for (const file of candidates) {
    try {
      const doc = validateSnapshot(await read(file), dataset, partition);
      const stamp = new Date(doc.captured_at).toISOString().replace(/[-:]/g,'').slice(0,15)+'Z';
      if (!file.name.startsWith(stamp+'__')) throw new Error('Capture time does not match filename');
      return {...doc, fileId:file.id};
    } catch (e) { if (e.authExpired || e.fatal) throw e; onSkip(file, e); }
  }
  return null;
}

export function buildPortfolio(snapshots, dividendSnapshots = [], account = '', reports = []) {
  const selected = snapshots.filter(s => !account || s.partition === account);
  const grouped = new Map();
  const accounts = selected.map(s => {
    const rows = s.tables.holdings.map(r => {
      const quantity = numeric(r.qty) ? r.qty : null;
      const cost = numeric(r.invested) ? r.invested : numeric(quantity) && numeric(r.avg_price) ? quantity*r.avg_price : null;
      const value = numeric(r.current_value) ? r.current_value : numeric(quantity) && numeric(r.ltp) ? quantity*r.ltp : null;
      const pnl = numeric(value) && numeric(cost) ? value-cost : null;
      return {key:r.groww_slug,name:r.name,quantity,cost,value,pnl,account:s.partition};
    });
    for (const r of rows) {
      const old = grouped.get(r.key) || {key:r.key,name:r.name,rows:[]};
      old.rows.push(r);grouped.set(r.key,old);
    }
    return {name:s.partition,value:total(rows.map(r=>r.value)),cost:total(rows.map(r=>r.cost)),positions:rows.length,asOf:s.as_of,capturedAt:s.captured_at};
  });
  const positions = [...grouped.values()].map(g => {
    const value=total(g.rows.map(r=>r.value)),cost=total(g.rows.map(r=>r.cost));
    return {key:g.key,name:g.name,quantity:total(g.rows.map(r=>r.quantity)),value,cost,pnl:numeric(value)&&numeric(cost)?value-cost:null,accounts:[...new Set(g.rows.map(r=>r.account))]};
  }).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity));
  // User treats this specific ETF as their cash reserve; do not classify other liquid funds by fuzzy names.
  const isCash=p=>p.key==='zerodha-nifty-d-rate-liquid-etf'||p.key.trim().toUpperCase()==='LIQUIDCASE'||p.name.trim().toUpperCase()==='LIQUIDCASE';
  const cashEquivalent=total(positions.filter(isCash).map(p=>p.value));
  const otherHoldingsValue=total(positions.filter(p=>!isCash(p)).map(p=>p.value));
  const value=total(positions.map(p=>p.value)),cost=total(positions.map(p=>p.cost));
  const pnl=numeric(value)&&numeric(cost)?value-cost:null;
  const credits=new Map();
  const selectedAccounts=new Set(selected.map(s=>s.partition));
  for(const s of dividendSnapshots.filter(s=>selectedAccounts.has(s.partition))) for(const r of s.tables.credits) {
    // Reports overlap. The account is essential: the same credit can occur in two accounts.
    const key=JSON.stringify([s.partition,r.isin,r.ex_date,r.shares,r.amount]);
    credits.set(key,r);
  }
  const weights=positions.map(p=>percentage(p.value,value));
  const annualised=openHoldingsXirr(selected,reports);
  return {xirr:numeric(annualised.rate)?annualised.rate*100:null,xirrReason:annualised.reason,cashEquivalent,otherHoldingsValue,cashWeight:percentage(cashEquivalent,value),accounts,positions:positions.map((p,i)=>({...p,weight:weights[i],returnPct:percentage(p.pnl,p.cost)})),value,cost,pnl,returnPct:percentage(pnl,cost),dividends:dividendSnapshots.some(s=>selectedAccounts.has(s.partition))?sum([...credits.values()].map(r=>r.amount)):null,dividendAccounts:[...new Set(dividendSnapshots.filter(s=>selectedAccounts.has(s.partition)).map(s=>s.partition))],top5:positions.length&&numeric(value)?percentage(sum(positions.slice(0,5).map(p=>p.value??0)),value):null,incomplete:positions.filter(p=>!numeric(p.value)||!numeric(p.cost)).length};
}

export function confirmationAt(snapshot, logs) {
  let latest=Date.parse(snapshot.captured_at);
  for(const log of logs) if(log.dataset===snapshot.dataset && log.partition===snapshot.partition && ['unchanged','written'].includes(log.action) && log.hash===snapshot.content_hash) {
    const at=Date.parse(log.at); if(Number.isFinite(at)) latest=Math.max(latest,at);
  }
  return new Date(latest).toISOString();
}
