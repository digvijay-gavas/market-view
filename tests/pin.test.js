import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encryptClientId,decryptClientId} from '../src/pin.js';
const client='synthetic-public.apps.googleusercontent.com';
test('PIN-encrypted client ID round-trips without storing plaintext client ID or a PIN field',async()=>{
 const config=await encryptClientId(client,'001234');assert.equal(await decryptClientId(config,'001234'),client);
 assert.deepEqual(Object.keys(config).sort(),['ciphertext','iterations','iv','salt','version']);assert.equal(JSON.stringify(config).includes(client),false);
 await assert.rejects(decryptClientId(config,'001235'),/PIN could not unlock/);
});
test('random salts and IVs produce different encrypted configurations and reject tampering',async()=>{
 const first=await encryptClientId(client,'5678'),second=await encryptClientId(client,'5678');
 assert.notEqual(first.salt,second.salt);assert.notEqual(first.iv,second.iv);assert.notEqual(first.ciphertext,second.ciphertext);
 await assert.rejects(decryptClientId({...first,ciphertext:(first.ciphertext[0]==='A'?'B':'A')+first.ciphertext.slice(1)},'5678'),/PIN could not unlock/);
});
test('invalid client IDs, unsupported configurations and invalid PINs fail closed',async()=>{
 await assert.rejects(encryptClientId('not-a-client','1234'));await assert.rejects(encryptClientId(client,'123'));
 await assert.rejects(decryptClientId({version:2},'1234'),/PIN could not unlock/);
});
