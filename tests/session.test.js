import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreSession,saveSession,clearSession} from '../src/session.js';
const client='synthetic.apps.googleusercontent.com',now=Date.UTC(2026,0,1);
const record={clientId:client,accessToken:'synthetic-token-not-real',expiresAt:now+3600000,rootId:'synthetic-root'};
function memory(){const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
test('refresh restores the unexpired tab session and verified folder',()=>{
 const storage=memory();assert.equal(saveSession(record,{storage,now}),true);
 const restored=restoreSession(client,{storage,now:now+60000});
 assert.equal(restored.accessToken,record.accessToken);assert.equal(restored.rootId,'synthetic-root');assert.equal(restored.expiresAt,record.expiresAt);
});
test('session save is an allowlist and never stores portfolio or refresh tokens',()=>{
 const storage=memory();saveSession({...record,portfolio:[{private:'synthetic'}],refreshToken:'synthetic-refresh'},{storage,now});
 const saved=JSON.parse([...storage.values.values()][0]);
 assert.deepEqual(Object.keys(saved).sort(),['accessToken','clientId','expiresAt','rootId','version']);
});
test('expired and nearly expired sessions are removed instead of restored',()=>{
 for(const time of [now+3600000,now+3595000]){const storage=memory();saveSession(record,{storage,now});assert.equal(restoreSession(client,{storage,now:time}),null);assert.equal(storage.values.size,0);}
});
test('changing client ID or clearing the session prevents previous-account restoration',()=>{
 const storage=memory();saveSession(record,{storage,now});assert.equal(restoreSession('other.apps.googleusercontent.com',{storage,now}),null);assert.equal(storage.values.size,0);
 saveSession(record,{storage,now});clearSession(storage);assert.equal(restoreSession(client,{storage,now}),null);
});
test('malformed session, invalid folder and implausible expiry fail closed',()=>{
 const storage=memory();storage.setItem('marketView.driveSession','broken JSON');assert.equal(restoreSession(client,{storage,now}),null);
 for(const change of [{rootId:'https://example.com'},{expiresAt:now+2*86400000},{accessToken:''}])assert.equal(saveSession({...record,...change},{storage,now}),false);
});
test('blocked tab storage preserves the current-page fallback without throwing',()=>{
 const storage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
 assert.equal(saveSession(record,{storage,now}),false);assert.equal(restoreSession(client,{storage,now}),null);assert.doesNotThrow(()=>clearSession(storage));
});
