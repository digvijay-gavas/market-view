// Only the collector's loopback runner page receives this content script.
const ticket=location.hash.slice(1);
if((/^[a-f0-9]{48}$/).test(ticket)){
 history.replaceState(null,'',location.pathname);
 chrome.runtime.sendMessage({action:'managed',ticket}).then(result=>{
  if(!result?.ok)document.getElementById('status').textContent='Collection needs attention ('+(result?.error||'EXTENSION_WORKER_NOT_RELOADED')+'). Reload Market Family Collector once in chrome://extensions, then retry from Collector Admin.';
 }).catch(()=>{});
}
