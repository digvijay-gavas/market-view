export const REFRESH_INTERVAL=4*60*60*1000;
export class RefreshSchedule {
 constructor({refresh,enabled=()=>true,now=Date.now,setTimer=globalThis.setTimeout.bind(globalThis),clearTimer=globalThis.clearTimeout.bind(globalThis),retryDelay=5*60*1000}){Object.assign(this,{refresh,enabled,now,setTimer,clearTimer,retryDelay});this.active=false;this.running=false;this.lastSuccess=0;}
 arm(delay){this.clearTimer(this.timer);if(this.active)this.timer=this.setTimer(()=>this.check(),Math.max(0,delay));}
 succeeded(at=this.now()){this.active=true;this.lastSuccess=at;this.arm(this.lastSuccess+REFRESH_INTERVAL-this.now());}
 stop(){this.active=false;this.clearTimer(this.timer);}
 async check(){
  if(!this.active||this.running)return;
  const remaining=this.lastSuccess+REFRESH_INTERVAL-this.now();
  if(remaining>0){this.arm(remaining);return;}
  if(!this.enabled()){this.arm(this.retryDelay);return;}
  this.running=true;let success=false;
  try{success=await this.refresh();if(success&&this.active)this.lastSuccess=this.now();}catch{/* Retry without advancing the last successful refresh. */}
  finally{this.running=false;if(this.active)this.arm(success?REFRESH_INTERVAL:this.retryDelay);}
 }
}
