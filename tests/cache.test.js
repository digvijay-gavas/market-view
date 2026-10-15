import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortfolioCache,fileRevision,samePortfolio} from '../src/cache.js';
test('missing or blocked IndexedDB falls back to Drive without throwing',async()=>{
 for(const indexedDB of [undefined,{open(){throw new Error('blocked');}}]){
  const cache=new PortfolioCache('synthetic',Date.now()+3600000,{indexedDB});
  assert.equal(await cache.get('portfolio:one'),null);assert.equal(await cache.set('file:one','value'),null);assert.equal(cache.disabled,true);await cache.clear();
 }
});
test('expired cache cannot be read or written',async()=>{
 const cache=new PortfolioCache('synthetic',0,{indexedDB:{open(){throw new Error('must not open');}}});
 assert.equal(await cache.get('one'),null);assert.equal(await cache.set('one','value'),null);
});
test('Drive revisions prefer server version and never trust filenames alone',()=>{
 assert.equal(fileRevision({version:'2',md5Checksum:'abc'}),'version:2');assert.equal(fileRevision({md5Checksum:'abc'}),'md5:abc');
 assert.equal(fileRevision({modifiedTime:'today',size:'42'}),'modified:today:42');assert.equal(fileRevision({name:'same.json'}),null);
});

test('unchanged portfolios skip rebuilding totals; changed captures or warnings invalidate them',()=>{
 const original={root:{id:'root'},snapshots:[{value:1}],dividends:[],warnings:[],loadedAt:'before'};
 assert.equal(samePortfolio(original,{...original,loadedAt:'after'}),true);
 assert.equal(samePortfolio(original,{...original,snapshots:[{value:2}]}),false);
 assert.equal(samePortfolio(original,{...original,warnings:['stale']}),false);
});
