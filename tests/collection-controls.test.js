import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminService} from '../automation/admin-service.mjs';
import {taskXML} from '../automation/task.mjs';
import {duePlan} from '../automation/schedule.mjs';
const calendar={years:[2026],holidays:[]};
function fixture(enabled=false){
 const calls=[],config={version:1,enabled,rootId:'synthetic',accounts:[{id:'a'}],schedule:{open:'09:15',close:'15:30',intervalSeconds:600,jitterSeconds:60},priceProvider:'groww-public',browserChannel:'chrome'},state={};
 const service=new AdminService('synthetic-home',{readJSON:async path=>path.endsWith('config.json')?config:state,atomicJSON:async(path,value)=>Object.assign(path.endsWith('config.json')?config:state,value),openVault:async()=>({data:{accounts:{},google:{refresh_token:'x'}},save:async()=>{}}),lock:async()=>async()=>{},taskInstalled:async()=>true,installTask:async(home,schedule)=>calls.push(['install',{...schedule}]),setTaskEnabled:async on=>calls.push(['enabled',on]),accessToken:async()=>'t',reader:()=>({get:async()=>({mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}})})});
 return {service,config,calls};
}
test('task runs headless and only repeats inside the collection window',()=>{
 const xml=taskXML({user:'u',node:'n',repo:'r',home:'h',date:'2026-11-24',open:'10:00',close:'12:30'});
 assert.match(xml,/<Command>conhost\.exe<\/Command>/);assert.match(xml,/--headless powershell\.exe/);
 assert.match(xml,/<StartBoundary>2026-11-24T10:00:00<\/StartBoundary>/);assert.match(xml,/<Duration>PT150M<\/Duration>/);
 assert.throws(()=>taskXML({user:'u',node:'n',repo:'r',home:'h',open:'12:00',close:'11:00'}),/INVALID_COLLECTION_WINDOW/);
});
test('pause disables the Windows task; start reinstalls it with the window',async()=>{
 const f=fixture();await f.service.startSchedule();await f.service.pause();
 assert.deepEqual(f.calls,[['install',{open:'09:15',close:'15:30',intervalSeconds:600,jitterSeconds:60}],['enabled',false]]);assert.equal(f.config.enabled,false);
});
test('collection settings save window and price toggle, reinstalling the task only while running',async()=>{
 const paused=fixture();await paused.service.saveFrequency({minutes:15,positionsCadence:'daily',open:'10:00',close:'14:00',pricesEnabled:false});
 assert.equal(paused.config.schedule.open,'10:00');assert.equal(paused.config.schedule.close,'14:00');assert.equal(paused.config.pricesEnabled,false);assert.deepEqual(paused.calls,[]);
 await assert.rejects(paused.service.saveFrequency({minutes:15,positionsCadence:'daily',open:'14:00',close:'10:00'}),/INVALID_COLLECTION_WINDOW/);
 const running=fixture(true);await running.service.saveFrequency({minutes:15,positionsCadence:'daily',open:'09:30',close:'15:00'});assert.equal(running.calls[0][0],'install');assert.equal(running.calls[0][1].open,'09:30');
});
test('with prices off, automatic runs happen only while positions are missing today',()=>{
 const now=new Date('2026-11-23T05:00:00Z'),config={enabled:true,pricesEnabled:false,schedule:{open:'09:15',close:'15:30'},accounts:[{id:'a'}]};
 assert.equal(duePlan(config,{},calendar,now).due,true);
 assert.equal(duePlan(config,{positions:{a:{day:'2026-11-23'}}},calendar,now).reason,'POSITIONS_CURRENT');
 assert.equal(duePlan({...config,pricesEnabled:true},{positions:{a:{day:'2026-11-23'}}},calendar,now).due,true);
});
import {dailyDue} from '../automation/schedule.mjs';
test('daily capture: its own task trigger, due once per IST day from its time, holidays included',()=>{
 const xml=taskXML({user:'u',node:'n',repo:'r',home:'h',date:'2026-11-24',daily:'20:00'});
 assert.match(xml,/<StartBoundary>2026-11-24T20:00:00<\/StartBoundary><Enabled>true<\/Enabled><ScheduleByDay><DaysInterval>1/);
 assert.equal((xml.match(/<CalendarTrigger>/g)||[]).length,2);assert.equal((taskXML({user:'u',node:'n',repo:'r',home:'h'}).match(/<CalendarTrigger>/g)||[]).length,1);
 assert.throws(()=>taskXML({user:'u',node:'n',repo:'r',home:'h',daily:'25:00'}));
 const config={enabled:true,schedule:{open:'09:15',close:'15:30'}};
 const sunday8pm=new Date('2026-11-22T14:31:00Z'),sunday7pm=new Date('2026-11-22T13:29:00Z');
 assert.equal(dailyDue(config,{},sunday8pm).due,true,'runs on a non-market day');assert.equal(dailyDue(config,{},sunday7pm).reason,'NOT_DUE');
 assert.equal(dailyDue(config,{dailyCapture:{day:'2026-11-22'}},sunday8pm).reason,'DAILY_CAPTURE_DONE');
 assert.equal(dailyDue({...config,enabled:false},{},sunday8pm).reason,'DISABLED');
 assert.equal(dailyDue({...config,schedule:{...config.schedule,dailyCapture:false}},{},sunday8pm).reason,'DAILY_CAPTURE_OFF');
 assert.equal(dailyDue({...config,schedule:{...config.schedule,dailyCaptureAt:'06:30'}},{},sunday7pm).due,true);
});
test('evening-only positions: market-hours runs fetch prices but never positions',()=>{
 const config={enabled:true,accounts:[{id:'a'}],positionsCadence:'evening',schedule:{open:'09:15',close:'15:30'}};
 const plan=duePlan(config,{},calendar,new Date('2026-11-24T05:00:00Z'));assert.equal(plan.due,true);assert.deepEqual(plan.positions,[]);
 assert.deepEqual(duePlan(config,{},calendar,new Date('2026-11-24T05:00:00Z'),true).positions,['a'],'the daily capture (forced) still collects positions');
});
