import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildHistory} from '../automation/history.mjs';
import {historySeries,chartGeometry,validHistory} from '../src/history.js';

const closes=new Map([['a',new Map([['2026-11-02',10],['2026-11-03',11],['2026-11-04',12]])],['b',new Map([['2026-11-03',20],['2026-11-04',22]])]]);
const captures=[
 {account:'x',at:'2026-11-02T10:00:00Z',rows:[{groww_slug:'a',name:'A',qty:10,invested:100,price:10}]},
 {account:'y',at:'2026-11-03T10:00:00Z',rows:[{groww_slug:'b',name:'B',qty:5,invested:100,price:20}]},
 {account:'x',at:'2026-11-04T04:00:00Z',rows:[{groww_slug:'a',name:'A',qty:20,invested:210,price:12}]},
];
test('history values each account from its latest capture at that day\'s close',()=>{
 const h=buildHistory({captures,closes,to:'2026-11-04'});
 assert.deepEqual(h.points.map(p=>p.date),['2026-11-02','2026-11-03','2026-11-04']);
 assert.deepEqual(h.points[0].accounts.x,{invested:100,value:100,priced:1,fallback:0,capturedAt:'2026-11-02T10:00:00Z'});
 assert.equal(h.points[1].accounts.x.value,110);assert.equal(h.points[1].accounts.y.value,100);
 assert.equal(h.points[2].accounts.x.value,240,'new capture (20 shares) used from its own day');assert.equal(h.points[2].accounts.x.invested,210);
});
test('history XIRR uses only lots bought by each day',()=>{
 const report={partition:'x',as_of:'2026-11-25',captured_at:'2026-11-25T00:00:00Z',tables:{open_lots:[{stock_name:'A',isin:'I1',quantity:10,buy_value:100,buy_date:'2026-10-02'},{stock_name:'A',isin:'I1',quantity:10,buy_value:110,buy_date:'2026-11-04'}]}};
 const h=buildHistory({captures:[captures[0],captures[2]],closes,reports:[report],to:'2026-11-04'});
 assert.ok(h.points[0].xirr.x.rate===0||Math.abs(h.points[0].xirr.x.rate)<1e-6,'value equals cost on day one');
 assert.ok(h.points[1].xirr.all.rate>0);assert.equal(h.points[2].xirr.all.coverage,1);
});
test('series starts when every chosen account has data; XIRR only for all or one account',()=>{
 const h=validHistory(buildHistory({captures,closes,to:'2026-11-04'}));
 const all=historySeries(h,null,'return');assert.equal(all.since,'2026-11-03');assert.equal(all.points.length,2);
 assert.ok(Math.abs(all.points[0].value-5)<1e-9,'(110+100)/(100+100)-1');
 assert.equal(historySeries(h,['x'],'return').points.length,3);
 assert.equal(historySeries(h,['x','y','z'],'return').points.length,2,'unknown accounts are ignored');
 const g=chartGeometry(all.points);assert.ok(g.path.startsWith('M'));assert.ok(g.ticks.some(t=>t.v===0));
 assert.equal(chartGeometry(all.points.slice(0,1)),null);
 assert.equal(validHistory({version:2,points:[]}),null);
});
