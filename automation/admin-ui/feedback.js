export const stamp=value=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST':'Not yet';
export function reconciliationFeedback(account,connected,describe=code=>code){
 const op=account.reconciliation;
 if(!account.extensionPaired)return {phase:'idle',message:'Pair this account’s extension to reconcile positions.'};
 if(op?.phase==='queued')return {phase:'busy',label:'Waiting for Chrome…',message:'Request sent. Keep this account’s Chrome profile open; the next check is usually within a minute.'};
 if(op?.phase==='running')return {phase:'busy',label:'Reconciling…',message:'Reading holdings from Groww…'};
 if(op?.phase==='captured')return connected&&op.publishState==='pending'?{phase:'busy',label:'Syncing…',message:'Holdings received. Updating Drive and the shared cache…'}:{phase:'waiting',message:connected?'Positions captured locally; waiting for Drive and cache sync.':'Positions captured locally. Connect Google Drive to finish syncing.'};
 if(op?.phase==='succeeded')return {phase:'succeeded',message:'Succeeded · '+op.positions+' position'+(op.positions===1?'':'s')+' · '+stamp(op.capturedAt)};
 if(op?.phase==='failed')return {phase:'failed',message:op.errorStage==='publish'?'Positions captured; Drive/cache sync failed. Use Fetch now to retry.':describe(op.error)};
 if(account.extensionError)return {phase:'failed',message:'Last attempt failed · '+describe(account.extensionError)};
 return {phase:'idle',message:account.lastPosition?'Last reconciled · '+stamp(account.lastPosition):account.extensionCapturedAt?'Captured · '+stamp(account.extensionCapturedAt):'Ready to reconcile positions.'};
}
export function fetchFeedback(state,describe=code=>code){
 const job=state?.job;if(job?.type==='fetch'){
  if(['running','signin','confirm'].includes(job.phase))return {phase:'busy',label:'Fetching…',message:'Updating available positions, prices and the shared cache…'};
  if(job.phase==='failed')return {phase:'failed',message:'Fetch failed · '+describe(job.error)};
  if(job.phase==='partial'){const r=job.result||{},notes=[];if(r.pendingAccounts)notes.push(r.pendingAccounts+' account(s) awaiting reconciliation');if(r.failedQuotes||r.quoteState==='PRICE_FETCH_FAILED')notes.push('some prices remain dated');return {phase:'waiting',message:'Partly updated · '+notes.join(' · ')};}
  if(job.phase==='complete')return {phase:'succeeded',message:'Succeeded · prices and shared cache updated.'};
 }
 if(state?.lastError)return {phase:'failed',message:'Last run failed · '+describe(state.lastError)};
 if(state?.lastRunSummary?.partial)return {phase:'waiting',message:'Last run partly updated · '+stamp(state.lastRunAt)};
 return {phase:'idle',message:state?.lastRunAt?(state.lastRunSummary?'Last succeeded · ':'Last completed · ')+stamp(state.lastRunAt):'Updates prices and the shared cache using saved positions.'};
}
