import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreClientId,saveClientId} from '../src/preferences.js';
test('remembers only a valid public client ID and restores it after reload',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 assert.equal(restoreClientId(storage),'');saveClientId('synthetic.apps.googleusercontent.com',storage);
 assert.equal(restoreClientId(storage),'synthetic.apps.googleusercontent.com');assert.equal(values.size,1);
 saveClientId('not-a-client-id',storage);assert.equal(restoreClientId(storage),'synthetic.apps.googleusercontent.com');
 saveClientId('',storage);assert.equal(restoreClientId(storage),'');
});
test('disabled browser storage does not block connecting',()=>{
 const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
 assert.equal(restoreClientId(blocked),'');assert.doesNotThrow(()=>saveClientId('synthetic.apps.googleusercontent.com',blocked));
});
