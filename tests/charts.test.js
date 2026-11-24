import {test} from 'node:test';
import assert from 'node:assert/strict';
import {raceScale,raceProgress,shortAgo,accountColors,donutSlices,ACCOUNT_COLORS,OTHER_COLOR} from '../src/charts.js';

test('race scale picks seconds, minutes, hours or days from the oldest update',()=>{
 assert.equal(raceScale(40000).unit,'s');assert.equal(raceScale(25*60000).unit,'m');
 assert.equal(raceScale(5*3600000).unit,'h');assert.equal(raceScale(3*86400000).unit,'d');
 const s=raceScale(5*3600000);assert.equal(s.max,6);assert.deepEqual(s.ticks,[6,4,2,0]);assert.ok(s.ticks.length<=5);
 assert.equal(raceProgress(0,s),1);assert.equal(raceProgress(3*3600000,s),.5);assert.equal(raceProgress(99*3600000,s),0);
});
test('short ago labels',()=>{assert.equal(shortAgo(5000),'5s ago');assert.equal(shortAgo(150000),'2m ago');assert.equal(shortAgo(7200000),'2h ago');assert.equal(shortAgo(3*86400000),'3d ago');});
test('account colours follow the name, not the order shown',()=>{
 const a=accountColors(['teju','anna','bunny']);assert.equal(a.get('anna'),ACCOUNT_COLORS[0]);assert.equal(a.get('teju'),ACCOUNT_COLORS[2]);
 assert.equal(accountColors(['g','f','e','d','c','b','a']).get('g'),OTHER_COLOR);
});
test('donut slices cover shares and handle a single full slice',()=>{
 const s=donutSlices([3,1,0]);assert.equal(s.length,3);assert.equal(s[0].share,.75);assert.equal(s[2].d,'');assert.match(s[0].d,/^M .* A 80 80 0 1 1 /);
 assert.equal(donutSlices([5])[0].share,1);assert.deepEqual(donutSlices([0,0]),[]);
});
