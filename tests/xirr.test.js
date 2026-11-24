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
test('unmatched names, missing dates and quantity/cost mismatches leave a holding out; an uncovered account is reported',()=>{
 assert.equal(openHoldingsXirr([capture],[]).rate,null);
 const partial=openHoldingsXirr([capture,{...capture,partition:'two'}],[report]);assert.ok(Math.abs(partial.rate-.1)<1e-10);assert.deepEqual(partial.coverage,{included:1,total:2,costShare:.5});assert.match(partial.excluded[0].reason,/no dated P&L report/);
 for(const change of [{stock_name:'Different company'},{buy_date:null},{quantity:9},{buy_date:'2026-02-01'}]){
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
test('one unmatched holding is left out and reported instead of blanking XIRR',async()=>{
 const {openHoldingsXirr:calc}=await import('../src/xirr.js');
 const holdings=[{groww_slug:'alpha-ltd',name:'Alpha Ltd',qty:10,invested:1000,ltp:150,current_value:1500},{groww_slug:'beta-ltd',name:'Beta Ltd',qty:5,invested:200,ltp:50,current_value:250}];
 const snap={partition:'one',as_of:'2026-06-01',tables:{holdings}};
 const lots=[{stock_name:'Alpha Ltd',isin:'INE000A00001',quantity:10,buy_value:1000,buy_date:'2025-06-01'},{stock_name:'Beta Ltd',isin:'INE000B00001',quantity:3,buy_value:120,buy_date:'2025-06-01'}];
 const r=calc([snap],[{partition:'one',as_of:'2026-05-01',captured_at:'2026-05-01T00:00:00Z',tables:{open_lots:lots}}]);
 assert.ok(r.rate>0.4&&r.rate<0.6);assert.equal(r.coverage.included,1);assert.equal(r.coverage.total,2);
 assert.equal(r.excluded[0].name,'Beta Ltd');assert.match(r.excluded[0].reason,/3 shares.*5 shares/);assert.match(r.reason,/Covers 1 of 2 holdings/);
 const mostlyMissing=calc([{...snap,tables:{holdings:[holdings[0],{...holdings[1],invested:5000}]}}],[{partition:'one',as_of:'2026-05-01',captured_at:'2026-05-01T00:00:00Z',tables:{open_lots:lots}}]);
 assert.equal(mostlyMissing.rate,null);assert.match(mostlyMissing.reason,/Only 17% of cost/);
});
test('lot cost rounding of a few rupees is accepted; a real cost gap with matching shares uses the holding cost',()=>{
 const big={...capture,tables:{holdings:[{name:'Synthetic Alpha',qty:10,invested:87609.76,current_value:90000}]}};
 const lots=cost=>({...report,tables:{open_lots:[{...report.tables.open_lots[0],buy_value:cost}]}});
 const rounding=openHoldingsXirr([big],[lots(87607.26)]);assert.equal(rounding.coverage.included,1);assert.deepEqual(rounding.adjusted,[]);
 // Shares credited into Groww (grey market / transfer): the report shows a market price, the holding the real cost.
 const gap=openHoldingsXirr([big],[lots(50000)]),asHolding=openHoldingsXirr([big],[lots(87609.76)]);
 assert.equal(gap.coverage.included,1);assert.deepEqual(gap.adjusted,[{account:'one',name:'Synthetic Alpha',lotCost:50000,invested:87609.76}]);
 assert.ok(Math.abs(gap.rate-asHolding.rate)<1e-12,'same return as if the lots carried the holding cost');
});
