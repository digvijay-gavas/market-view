import {test} from 'node:test';
import assert from 'node:assert/strict';
import {xirr,openHoldingsXirr} from '../src/xirr.js';
const capture={partition:'one',as_of:'2026-01-01',tables:{holdings:[{name:'Synthetic Alpha',qty:10,invested:100,current_value:110}]}};
const report={partition:'one',as_of:'2026-01-01',captured_at:'2026-01-01T10:00:00Z',tables:{open_lots:[{stock_name:'Synthetic Alpha',isin:'SYNTHETIC001',quantity:10,buy_value:100,buy_date:'2025-01-01'}]}};
test('XIRR solves dated annualised gain, loss and zero return',()=>{
 for(const [terminal,expected]of [[110,.1],[80,-.2],[100,0]])assert.ok(Math.abs(xirr([{date:'2025-01-01',amount:-100},{date:'2026-01-01',amount:terminal}])-expected)<1e-10);
});
test('XIRR handles multiple irregular purchases and leap-year day counts',()=>{
 const rate=.15,flows=[{date:'2024-01-01',amount:-100},{date:'2024-07-01',amount:-200}];
 const end=Date.parse('2025-01-01'),value=flows.reduce((sum,f)=>sum-f.amount*Math.pow(1+rate,(end-Date.parse(f.date))/86400000/365),0);
 assert.ok(Math.abs(xirr([...flows,{date:'2025-01-01',amount:value}])-rate)<1e-10);
});
test('invalid dates, no sign change, same-day and unsupported multiple-sign flows have no rate',()=>{
 for(const flows of [[],[{date:'2025-02-30',amount:-100},{date:'2026-01-01',amount:110}],[{date:'2025-01-01',amount:100},{date:'2026-01-01',amount:110}],[{date:'2025-01-01',amount:-100},{date:'2025-01-01',amount:110}],[{date:'2024-01-01',amount:-100},{date:'2025-01-01',amount:50},{date:'2026-01-01',amount:70}]])assert.equal(xirr(flows),null);
});
test('open holdings XIRR uses reconciled dated lots and captured valuation date',()=>{
 assert.ok(Math.abs(openHoldingsXirr([capture],[report]).rate-.1)<1e-10);
 const other={...capture,partition:'two'},otherReport={...report,partition:'two'};
 assert.ok(Math.abs(openHoldingsXirr([capture,other],[report,otherReport]).rate-.1)<1e-10);
});
test('partial accounts, unmatched names, missing dates and quantity/cost mismatches never produce partial XIRR',()=>{
 assert.equal(openHoldingsXirr([capture],[]).rate,null);
 assert.equal(openHoldingsXirr([capture,{...capture,partition:'two'}],[report]).rate,null);
 for(const change of [{stock_name:'Different company'},{buy_date:null},{quantity:9},{buy_value:90},{buy_date:'2026-02-01'}]){
  const bad={...report,tables:{open_lots:[{...report.tables.open_lots[0],...change}]}};
  assert.equal(openHoldingsXirr([capture],[bad]).rate,null);
 }
});
test('latest report period wins; mixed valuation dates and future-only reports fail closed',()=>{
 const old={...report,as_of:'2025-12-01',captured_at:'2026-02-01T00:00:00Z',tables:{open_lots:[]}};
 assert.ok(Math.abs(openHoldingsXirr([capture],[old,report]).rate-.1)<1e-10);
 assert.equal(openHoldingsXirr([capture,{...capture,partition:'two',as_of:'2026-01-02'}],[report]).rate,null);
 assert.equal(openHoldingsXirr([capture],[{...report,as_of:'2026-02-01'}]).rate,null);
});

test('verified ISIN mapping reconciles Groww display names without fuzzy matching',()=>{
 const holding={...capture,tables:{holdings:[{...capture.tables.holdings[0],groww_slug:'zerodha-nifty-d-rate-liquid-etf',name:'LIQUIDCASE'}]}};
 const ledger={...report,tables:{open_lots:[{...report.tables.open_lots[0],isin:'INF0R8F01034',stock_name:'Different verified display name'}]}};
 // Registry identity, not the display name, selects the lot.
 assert.ok(Math.abs(openHoldingsXirr([holding],[ledger]).rate-.1)<1e-10);
 const wrong={...ledger,tables:{open_lots:[{...ledger.tables.open_lots[0],isin:'WRONG'}]}};assert.equal(openHoldingsXirr([holding],[wrong]).rate,null);
});

test('terminal-date purchases are allowed alongside earlier invested lots',()=>{
 const holdings={...capture,tables:{holdings:[{...capture.tables.holdings[0],qty:20,invested:200,current_value:210}]}};
 const ledger={...report,tables:{open_lots:[report.tables.open_lots[0],{...report.tables.open_lots[0],buy_date:'2026-01-01'}]}};
 assert.ok(Math.abs(openHoldingsXirr([holdings],[ledger]).rate-.1)<1e-10);
});
