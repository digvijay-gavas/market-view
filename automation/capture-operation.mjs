import {randomUUID} from 'node:crypto';
export function queuedCapture(now){return {id:randomUUID(),phase:'queued',requestedAt:now.toISOString(),deadlineAt:new Date(+now+300000).toISOString()};}
export function captureOperation(ext,now=new Date()){
 const op=ext?.operation;if(!op)return null;const fields=['id','phase','requestedAt','startedAt','completedAt','deadlineAt','capturedAt','positions','error','errorStage','publishState'];
 const result=Object.fromEntries(fields.filter(k=>op[k]!==undefined).map(k=>[k,op[k]]));
 if(['queued','running'].includes(op.phase)&&Date.parse(op.deadlineAt)<+now){result.phase='failed';result.error=op.phase==='queued'?'EXTENSION_OFFLINE':'CAPTURE_TIMED_OUT';result.errorStage='capture';}
 if(op.phase==='captured'&&op.publishState==='pending'&&Date.parse(op.deadlineAt)<+now){result.phase='failed';result.error='DRIVE_SYNC_TIMED_OUT';result.errorStage='publish';}
 return result;
}
