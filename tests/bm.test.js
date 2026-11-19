import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachBm} from '../src/bm.js';
import {buildPortfolio,validateSnapshot} from '../src/model.js';
import {samePortfolio} from '../src/cache.js';
const source=(stocks,extra={})=>({store_version:1,schema_version:1,dataset:'smallcase.constituents',partition:'BAMIMO_0002',captured_at:'2026-01-01T10:00:00Z',as_of:'2026-01-01',content_hash:'sha256:'+'a'.repeat(64),meta:{id:'BAMIMO_0002',name:'Synthetic BM'},tables:{stocks},...extra});
const stocks=[{name:'Synthetic Alpha Ltd',weight:20},{name:'Synthetic Beta Limited',weight:30},{name:'Not Held',weight:50}];
const positions=[{key:'alpha',name:'Synthetic Alpha',value:150},{key:'beta',name:'Synthetic Beta',value:50},{key:'cash',name:'Reserve',value:800}];
test('BM percentages exclude nonmembers and renormalise held targets',()=>{
 const p=attachBm(positions,[source(stocks)]);
 assert.deepEqual(p.positions.map(r=>[r.bmTarget,r.bmWeight,r.bmDrift]),[[40,75,35],[60,25,-35],[null,null,null]]);
 assert.deepEqual(p.bm.missing,['Not Held']);assert.equal(p.bm.capturedAt,'2026-01-01T10:00:00Z');
});
test('account filtering recalculates BM weights while whole-book weights stay separate',()=>{
 const snap=(partition,values)=>({partition,tables:{holdings:values.map(([slug,name,value])=>({groww_slug:slug,name,qty:1,invested:value,current_value:value}))}});
 const p=buildPortfolio([snap('one',[['alpha','Synthetic Alpha',150],['cash','Reserve',800]]),snap('two',[['beta','Synthetic Beta',50]])],[],'one',[],[source(stocks)]);
 assert.equal(p.positions.find(r=>r.key==='alpha').bmTarget,100);assert.equal(p.positions.find(r=>r.key==='alpha').bmWeight,100);
 assert.ok(p.positions.find(r=>r.key==='alpha').weight<16);assert.equal(p.value,950);
});
test('missing source, other smallcases and missing member values never fabricate BM numbers',()=>{
 assert.equal(attachBm(positions).bm.available,false);
 assert.equal(attachBm(positions,[source(stocks,{partition:'OTHER'})]).bm.available,false);
 const p=attachBm([{...positions[0],value:null},positions[1]],[source(stocks)]);
 assert.equal(p.positions[0].bmTarget,40);assert.equal(p.positions[1].bmWeight,null);assert.equal(p.positions[1].bmDrift,null);
});
test('ambiguous names and substring-only matches are excluded',()=>{
 const p=attachBm([...positions,{key:'alpha-two',name:'Synthetic Alpha Ltd',value:20},{key:'short',name:'Synthetic',value:20}],[source(stocks)]);
 assert.equal(p.positions[0].bmTarget,null);assert.equal(p.positions[3].bmTarget,null);assert.equal(p.positions[4].bmTarget,null);
 assert.deepEqual(p.bm.ambiguous,['Synthetic Alpha Ltd']);
});
test('BM snapshot validation rejects invalid identity and target data',()=>{
 assert.equal(validateSnapshot(source(stocks),'smallcase.constituents','BAMIMO_0002').tables.stocks.length,3);
 for(const bad of [source(stocks,{meta:{id:'OTHER'}}),source([{name:'Alpha',weight:-1}]),source([{name:'Alpha',weight:Infinity}]),source([{name:'Alpha'}])])assert.throws(()=>validateSnapshot(bad,'smallcase.constituents','BAMIMO_0002'));
});
test('a changed BM capture invalidates cached portfolio rendering',()=>{
 const a={smallcases:[source(stocks)]};assert.equal(samePortfolio(a,structuredClone(a)),true);
 const b=structuredClone(a);b.smallcases[0].tables.stocks[0].weight=40;assert.equal(samePortfolio(a,b),false);
 assert.equal(samePortfolio({},a),false);
});
