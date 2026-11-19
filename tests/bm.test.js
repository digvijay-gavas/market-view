import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachBm,bmRows} from '../src/bm.js';
import {buildPortfolio,validateSnapshot} from '../src/model.js';
import {samePortfolio} from '../src/cache.js';
const source=(stocks,extra={})=>({store_version:1,schema_version:1,dataset:'smallcase.constituents',partition:'BAMIMO_0002',captured_at:'2026-01-01T10:00:00Z',as_of:'2026-01-01',content_hash:'sha256:'+'a'.repeat(64),meta:{id:'BAMIMO_0002',name:'Synthetic BM'},tables:{stocks},...extra});
const stocks=[{name:'Synthetic Alpha Ltd',weight:20},{name:'Synthetic Beta Limited',weight:30},{name:'Not Held',weight:50}];
const positions=[{key:'alpha',name:'Synthetic Alpha',value:150},{key:'beta',name:'Synthetic Beta',value:50},{key:'cash',name:'Reserve',value:800}];
test('BM percentages exclude nonmembers and keep full-lineup targets',()=>{
 const p=attachBm(positions,[source(stocks)]);
 assert.deepEqual(p.positions.map(r=>[r.bmTarget,r.bmWeight,r.bmDrift]),[[20,75,55],[30,25,-5],[null,null,null]]);
 assert.deepEqual(p.bm.missing,['Not Held']);assert.equal(p.bm.capturedAt,'2026-01-01T10:00:00Z');
});
test('account filtering recalculates BM weights while whole-book weights stay separate',()=>{
 const snap=(partition,values)=>({partition,tables:{holdings:values.map(([slug,name,value])=>({groww_slug:slug,name,qty:1,invested:value,current_value:value}))}});
 const p=buildPortfolio([snap('one',[['alpha','Synthetic Alpha',150],['cash','Reserve',800]]),snap('two',[['beta','Synthetic Beta',50]])],[],'one',[],[source(stocks)]);
 assert.equal(p.positions.find(r=>r.key==='alpha').bmTarget,20);assert.equal(p.positions.find(r=>r.key==='alpha').bmWeight,100);
 assert.ok(p.positions.find(r=>r.key==='alpha').weight<16);assert.equal(p.value,950);
});
test('missing source, other smallcases and missing member values never fabricate BM numbers',()=>{
 assert.equal(attachBm(positions).bm.available,false);
 assert.equal(attachBm(positions,[source(stocks,{partition:'OTHER'})]).bm.available,false);
 const p=attachBm([{...positions[0],value:null},positions[1]],[source(stocks)]);
 assert.equal(p.positions[0].bmTarget,20);assert.equal(p.positions[1].bmWeight,null);assert.equal(p.positions[1].bmDrift,null);
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

// Regression: this is the contract produced by Market Store.publish/partition_key.
// The folder/envelope are lowercase while source metadata retains uppercase ID.
test('canonical lowercase BM envelope loads and calculates with uppercase source metadata',()=>{
 const capture=source(stocks,{partition:'bamimo_0002'});
 assert.equal(validateSnapshot(capture,'smallcase.constituents','bamimo_0002'),capture);
 const p=attachBm(positions,[capture]);assert.equal(p.bm.available,true);
 assert.equal(p.positions[0].bmTarget,20);assert.equal(p.positions[0].bmWeight,75);
 assert.throws(()=>validateSnapshot(source(stocks,{partition:'bamimo_0002',meta:{id:'OTHER'}}),'smallcase.constituents','bamimo_0002'));
});

test('full constituent names match stable Groww slugs when display names are abbreviated',()=>{
 const names=[
  ['sona-blw-precision-forgings-ltd','Sona BLW Precision','Sona BLW Precision Forgings Ltd'],
  ['ujjivan-small-finance-bank-ltd','Ujjivan Small Fin','Ujjivan Small Finance Bank Ltd'],
  ['fedbank-financial-services-ltd','Fedbank Fin.l Serv.','Fedbank Financial Services Ltd'],
  ['mas-financial-services-ltd','MAS Financial Serv.','MAS Financial Services Ltd'],
  ['safari-industries-india-ltd','Safari Industries(I)','Safari Industries (India) Ltd'],
  ['artemis-medicare-services-ltd','Artemis MedicareServ','Artemis Medicare Services Ltd'],
  ['caliber-mining-and-logistics-ltd','Caliber Mining & Log','Caliber Mining and Logistics Ltd']
 ];
 const positions=names.map(([slug,name])=>({key:slug,name,value:100}));
 const capture=source(names.map(([slug,name,full])=>({name:full,weight:10})),{partition:'bamimo_0002'});
 const p=attachBm(positions,[capture]);assert.equal(p.bm.matched,7);assert.deepEqual(p.bm.missing,[]);
 for(const row of p.positions){assert.ok(Math.abs(row.bmTarget-100/7)<1e-9);assert.ok(Math.abs(row.bmWeight-100/7)<1e-9);}
 // A slug collision remains ambiguous, rather than silently choosing a holding.
 assert.equal(attachBm([...positions,{key:'safari-industries-ltd',name:'Different label',value:10}],[capture]).positions[4].bmTarget,null);
});

test('BM filter includes missing placeholders but totals and all-holdings never do',()=>{
 const result=attachBm(positions,[source(stocks)]),p={...result,accounts:[{name:'one'}]};
 const rows=bmRows(p,'bm');assert.equal(rows.length,3);assert.equal(bmRows(p,'all').length,3);
 const missing=bmRows(p,'missing');assert.equal(missing.length,1);assert.equal(missing[0].name,'Not Held');assert.equal(missing[0].quantity,0);assert.equal(missing[0].value,null);assert.equal(missing[0].bmWeight,0);
 assert.equal(rows.reduce((n,r)=>n+r.bmTarget,0),100);assert.equal(bmRows({...p,accounts:[]},'missing').length,0);
 assert.equal(bmRows(p,'bm','not held').length,1);
});
test('removed badges require history, preserve actual holdings, and survive account filtering',()=>{
 const latest=source([{name:'Synthetic Alpha',weight:100}]);
 const previous=source(stocks,{captured_at:'2025-12-01T10:00:00Z',as_of:'2025-12-01'});
 const p={...attachBm(positions,[previous,latest]),accounts:[{name:'one'}]};
 assert.equal(bmRows(p,'removed').length,1);assert.equal(bmRows(p,'removed')[0].key,'beta');assert.equal(bmRows(p,'removed')[0].value,50);
 assert.equal(bmRows(p,'removed')[0].removedSince,'2026-01-01');assert.equal(p.positions[2].bmState,'other');
 assert.equal(attachBm(positions,[latest]).positions[1].bmState,'other');
 assert.equal(attachBm([positions[0]],[latest,previous]).bm.removed.length,0);
});
test('ambiguous constituent produces an unresolved placeholder, not a false not-held quantity',()=>{
 const p=attachBm([...positions,{...positions[0],key:'duplicate'}],[source(stocks)]);
 assert.equal(p.bm.pending.find(r=>r.name==='Synthetic Alpha Ltd').bmState,'unresolved');
 assert.equal(p.bm.pending.find(r=>r.bmState==='unresolved').bmWeight,null);assert.equal(p.bm.pending.find(r=>r.bmState==='unresolved').quantity,null);
 assert.ok(bmRows({...p,accounts:[{name:'one'}]},'missing').every(r=>r.bmState==='missing'));
});
