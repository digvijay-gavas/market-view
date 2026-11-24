// Runs in the Groww holdings page itself (MAIN world, document_start) and keeps a copy of the page's
// own holdings response as the page loads it. Nothing is requested or sent: the extension reads this
// copy so a capture never depends on Groww rendering (lazily) every row in a minimised window.
(()=>{
 if(window.__mvHoldingsHook)return;window.__mvHoldingsHook=true;
 const wanted=url=>/\/v2\/api\/stocks\/holdings\/all\b/.test(String(url||''));
 const keep=text=>{
  try{
   const body=JSON.parse(text);if(!Array.isArray(body?.holdings))return;
   // Only what a positions capture needs: identity, quantity, average price (paise), exchange codes.
   const holdings=body.holdings.map(h=>({slug:h.symbolData?.searchId,name:h.symbolData?.companyShortName,isin:h.symbolData?.symbolIsin,nse:h.symbolData?.nseScripCode||null,bse:h.symbolData?.bseScripCode||null,qty:h.holdingQty,avgPaise:h.holdingAvgPrice}));
   window.__mvHoldings={at:Date.now(),holdings};
  }catch{}
 };
 const fetch0=window.fetch;
 window.fetch=function(input,init){
  const p=fetch0.apply(this,arguments);
  if(wanted(input?.url||input))p.then(r=>{if(r.ok)r.clone().text().then(keep).catch(()=>{});}).catch(()=>{});
  return p;
 };
 const open0=XMLHttpRequest.prototype.open;
 XMLHttpRequest.prototype.open=function(method,url){
  if(wanted(url))this.addEventListener('load',()=>{if(this.status===200&&(this.responseType===''||this.responseType==='text'))keep(this.responseText);else if(this.status===200&&this.responseType==='json')keep(JSON.stringify(this.response));});
  return open0.apply(this,arguments);
 };
})();
