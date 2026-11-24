import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapLimit} from '../src/drive.js';

test('mapLimit keeps input order and never exceeds the limit',async()=>{
 let active=0,peak=0;
 const out=await mapLimit([5,1,4,2,3,0],3,async n=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,n*3));active--;return n*10;});
 assert.deepEqual(out,[50,10,40,20,30,0]);assert.equal(peak,3);
 assert.deepEqual(await mapLimit([],4,async()=>1),[]);
});
test('mapLimit rejects when a call fails',async()=>{
 await assert.rejects(mapLimit([1,2],2,async n=>{if(n===2)throw new Error('boom');return n;}),/boom/);
});
