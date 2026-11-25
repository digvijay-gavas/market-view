import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PriceLog,appendEntries,istDay,logFileName} from '../src/price-log.js';

function fakeDrive(){
 const files=new Map(),bodies=new Map();let n=0;
 return {files,bodies,writeEnabled:true,
  mvFolder:async()=>({id:'mv'}),
  list:async q=>[...files.values()].filter(f=>q.includes("'"+f.parent+"' in parents")&&q.includes("name = '"+f.name+"'")),
  request:async(url,opts={})=>{
   if(opts.method==='POST'){const meta=JSON.parse(opts.body),id='f'+(++n);files.set(id,{id,name:meta.name,parent:meta.parents[0]});return {id};}
   if(opts.method==='PATCH'){bodies.set(url.split('/files/')[1].split('?')[0],JSON.parse(opts.body));return {};}
   return bodies.get(url.split('/files/')[1].split('?')[0])||null;
  }};
}
test('price log appends entries into one file per writer per IST day',async()=>{
 const drive=fakeDrive(),now=()=>new Date('2026-11-24T20:00:00Z');
 const log=new PriceLog({drive,rootId:'root',device:'abcd1234',now,setTimer:null});
 log.add({at:'x',bySource:{yahoo:3}});await log.flush();log.add({at:'y',bySource:{yahoo:2}});await log.flush();
 const names=[...drive.files.values()].map(f=>f.name).sort();
 assert.deepEqual(names,['_price-log','viewer-2026-11-25-abcd1234.json']);
 const file=[...drive.files.values()].find(f=>f.name.startsWith('viewer'));
 assert.deepEqual(drive.bodies.get(file.id).entries.map(e=>e.at),['x','y']);assert.equal(drive.bodies.get(file.id).day,'2026-11-25');
});
test('read-only logins log nothing; the entry list is capped',async()=>{
 const drive={...fakeDrive(),writeEnabled:false},log=new PriceLog({drive,rootId:'root',device:'abcd1234',setTimer:null});
 log.add({at:'x'});assert.equal(log.pending.length,0);
 const doc=appendEntries(null,Array.from({length:500},(_,i)=>({i})),{kind:'viewer',day:'d'});assert.equal(doc.entries.length,400);assert.equal(doc.entries[0].i,100);
 assert.equal(istDay(new Date('2026-11-24T18:29:00Z')),'2026-11-24');assert.equal(logFileName('collector','2026-11-24'),'collector-2026-11-24.json');
});
