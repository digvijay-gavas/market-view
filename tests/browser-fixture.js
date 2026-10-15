// Browser-only synthetic fixture, served exclusively by scripts/fixture-server.mjs.
// No production data or Google requests. Deliberately not a node test file.
window.google={accounts:{oauth2:{initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'synthetic-ui-token',expires_in:3600})}),hasGrantedAllScopes:()=>true}}};
const folder=(id,name)=>({id,name,mimeType:'application/vnd.google-apps.folder'});
const file=(id,name)=>({id,name,mimeType:'application/json',version:'1'});
const hash='sha256:'+'a'.repeat(64);
const snap=(partition,holdings)=>({store_version:1,schema_version:1,dataset:'groww.live_holdings',partition,source:'groww',method:'manual',captured_at:'2026-01-01T10:00:00Z',as_of:'2026-01-01',content_hash:hash,meta:{synthetic:true},tables:{holdings}});
const holding=(slug,name,qty,invested,current_value)=>({groww_slug:slug,name,qty,invested,current_value});
const children={
 'synthetic-root':[folder('schema','_schema'),folder('holdings','groww.live_holdings')],
 schema:[file('catalog','catalog.json')],holdings:[folder('account-one','example_one'),folder('account-two','example_two')],
 'account-one':[file('snapshot-one','20260101T100000Z__aaaaaaaaaaaa.json')],
 'account-two':[file('snapshot-two','20260101T100000Z__aaaaaaaaaaaa.json')]
};
const docs={
 catalog:{store_version:1,datasets:{'groww.live_holdings':{version:1,semantics:'latest',max_age_hours:24}}},
 'snapshot-one':snap('example_one',[holding('synthetic-alpha','SYNTHETIC Alpha',10,1000,1200),holding('synthetic-beta','SYNTHETIC Beta',5,1000,800)]),
 'snapshot-two':snap('example_two',[holding('synthetic-alpha','SYNTHETIC Alpha',5,500,600)])
};
// Explicit dense fixture for viewport/stock-list tests; still entirely invented.
if(window.location?.search?.includes('dense=1')){
 for(let i=0;i<38;i++)docs['snapshot-one'].tables.holdings.push(holding('synthetic-extra-'+i,'SYNTHETIC Holding '+(i+1),1,100,105));
 for(const [index,name]of ['example_three','example_four','example_five'].entries()){
  const id='dense-account-'+index,fileId='dense-snapshot-'+index;
  children.holdings.push(folder(id,name));children[id]=[file(fileId,'20260101T100000Z__aaaaaaaaaaaa.json')];docs[fileId]=snap(name,[]);
 }
}
if(window.location?.search?.includes('revision=2')){children['account-one'][0].version='2';docs['snapshot-one'].tables.holdings[0].current_value=1400;}
if(window.location?.search?.includes('cash=1'))docs['snapshot-one'].tables.holdings.push(holding('zerodha-nifty-d-rate-liquid-etf','LIQUIDCASE',10,990,1000));
if(window.location?.search?.includes('xirr=1')){
 children['synthetic-root'].push(folder('pnl','groww.pnl_report'));children.pnl=[];
 docs.catalog.datasets['groww.pnl_report']={version:1,semantics:'cumulative'};
 for(const [index,partition]of ['example_one','example_two'].entries()){
  const accountId='pnl-account-'+index,id='pnl-report-'+index;
  children.pnl.push(folder(accountId,partition));children[accountId]=[file(id,'20260101T100000Z__aaaaaaaaaaaa.json')];
  docs[id]={...snap(partition,[]),dataset:'groww.pnl_report',tables:{open_lots:docs['snapshot-'+(index===0?'one':'two')].tables.holdings.map((r,i)=>({stock_name:r.name,isin:'SYNTHETIC'+i,quantity:r.qty,buy_value:r.invested,buy_date:'2025-01-01'}))}};
 }
}
let mediaDownloads=0;
window.fetch=async function(input,options){
 if(this!==window)throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
 const url=new URL(input);
 if(window.location?.search?.includes('offline=1'))throw new TypeError('Synthetic offline');
 if(window.location?.search?.includes('denied=1'))return new Response('',{status:403});
 if(url.origin!=='https://www.googleapis.com'||options.headers.Authorization!=='Bearer synthetic-ui-token')throw new Error('Unexpected test request');
 if(url.pathname==='/drive/v3/files') {
  if(url.searchParams.get('q').includes("name = 'market-data'"))return Response.json({files:window.location?.search?.includes('folders=multiple')?[folder('synthetic-root','market-data'),folder('synthetic-second','market-data')]:[folder('synthetic-root','market-data')]});
  const ids=[...url.searchParams.get('q').matchAll(/'([^']+)' in parents/g)].map(x=>x[1]);
  return Response.json({files:ids.flatMap(id=>children[id]||[])});
 }
 const id=decodeURIComponent(url.pathname.split('/').at(-1));
 if(id==='synthetic-root')return Response.json(folder(id,'SYNTHETIC portfolio'));
 if(docs[id]){mediaDownloads++;if(typeof document!=='undefined')document.querySelector('[role=note]').textContent='SYNTHETIC TEST FIXTURE — invented data, fake authorization, no Google requests. File downloads: '+mediaDownloads;return Response.json(docs[id]);}
 return new Response('',{status:404});
};
