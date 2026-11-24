import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {parsePnlReport,toDate} from '../automation/pnl-report.mjs';
import {plannedExtras,acceptExtras,publishExtras,readPnlDownload} from '../automation/extras.mjs';
import {weightsFromPage,rebalanceDate,validateMv,lotsAsReport,weightsAsSmallcase} from '../src/mv-data.js';

// Tiny XLSX writer for tests: inline-string and number cells, deflated parts.
function xlsx(sheets){
 const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
 const col=i=>String.fromCharCode(65+i);
 const parts={'[Content_Types].xml':'<Types/>','xl/workbook.xml':'<workbook><sheets>'+Object.keys(sheets).map((n,i)=>`<sheet name="${esc(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships>'+Object.keys(sheets).map((n,i)=>`<Relationship Id="rId${i+1}" Target="worksheets/sheet${i+1}.xml"/>`).join('')+'</Relationships>'};
 Object.values(sheets).forEach((rows,i)=>{parts[`xl/worksheets/sheet${i+1}.xml`]='<worksheet><sheetData>'+rows.map((r,y)=>`<row r="${y+1}">`+r.map((v,x)=>v==null?'':typeof v==='number'?`<c r="${col(x)}${y+1}"><v>${v}</v></c>`:`<c r="${col(x)}${y+1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>';});
 const local=[],central=[];let offset=0;
 for(const [name,text] of Object.entries(parts)){
  const raw=Buffer.from(text),data=deflateRawSync(raw),nameBuf=Buffer.from(name);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(8,8);h.writeUInt32LE(data.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(nameBuf.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(8,10);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(nameBuf.length,28);c.writeUInt32LE(offset,42);
  local.push(h,nameBuf,data);central.push(c,nameBuf);offset+=30+nameBuf.length+data.length;
 }
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,cd,end]);
}
const trade=[['Name','Synthetic Person'],['Unique Client Code',1234567890],['P&L Statement for stocks from 01-04-2026 TO 20-11-2026'],[],
 ['Realised trades'],[],['Stock name','ISIN','Quantity','Buy date','Buy price','Buy value','Sell date','Sell price','Sell value','Realised P&L','Remark'],[],
 ['SYNTHETIC ONE','INE000000001',1,'01-05-2026',10,10,'01-06-2026',12,12,2,''],[],
 ['Unrealised trades'],[],['Stock name','ISIN','Quantity','Buy date','Buy price','Buy value','Closing date','Closing price','Closing value','Unrealised P&L','Remark'],[],
 ['SYNTHETIC TWO','INE000000002',5,'15-07-2021',100,500,'20-11-2026',120,600,100,''],['SYNTHETIC TWO','INE000000002',2,46000,110,220,'20-11-2026',120,240,20,'']];
const scrip=[['Unrealised (Holdings as on 20-11-2026)'],['Stock name','ISIN','Quantity','Avg buy price','Buy value','Closing price','Closing value','Unrealised P&L','Unrealised P&L %'],[],['SYNTHETIC TWO','INE000000002',7,102.86,720,120,840,120,0.1667]];

test('P&L export parses lots under headers with a blank spacer row, serial and text dates',()=>{
 const r=parsePnlReport(xlsx({'Trade Level':trade,'Scrip Level':scrip}));
 assert.equal(r.asOf,'2026-11-20');assert.deepEqual(r.meta,{client_code:'1234567890',account_name:'Synthetic Person',period_start:'2026-04-01',period_end:'2026-11-20'});
 assert.equal(r.tables.open_lots.length,2);assert.equal(r.tables.open_lots[0].buy_date,'2021-07-15');assert.equal(r.tables.open_lots[1].buy_date,toDate(46000));
 assert.equal(r.tables.realised.length,1);assert.equal(r.tables.scrip_holdings[0].quantity,7);assert.ok(Math.abs(r.tables.scrip_holdings[0].unrealised_pnl_pct-16.67)<1e-9);
 assert.throws(()=>parsePnlReport(xlsx({Summary:[['x']]})),/PNL_REPORT_UNRECOGNISED/);
});
test('BM page becomes bm.weights; weights must add up to 100',()=>{
 assert.equal(rebalanceDate('25 Sep, 2026'),'2026-09-25');assert.equal(rebalanceDate('Need Basis'),null);
 const w=weightsFromPage({id:'BAMIMO_0002',name:'BM',publisher:'Mgr',last_rebalance:'25 Sep, 2026',stocks:[{name:'A',weight:60,segment:'X'},{name:'B',weight:40}]});
 assert.equal(w.asOf,'2026-09-25');assert.equal(w.meta.id,'BAMIMO_0002');
 validateMv({partition:'bamimo_0002',meta:w.meta,tables:w.tables},'bm.weights');
 assert.throws(()=>validateMv({partition:'bamimo_0002',meta:w.meta,tables:{stocks:[{name:'A',weight:60}]}},'bm.weights'),/add up/);
 const sc=weightsAsSmallcase({partition:'bamimo_0002',meta:w.meta,tables:w.tables});assert.equal(sc.dataset,'smallcase.constituents');assert.equal(sc.tables.stocks[1].segment,null);
 const rep=lotsAsReport({partition:'anna',tables:{lots:[{stock_name:'S',isin:'I',quantity:1,buy_date:'2026-01-01',buy_value:5}]}});assert.equal(rep.tables.open_lots[0].buy_value,5);
});
const now=new Date('2026-11-24T05:00:00Z'),config={smallcases:[{id:'BAMIMO_0002',account:'swati'}]};
test('extras schedule: BM daily for the subscribed account, P&L weekly, sooner after a failure',()=>{
 assert.deepEqual(plannedExtras(config,'swati',{},now,false),{smallcases:['BAMIMO_0002'],pnl:true});
 assert.deepEqual(plannedExtras(config,'anna',{},now,false),{smallcases:[],pnl:true});
 const recent={extrasStatus:{bm:{bamimo_0002:{attemptedAt:'2026-11-24T04:00:00Z'}},pnl:{attemptedAt:'2026-11-21T05:00:00Z'}}};
 assert.deepEqual(plannedExtras(config,'swati',recent,now,false),{smallcases:[],pnl:false});
 assert.deepEqual(plannedExtras(config,'swati',recent,now,true),{smallcases:[],pnl:true},'manual: P&L older than 12 h, BM within the hour');
 assert.equal(plannedExtras(config,'swati',{extrasStatus:{pnl:{attemptedAt:'2026-11-23T20:00:00Z',error:'PNL_TIMEOUT'}}},now,false).pnl,true);
 assert.deepEqual(plannedExtras({...config,pnlEnabled:false,bmEnabled:false},'swati',{},now,false),{smallcases:[],pnl:false});
});
test('accepted extras are validated, kept pending and published only into market-view-data',async()=>{
 const book=xlsx({'Trade Level':trade,'Scrip Level':scrip}),path='C:\\Users\\x\\Downloads\\Stocks_PnL_Report_1_01-04-2026_20-11-2026.xlsx';
 const deps={read:async p=>{assert.equal(p,path);return book;},info:async()=>({isFile:()=>true,size:book.length,mtimeMs:+now-1000})};
 const ext={};const page={name:'BM',last_rebalance:'25 Sep, 2026',stocks:[{name:'A',weight:50},{name:'B',weight:50}]};
 const out=await acceptExtras(ext,{smallcases:[{id:'BAMIMO_0002',page},{id:'OTHER',page}],pnl:{path,downloadId:3}},{smallcases:['BAMIMO_0002'],pnl:true},now,deps);
 assert.equal(out.pnlRead,true);assert.equal(out.pnl.lots,2);assert.equal(out.bm.bamimo_0002.stocks,2);assert.equal(out.bm.other,undefined,'unrequested smallcase ignored');
 const published=[];await publishExtras(ext,'swati',async()=>({publish:async(...a)=>published.push(a)}));
 assert.deepEqual(published.map(p=>[p[0],p[1],p[5]?.asOf]),[['pnl.lots','swati','2026-11-20'],['bm.weights','bamimo_0002','2026-09-25']]);
 assert.equal(ext.pendingExtras.pnl,undefined);assert.equal(ext.pendingExtras.bm.length,0);
 const bad={};const failed=await acceptExtras(bad,{pnl:{error:'PNL_TIMEOUT'},smallcases:[{id:'BAMIMO_0002',page:{...page,stocks:[{name:'A',weight:20}]}}]},{smallcases:['BAMIMO_0002'],pnl:true},now,deps);
 assert.equal(failed.pnl.error,'PNL_TIMEOUT');assert.equal(failed.bm.bamimo_0002.error,'SMALLCASE_INVALID');assert.equal(bad.pendingExtras.pnl,undefined);
});
test('only a fresh Groww P&L workbook path is read',async()=>{
 const info=async()=>({isFile:()=>true,size:10,mtimeMs:+now});
 for(const p of ['relative/PnL.xlsx','C:\\x\\notes.xlsx','C:\\x\\PnL.csv'])await assert.rejects(readPnlDownload(p,now,{info,read:async()=>Buffer.alloc(0)}),/PNL_UNEXPECTED_FILE/);
 await assert.rejects(readPnlDownload('C:\\x\\Stocks_PnL.xlsx',now,{info:async()=>({isFile:()=>true,size:10,mtimeMs:+now-3600000}),read:async()=>Buffer.alloc(0)}),/PNL_UNEXPECTED_FILE/);
});
