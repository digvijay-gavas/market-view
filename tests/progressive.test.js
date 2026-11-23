import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materializePositions,positionChanges,validateProgressive} from '../src/progressive.js';
import {buildPortfolio} from '../src/model.js';
const at='2026-11-23T04:00:00.000Z';
const pos=(account,rows,time=at)=>({store_version:1,schema_version:1,dataset:'portfolio.positions',partition:account,captured_at:time,as_of:'2026-11-23',content_hash:'sha256:'+'a'.repeat(64),tables:{positions:rows}});
const row=(qty=2)=>({groww_slug:'example',name:'Example',qty,invested:qty*100,avg_price:100,reference_price:105,reference_value:qty*105});
const quotes=(ltp=110,time='2026-11-23T04:10:00.000Z')=>({tables:{quotes:[{groww_slug:'example',ltp,fetched_at:time,quoted_at:null,source:'test'}]}});
test('one shared price values different account quantities without altering cost basis',async()=>{
 const result=await materializePositions([],[pos('a',[row()]),pos('b',[row(3)])],[quotes()],Date.parse('2026-11-23T04:15:00Z'));
 const view=buildPortfolio(result.snapshots);assert.equal(view.value,550);assert.equal(view.cost,500);assert.equal(result.sources.length,2);assert.equal(result.snapshots[0].meta.positions_captured_at,at);
});
test('old and future observations retain reconciliation prices and disclose fallback',async()=>{
 for(const time of ['2026-11-22T04:10:00Z','2026-11-24T04:10:00Z']){
 const result=await materializePositions([],[pos('a',[row()])],[quotes(999,time)],Date.parse(at));assert.equal(result.snapshots[0].tables.holdings[0].current_value,210);assert.equal(result.sources[0].fallback,1);assert.match(result.warnings[0],/no newer quote/);
 }
});
test('stale observations retain their original timestamps and warn; newer legacy basis wins',async()=>{
 const result=await materializePositions([],[pos('a',[row()])],[quotes()],Date.parse('2026-11-23T05:00:00Z'));
 assert.equal(result.sources[0].stale,1);assert.equal(result.sources[0].pricesFrom,'2026-11-23T04:10:00.000Z');
 const legacy={...pos('a',[],'2026-11-23T05:00:00Z'),dataset:'groww.live_holdings',tables:{holdings:[{...row(4),ltp:120,current_value:480}]}};
 const newer=await materializePositions([legacy],[pos('a',[row()])],[],Date.parse('2026-11-23T05:00:00Z'));assert.equal(newer.snapshots[0],legacy);
});
test('mixed price dates fail closed for valuation date, preserving incomplete values',async()=>{
 const unknown={...row(),groww_slug:'unknown',reference_price:null,reference_value:null};
 const result=await materializePositions([],[pos('a',[row(),unknown],'2026-11-22T04:00:00Z')],[quotes()],Date.parse('2026-11-23T04:15:00Z'));
 assert.equal(result.snapshots[0].as_of,null);assert.equal(buildPortfolio(result.snapshots).value,null);
});
test('quantity differences are observed changes, including removals and unknown costs',()=>{
 const before=pos('a',[{...row(4),invested:null}]);const after=pos('a',[row(2)]);
 const change=positionChanges(before,after)[0];assert.equal(change.quantity_delta,-2);assert.equal(change.cost_delta,null);assert.equal(change.classification,'position_change');
 assert.equal(positionChanges(before,pos('a',[]))[0].quantity_delta,-4);assert.equal(positionChanges(before,before).length,0);
});
test('progressive validators reject duplicate instruments, negative quantities and absent price time',()=>{
 assert.throws(()=>validateProgressive(pos('a',[row(),row()])));assert.throws(()=>validateProgressive(pos('a',[row(-1)])));
 assert.throws(()=>validateProgressive({dataset:'market.prices',tables:{quotes:[{groww_slug:'x',ltp:1,source:'test'}]}}));
 assert.doesNotThrow(()=>validateProgressive(pos('a',[])));
});
