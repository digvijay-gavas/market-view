import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdminServer} from '../automation/admin.mjs';
test('bridge accepts extension-origin requests only and retains separate admin authentication',async()=>{
 let calls=0;const id='a'.repeat(32),app=createAdminServer({service:{bridge:{call:async()=>{calls++;return {action:'idle'};}}}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 try{
  const headers={'Content-Type':'application/json','X-Market-Extension':id,Origin:'chrome-extension://'+id};
  const rejected=await fetch(app.url+'/bridge/poll',{method:'POST',headers:{...headers,Origin:'https://groww.in'},body:'{}'});assert.equal(rejected.status,403);assert.equal(calls,0);
  assert.equal((await fetch(app.url+'/bridge/poll',{method:'POST',headers:{...headers,'X-Market-Extension':'invalid'},body:'{}'})).status,403);
  const preflight=await fetch(app.url+'/bridge/poll',{method:'OPTIONS',headers:{Origin:'chrome-extension://'+id}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'chrome-extension://'+id);
  const accepted=await fetch(app.url+'/bridge/poll',{method:'POST',headers,body:'{}'});assert.equal(accepted.status,200);assert.equal(calls,1);
  assert.equal((await fetch(app.url+'/api/status',{headers})).status,403);assert.equal((await fetch(app.url+'/bridge/unknown',{method:'POST',headers,body:'{}'})).status,404);
 }finally{await app.close();}
});
