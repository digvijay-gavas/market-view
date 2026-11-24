import {randomInt} from 'node:crypto';
export const IST_OFFSET=330*60000;
export function ist(now=new Date()){const date=new Date(+now+IST_OFFSET);return {day:date.toISOString().slice(0,10),year:date.getUTCFullYear(),weekday:date.getUTCDay(),minute:date.getUTCHours()*60+date.getUTCMinutes()};}
export function minute(value){if(!/^\d{2}:\d{2}$/.test(value))throw new Error('Invalid market time');const [h,m]=value.split(':').map(Number);if(h>23||m>59)throw new Error('Invalid market time');return h*60+m;}
export function marketOpen(now,calendar,config){
 const t=ist(now);if(!calendar.years.includes(t.year))return {open:false,reason:'CALENDAR_REQUIRED',day:t.day};
 const special=calendar.specialSessions?.[t.day];
 if(!special&&(t.weekday===0||t.weekday===6||calendar.holidays.includes(t.day)))return {open:false,reason:'MARKET_CLOSED',day:t.day};
 const [start,end]=special||[config.open,config.close];
 return {open:t.minute>=minute(start)&&t.minute<minute(end),reason:'MARKET_CLOSED',day:t.day};
}
export function nextDelay(config,random=randomInt){const base=config.intervalSeconds??600,jitter=config.jitterSeconds??60;if(!Number.isInteger(base)||base<300||!Number.isInteger(jitter)||jitter<0||jitter>base/3)throw new Error('Invalid collection interval');return (base+(jitter?random(-jitter,jitter+1):0))*1000;}
export function duePlan(config,state,calendar,now=new Date(),force=false){
 const market=marketOpen(now,calendar,config.schedule);
 if(!config.enabled&&!force)return {due:false,reason:'DISABLED'};
 if(!force&&!market.open)return {due:false,reason:market.reason};
 if(!force&&Date.parse(state.nextRunAt||'')>+now)return {due:false,reason:'NOT_DUE'};
 // 'evening': market-hours runs only refresh prices; positions come from the daily capture.
 const positions=config.positionsCadence==='evening'&&!force?[]:config.accounts.filter(a=>a.enabled!==false&&(config.positionsCadence==='each-run'||state.positions?.[a.id]?.day!==market.day)).map(a=>a.id);
 // With price updates off, an automatic run only exists to collect positions that are still missing today.
 if(!force&&config.pricesEnabled===false&&!positions.length)return {due:false,reason:'POSITIONS_CURRENT'};
 return {due:true,day:market.day,positions};
}

// Daily capture (default 20:00 IST, every day): due from that time until the day's capture has run.
export function dailyDue(config,state,now=new Date()){
 if(!config.enabled)return {due:false,reason:'DISABLED'};
 if(config.schedule?.dailyCapture===false)return {due:false,reason:'DAILY_CAPTURE_OFF'};
 const t=ist(now),at=minute(config.schedule?.dailyCaptureAt||'20:00');
 if(t.minute<at)return {due:false,reason:'NOT_DUE'};
 if(state.dailyCapture?.day===t.day)return {due:false,reason:'DAILY_CAPTURE_DONE'};
 return {due:true,day:t.day};
}
