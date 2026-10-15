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
 assert.match(build,/\['index.html','SETUP.html','\.nojekyll'\]/);
 assert.doesNotMatch(build,/cp\(root\+'(?:tests|examples)'/);
});
