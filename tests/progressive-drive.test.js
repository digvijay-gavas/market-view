import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DriveReader} from '../src/drive.js';
import {buildPortfolio} from '../src/model.js';
import {makeDriveCache,readDriveCache} from '../src/drive-cache.js';
test('Drive traversal materializes progressive and legacy accounts, and shared cache retains provenance',async()=>{
 const context={window:{},URL,Response};vm.runInNewContext(await readFile(new URL('./browser-fixture.js',import.meta.url),'utf8'),context);
 vm.runInNewContext(`
 children['synthetic-root'].push(folder('positions','portfolio.positions'),folder('prices','market.prices'));
 children.positions=[folder('position-a','example_one')];children.prices=[folder('quote-shared','shared')];
 children['position-a']=[file('position','20260102T100000Z__aaaaaaaaaaaa.json')];children['quote-shared']=[file('quote','20260102T101000Z__aaaaaaaaaaaa.json')];
 docs.catalog.datasets['portfolio.positions']={version:1,semantics:'latest'};docs.catalog.datasets['market.prices']={version:1,semantics:'latest'};
 docs.position={...snap('example_one',[]),dataset:'portfolio.positions',captured_at:'2026-01-02T10:00:00Z',as_of:'2026-01-02',tables:{positions:[{groww_slug:'synthetic-alpha',name:'SYNTHETIC Alpha',qty:20,invested:1000,reference_price:120,reference_value:2400}]}};
 docs.quote={...snap('shared',[]),dataset:'market.prices',captured_at:'2026-01-02T10:10:00Z',as_of:'2026-01-02',tables:{quotes:[{groww_slug:'synthetic-alpha',ltp:200,fetched_at:'2026-01-02T10:10:00Z',source:'synthetic'}]}};
 `,context);
 const reader=new DriveReader('synthetic-ui-token',{fetcher:(...args)=>context.window.fetch(...args)});const store=await reader.load('synthetic-root');
 const view=buildPortfolio(store.snapshots);assert.equal(view.value,5000);assert.equal(view.cost,1500);assert.equal(store.progressiveSources.length,2);assert.equal(store.snapshots[0].meta.progressive,true);
 store.sourceSignature=await reader.snapshotSignature('synthetic-root');const cache=makeDriveCache(store,new Map([['null',view]]));const restored=readDriveCache(cache,'synthetic-root');assert.ok(restored);assert.equal(restored.store.progressiveSources[0].positionsAt,'2026-01-02T10:00:00Z');assert.equal(restored.store.snapshots[0].meta.positions_captured_at,'2026-01-02T10:00:00Z');
});
