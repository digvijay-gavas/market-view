import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DriveReader} from '../src/drive.js';
import {buildPortfolio} from '../src/model.js';
test('full Drive store traversal produces correct totals and stale-data warnings from synthetic files',async()=>{
 const context={window:{},URL,Response};vm.runInNewContext(await readFile(new URL('./browser-fixture.js',import.meta.url),'utf8'),context);
 const d=new DriveReader('synthetic-ui-token',{fetcher:(...args)=>context.window.fetch(...args)});
 const store=await d.load('synthetic-root');
 const p=buildPortfolio(store.snapshots,store.dividends);
 assert.equal(p.value,2600);assert.equal(p.cost,2500);assert.equal(p.pnl,100);assert.equal(p.positions.length,2);assert.equal(p.accounts.length,2);
 assert.equal(p.positions[0].quantity,15);assert.equal(p.dividends,null);assert.equal(store.warnings.length,2);
});
test('production build allowlist excludes synthetic browser fixture and all example data',async()=>{
 const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');
 assert.match(build,/\['index.html','SETUP.html','privacy.html','terms.html','\.nojekyll'\]/);
 assert.doesNotMatch(build,/cp\(root\+'(?:tests|examples)'/);
});

test('repeat store checks reuse unchanged bodies and reflect modified and deleted captures',async()=>{
 const context={window:{},URL,Response};vm.runInNewContext(await readFile(new URL('./browser-fixture.js',import.meta.url),'utf8'),context);
 const records=new Map();const cache={get:async k=>records.get(k),set:async(k,v)=>records.set(k,structuredClone(v))};let downloads=0;
 const fetcher=(url,options)=>{if(url.searchParams.get('alt')==='media')downloads++;return context.window.fetch(url,options);};
 const reader=new DriveReader('synthetic-ui-token',{fetcher,cache});
 assert.equal(buildPortfolio((await reader.load('synthetic-root')).snapshots,[]).value,2600);assert.equal(downloads,3);
 await reader.load('synthetic-root');assert.equal(downloads,3,'unchanged metadata must produce zero body downloads');
 vm.runInNewContext("children['account-one'][0].version='2';docs['snapshot-one'].tables.holdings[0].current_value=1400",context);
 assert.equal(buildPortfolio((await reader.load('synthetic-root')).snapshots,[]).value,2800);assert.equal(downloads,4,'only changed capture downloads');
 vm.runInNewContext("children.holdings=children.holdings.filter(row=>row.id!=='account-two')",context);
 const after=await reader.load('synthetic-root');assert.equal(buildPortfolio(after.snapshots,[]).value,2200);assert.equal(after.snapshots.length,1);assert.equal(downloads,4);
});

test('Drive traversal reads P&L purchase lots and exposes a reconciled annualised return',async()=>{
 const context={window:{location:{search:'?xirr=1'}},URL,Response};vm.runInNewContext(await readFile(new URL('./browser-fixture.js',import.meta.url),'utf8'),context);
 const reader=new DriveReader('synthetic-ui-token',{fetcher:(...args)=>context.window.fetch(...args)});
 const store=await reader.load('synthetic-root');assert.equal(store.reports.length,2);
 const p=buildPortfolio(store.snapshots,store.dividends,'',store.reports);assert.ok(Math.abs(p.xirr-4)<1e-8);
 assert.ok(Math.abs(buildPortfolio(store.snapshots,store.dividends,'example_two',store.reports).xirr-20)<1e-8);
});

test('Drive loads canonical lowercase BM partition with uppercase source ID, reports monotonic progress, and falls back from malformed newest',async()=>{
 const context={window:{location:{search:'?bm=1'}},URL,Response};vm.runInNewContext(await readFile(new URL('./browser-fixture.js',import.meta.url),'utf8'),context);
 vm.runInNewContext("children['bm-partition'].push(file('bm-bad','20260102T100000Z__aaaaaaaaaaaa.json'));docs['bm-bad']={}",context);
 const progress=[];const reader=new DriveReader('synthetic-ui-token',{fetcher:(...args)=>context.window.fetch(...args)});
 const store=await reader.load('synthetic-root',(message,value)=>progress.push(value));
 assert.equal(store.smallcases.length,1);assert.equal(store.smallcases[0].partition,'bamimo_0002');
 const p=buildPortfolio(store.snapshots,[], '',[],store.smallcases);assert.equal(p.positions[0].bmTarget,40);
 assert.ok(Math.abs(p.positions[0].bmWeight-1800/2600*100)<1e-10);
 assert.ok(progress.every((v,i)=>Number.isFinite(v)&&v>=0&&v<=100&&(!i||v>=progress[i-1])));
 assert.ok(store.warnings.some(w=>w.includes('Skipped')));
});

test('historical BM snapshots identify held removals and missing members without changing totals',async()=>{
 const context={window:{location:{search:'?bm=1&history=1'}},URL,Response,structuredClone};vm.runInNewContext(await readFile(new URL('./browser-fixture.js',import.meta.url),'utf8'),context);
 const reader=new DriveReader('synthetic-ui-token',{fetcher:(...args)=>context.window.fetch(...args)});const store=await reader.load('synthetic-root');assert.equal(store.smallcases.length,2);
 const p=buildPortfolio(store.snapshots,[],'',[],store.smallcases);assert.equal(p.value,2600);assert.equal(p.positions.length,2);
 assert.equal(p.positions.find(r=>r.key==='synthetic-beta').bmState,'removed');assert.equal(p.bm.pending[0].name,'SYNTHETIC New Member');assert.equal(p.bm.pending[0].bmTarget,30);
});

test('snapshot manifest checks only metadata, ignores cache/log writes, and detects source changes',async()=>{
 const context={window:{},URL,Response};vm.runInNewContext(await readFile(new URL('./browser-fixture.js',import.meta.url),'utf8'),context);
 let downloads=0;const reader=new DriveReader('synthetic-ui-token',{fetcher:(url,o)=>{if(url.searchParams.get('alt')==='media')downloads++;return context.window.fetch(url,o);}});
 const first=await reader.snapshotSignature('synthetic-root');assert.match(first,/^sha256:[0-9a-f]{64}$/);assert.equal(downloads,0);
 vm.runInNewContext("children['synthetic-root'].push(file('shared-cache','_market-view-dashboard-cache.json'));children['synthetic-root'].push(folder('log','_log'));children.log=[file('confirmations','writer.jsonl')]",context);
 assert.equal(await reader.snapshotSignature('synthetic-root'),first,'confirmation and derived cache writes cannot trigger recalculation');
 vm.runInNewContext("children['account-one'][0].version='2'",context);
 const revised=await reader.snapshotSignature('synthetic-root');assert.notEqual(revised,first);
 vm.runInNewContext("children['account-one'].push(file('new','20260102T100000Z__bbbbbbbbbbbb.json'))",context);
 assert.notEqual(await reader.snapshotSignature('synthetic-root'),revised);assert.equal(downloads,0);
});
test('unversioned source metadata never falsely claims cached snapshot calculations are current',async()=>{
 const context={window:{},URL,Response};vm.runInNewContext(await readFile(new URL('./browser-fixture.js',import.meta.url),'utf8'),context);
 vm.runInNewContext("delete children['account-one'][0].version",context);
 const reader=new DriveReader('synthetic-ui-token',{fetcher:(...args)=>context.window.fetch(...args)});
 assert.equal(await reader.snapshotSignature('synthetic-root'),null);
});
