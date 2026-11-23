import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RefreshSchedule,REFRESH_INTERVAL} from '../src/refresh.js';
test('progressive stores check at their shorter cadence and retain the legacy interval when absent',async()=>{
 let now=1000,progressive=true,delay,calls=0;
 const s=new RefreshSchedule({refresh:async()=>{calls++;return true;},interval:()=>progressive?300000:REFRESH_INTERVAL,now:()=>now,setTimer:(f,ms)=>{delay=ms;},clearTimer:()=>{}});
 s.succeeded();assert.equal(delay,300000);now+=299999;await s.check();assert.equal(calls,0);now++;await s.check();assert.equal(calls,1);progressive=false;s.succeeded();assert.equal(delay,REFRESH_INTERVAL);
});
