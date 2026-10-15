import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPortfolio,validateSnapshot,newestValid,confirmationAt,SNAPSHOT} from '../src/model.js';
const hash='sha256:'+'a'.repeat(64);
const snapshot=(partition,rows,extra={})=>({store_version:1,schema_version:1,dataset:'groww.live_holdings',partition,captured_at:'2026-01-01T10:00:00Z',as_of:'2026-01-01',content_hash:hash,tables:{holdings:rows},...extra});
const holding=(slug,qty,cost,value)=>({groww_slug:slug,name:'Synthetic '+slug,qty,invested:cost,current_value:value});
const credit={isin:'SYNTHETIC0001',ex_date:'2026-01-01',shares:10,amount:5};
const dividend=(partition,rows)=>snapshot(partition,[],{dataset:'groww.dividend_report',tables:{credits:rows}});
test('aggregates exact slugs across accounts and calculates weighted return',()=>{
 const p=buildPortfolio([snapshot('one',[holding('x',10,100,150)]),snapshot('two',[holding('x',2,50,40),holding('y',1,50,60)])]);
 assert.equal(p.value,250);assert.equal(p.cost,200);assert.equal(p.pnl,50);assert.equal(p.returnPct,25);assert.equal(p.positions.length,2);assert.equal(p.positions[0].quantity,12);assert.equal(p.positions[0].weight,76);
});
test('account filtering isolates holdings and dividend credits',()=>{
 const p=buildPortfolio([snapshot('one',[holding('x',10,100,150)]),snapshot('two',[holding('x',2,50,40)])],[dividend('one',[credit]),dividend('two',[{...credit,amount:7}])],'two');
 assert.equal(p.value,40);assert.equal(p.accounts.length,1);assert.equal(p.dividends,7);
});
test('overlapping reports dedupe per account; same credit in another account stays',()=>{
 const p=buildPortfolio([snapshot('one',[]),snapshot('two',[])],[dividend('one',[credit]),dividend('one',[credit,{...credit,ex_date:'2026-02-01'}]),dividend('two',[credit])]);
 assert.equal(p.dividends,15);assert.equal(p.value,0);assert.equal(p.positions.length,0);
});
test('missing inputs are not zero; partial totals and weights are unavailable',()=>{
 const p=buildPortfolio([snapshot('one',[holding('x',null,null,null),holding('y',1,20,30)])]);
 assert.equal(p.value,null);assert.equal(p.cost,null);assert.equal(p.pnl,null);assert.equal(p.top5,null);assert.equal(p.positions[0].weight,null);assert.equal(p.incomplete,1);assert.equal(p.dividends,null);
});
test('zero value/cost are valid; average/price fallbacks require real inputs',()=>{
 const p=buildPortfolio([snapshot('one',[{...holding('x',0,0,0),avg_price:100,ltp:999},{groww_slug:'y',name:'Synthetic Y',qty:2,invested:null,avg_price:10,ltp:15}])]);
 assert.equal(p.value,30);assert.equal(p.cost,20);assert.equal(p.pnl,10);assert.equal(p.positions[1].value,0);
});
test('rejects malformed snapshots and unsupported versions',()=>{
 assert.throws(()=>validateSnapshot(snapshot('one',[],{schema_version:2}),'groww.live_holdings','one'));
 assert.throws(()=>validateSnapshot(snapshot('other',[]),'groww.live_holdings','one'));
 assert.throws(()=>validateSnapshot(snapshot('one',[holding('x',-1,1,1)]),'groww.live_holdings','one'));
 assert.throws(()=>validateSnapshot(snapshot('one',[],{content_hash:null}),'groww.live_holdings','one'));
 assert.throws(()=>validateSnapshot(snapshot('one',[],{captured_at:'2026-01-01T10:00:00'}),'groww.live_holdings','one'));
});
test('invalid newest snapshot falls back; conflict filename is never read',async()=>{
 const files=[{id:'new',name:'20260102T100000Z__aaaaaaaaaaaa.json'},{id:'old',name:'20260101T100000Z__aaaaaaaaaaaa.json'},{id:'conflict',name:'20260103T100000Z__aaaaaaaaaaaa (1).json'}];
 const read=[];let skipped=0;
 const doc=await newestValid(files,async f=>{read.push(f.id);return f.id==='new'?{}:snapshot('one',[]);},'groww.live_holdings','one',()=>skipped++);
 assert.equal(doc.fileId,'old');assert.deepEqual(read,['new','old']);assert.equal(skipped,1);assert.equal(SNAPSHOT.test(files[2].name),false);
});
test('filename and envelope timestamps must agree; auth failures never silently fallback',async()=>{
 const files=[{id:'one',name:'20260102T100000Z__aaaaaaaaaaaa.json'}];
 assert.equal(await newestValid(files,async()=>snapshot('one',[]),'groww.live_holdings','one'),null);
 await assert.rejects(newestValid(files,async()=>{throw Object.assign(new Error('expired'),{authExpired:true});},'groww.live_holdings','one'),/expired/);
});
test('only confirmations of the same account/dataset/hash count',()=>{
 const s=snapshot('one',[]);
 assert.equal(confirmationAt(s,[{dataset:s.dataset,partition:'two',hash,action:'unchanged',at:'2027-01-01T00:00:00Z'},{dataset:s.dataset,partition:'one',hash:'wrong',action:'unchanged',at:'2027-01-01T00:00:00Z'},{dataset:s.dataset,partition:'one',hash,action:'unchanged',at:'2026-01-02T00:00:00Z'}]),'2026-01-02T00:00:00.000Z');
});
