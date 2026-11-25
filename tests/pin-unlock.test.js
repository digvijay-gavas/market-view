import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rememberUnlock,restoreUnlock,touchUnlock,forgetUnlock,UNLOCK_IDLE_MS} from '../src/pin.js';
const mem=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const id='123-abc.apps.googleusercontent.com';
test('a remembered unlock survives reloads until 10 idle minutes pass',()=>{
 const storage=mem(),t=1_000_000;
 assert.equal(rememberUnlock(id,{storage,now:t}),true);
 assert.equal(restoreUnlock({storage,now:t+UNLOCK_IDLE_MS-1}),id);
 assert.equal(touchUnlock({storage,now:t+9*60000}),true);
 assert.equal(restoreUnlock({storage,now:t+18*60000}),id,'activity reset the 10 minutes');
 assert.equal(restoreUnlock({storage,now:t+19*60000+1}),null);
 assert.equal(touchUnlock({storage,now:t+19*60000+2}),false,'expired unlock is not revived');
 assert.equal(storage.m.size,0);
});
test('the PIN is never stored; bad or far-future records are rejected; sign-out forgets',()=>{
 const storage=mem();rememberUnlock(id,{storage,now:0});assert.ok(!storage.m.get('marketView.unlock').includes('pin'));
 storage.setItem('marketView.unlock',JSON.stringify({version:1,clientId:id,until:10*UNLOCK_IDLE_MS}));assert.equal(restoreUnlock({storage,now:0}),null);
 storage.setItem('marketView.unlock','{bad');assert.equal(restoreUnlock({storage,now:0}),null);
 rememberUnlock(id,{storage,now:0});forgetUnlock({storage});assert.equal(restoreUnlock({storage,now:1}),null);
 assert.equal(rememberUnlock('not-a-client',{storage}),false);
});
