import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ScriptRunner,scriptUrl} from '../automation/script-runner.mjs';
import {allowedUrl,pageRunner} from '../extension/script-runner.js';

const runner=()=>{let t=1_000_000;const logs=[];const r=new ScriptRunner('h',{now:()=>t,log:async line=>{logs.push(JSON.parse(line));}});return {r,logs,advance:ms=>{t+=ms;}};};
test('script runner is off by default, switches on for a limited time and logs everything',async()=>{
 const {r,logs,advance}=runner();
 assert.throws(()=>r.submit({account:'a',url:'https://groww.in/',code:'1'},['a']),/SCRIPT_RUNNER_OFF/);
 r.enable(30);const job=r.submit({account:'a',url:'https://groww.in/stocks/user/holdings',code:'return 1+1'},['a']);
 assert.equal(job.state,'queued');assert.ok(logs.some(l=>l.event==='submitted'&&l.code==='return 1+1'&&l.sha256));
 const taken=await r.take('a',10);assert.equal(taken.job.id,job.id);assert.equal(r.get(job.id).state,'running');
 assert.throws(()=>r.complete('b',{id:job.id,ok:true,json:'2'}),/SCRIPT_JOB_UNKNOWN/,'another account cannot answer');
 r.complete('a',{id:job.id,ok:true,json:'2',finalUrl:'https://groww.in/x'});assert.equal(r.get(job.id).json,'2');assert.equal(r.get(job.id).state,'done');
 advance(31*60000);assert.equal(r.enabled,false);assert.deepEqual(await r.take('a',10),{enabled:false});
});
test('only https groww.in / smallcases.groww.in pages and known accounts are accepted',()=>{
 const {r}=runner();r.enable(5);
 for(const url of ['http://groww.in/','https://evil.example/','https://groww.in.evil.example/','https://user@groww.in/','https://groww.in:8443/','javascript:alert(1)'])assert.throws(()=>scriptUrl(url),/SCRIPT_URL/);
 assert.equal(scriptUrl('https://smallcases.groww.in/smallcase/X/stocks'),'https://smallcases.groww.in/smallcase/X/stocks');
 assert.throws(()=>r.submit({account:'zz',url:'https://groww.in/',code:'1'},['a']),/UNKNOWN_ACCOUNT/);
 assert.throws(()=>r.enable(500),/SCRIPT_MINUTES_INVALID/);
 assert.equal(allowedUrl('https://groww.in/x'),true);assert.equal(allowedUrl('https://accounts.google.com/'),false);
});
test('turning the runner off cancels queued scripts',()=>{
 const {r}=runner();r.enable(5);const job=r.submit({account:'a',url:'https://groww.in/',code:'1'},['a']);r.disable();
 assert.equal(r.get(job.id).state,'cancelled');assert.equal(r.status().enabled,false);
});
test('page runner returns JSON results and errors',async()=>{
 globalThis.location={href:'https://groww.in/x'};
 assert.deepEqual(await pageRunner('return {a:1}'),{ok:true,json:'{"a":1}',finalUrl:'https://groww.in/x'});
 assert.equal((await pageRunner('await null; return [1,2]')).json,'[1,2]');
 const bad=await pageRunner('throw new Error("nope")');assert.equal(bad.ok,false);assert.match(bad.error,/nope/);
 delete globalThis.location;
});
