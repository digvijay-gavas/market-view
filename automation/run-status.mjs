export function runSummary(checkpoint={}){
 const pendingAccounts=(checkpoint.positionAccounts||[]).filter(a=>!['ok','reused'].includes(a.state)).length,failedQuotes=checkpoint.failedQuotes||0;
 return {partial:Boolean(pendingAccounts||failedQuotes||checkpoint.quoteState==='PRICE_FETCH_FAILED'),pendingAccounts,failedQuotes,quoteState:checkpoint.quoteState,cache:checkpoint.cache};
}
