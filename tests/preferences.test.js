import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreClientId,saveClientId,restoreSelection,saveSelection} from '../src/preferences.js';
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

test('arbitrary account combinations persist per client and folder, including all and none',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 saveSelection('client','root',['two','one','two'],storage);assert.deepEqual(restoreSelection('client','root',storage),['one','two']);
 assert.equal(restoreSelection('client','other',storage),null);assert.equal(restoreSelection('other','root',storage),null);
 saveSelection('client','root',[],storage);assert.deepEqual(restoreSelection('client','root',storage),[]);
 saveSelection('client','root',null,storage);assert.equal(restoreSelection('client','root',storage),null);
});
test('malformed or blocked selection storage falls back safely',()=>{
 assert.equal(restoreSelection('a','b',{getItem:()=>'{bad'}),null);
 assert.equal(saveSelection('a','b',['one'],{setItem(){throw new Error('blocked');}}),false);
});
