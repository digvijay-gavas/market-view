import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RefreshSchedule,REFRESH_INTERVAL} from '../src/refresh.js';
function setup(refresh=async()=>true){let time=1000,delay=null,enabled=true,calls=0;const clock=new RefreshSchedule({refresh:async()=>{calls++;return refresh();},enabled:()=>enabled,now:()=>time,setTimer:(f,ms)=>{delay=ms;return 1;},clearTimer:()=>{}});return {clock,advance:ms=>{time+=ms;},disable:()=>{enabled=false;},enable:()=>{enabled=true;},get calls(){return calls;},get delay(){return delay;}};}
test('refresh occurs at four hours, never early, and resets after success',async()=>{
 const run=setup();run.clock.succeeded(1000);assert.equal(run.delay,REFRESH_INTERVAL);
 run.advance(REFRESH_INTERVAL-1);await run.clock.check();assert.equal(run.calls,0);assert.equal(run.delay,1);
 run.advance(1);await run.clock.check();assert.equal(run.calls,1);assert.equal(run.delay,REFRESH_INTERVAL);
});
test('overdue wake-up refreshes immediately; repeated events never overlap a request',async()=>{
 let finish;const run=setup(()=>new Promise(resolve=>{finish=resolve;}));run.clock.succeeded(1000);run.advance(REFRESH_INTERVAL*2);
 const first=run.clock.check();await run.clock.check();assert.equal(run.calls,1);finish(true);await first;assert.equal(run.delay,REFRESH_INTERVAL);
});
test('offline or busy checks keep the old success time and catch up immediately when enabled',async()=>{
 const run=setup();run.clock.succeeded(1000);run.advance(REFRESH_INTERVAL);run.disable();await run.clock.check();assert.equal(run.calls,0);assert.equal(run.clock.lastSuccess,1000);
 run.enable();await run.clock.check();assert.equal(run.calls,1);
});
test('failures retry without marking stale data fresh, and stop cancels future refreshes',async()=>{
 const run=setup(async()=>false);run.clock.succeeded(1000);run.advance(REFRESH_INTERVAL);await run.clock.check();assert.equal(run.clock.lastSuccess,1000);assert.equal(run.delay,300000);
 run.clock.stop();await run.clock.check();assert.equal(run.calls,1);
});

test('browser timer callbacks preserve the native global receiver',()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 globalThis.setTimeout=function(callback,delay){assert.equal(this,globalThis);assert.ok(delay>=0);return 123;};
 globalThis.clearTimeout=function(){assert.equal(this,globalThis);};
 try{const schedule=new RefreshSchedule({refresh:async()=>true});schedule.succeeded();schedule.stop();}finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
