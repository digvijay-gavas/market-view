// Extra captures (BM weights, P&L lots) that ride along with an account's positions capture.
// Decides when they are due, turns what the extension sends into market-view-data documents,
// and publishes them (into market-data/market-view-data only).
import {readFile,stat} from 'node:fs/promises';
import {win32,posix} from 'node:path';
import {ist} from './schedule.mjs';
import {parsePnlReport} from './pnl-report.mjs';
import {lotsFromReport,weightsFromPage,validateMv} from '../src/mv-data.js';

const DAY=86400000;
export function extrasConfig(config){
 const smallcases=(Array.isArray(config.smallcases)?config.smallcases:[]).filter(s=>/^[A-Za-z0-9_]{1,40}$/.test(s?.id||'')&&typeof s.account==='string');
 const days=Number.isFinite(config.pnlEveryDays)&&config.pnlEveryDays>=1?config.pnlEveryDays:7;
 return {smallcases,pnlEveryDays:days,pnlEnabled:config.pnlEnabled!==false,bmEnabled:config.bmEnabled!==false};
}
// BM: daily (manual runs refresh it if older than an hour). P&L: every N days (manual: if older than 12 h).
export function plannedExtras(config,account,ext,now,manual){
 const c=extrasConfig(config),status=ext.extrasStatus||{},age=at=>+now-(Date.parse(at||'')||0);
 const bmDue=at=>!at||(manual?age(at)>3600000:ist(new Date(at)).day!==ist(now).day);
 const forced=ext.forceExtras||{};
 const smallcases=c.bmEnabled||forced.bm?c.smallcases.filter(s=>s.account===account&&(forced.bm||bmDue(status.bm?.[s.id.toLowerCase()]?.attemptedAt))).map(s=>s.id):[];
 // A failed attempt is retried after 6 h rather than waiting out the whole interval.
 const pnl=Boolean(forced.pnl)||c.pnlEnabled&&(age(status.pnl?.attemptedAt)>(manual?DAY/2:status.pnl?.error?DAY/4:c.pnlEveryDays*DAY));
 return {smallcases,pnl};
}
// The download is accepted only if it looks exactly like Groww's export and is brand new.
export async function readPnlDownload(path,now,{read=readFile,info=stat}={}){
 const p=typeof path==='string'&&/^[A-Za-z]:[\\/]/.test(path)?win32:posix;
 if(typeof path!=='string'||!p.isAbsolute(path)||p.extname(path).toLowerCase()!=='.xlsx'||!/PnL/i.test(p.basename(path)))throw new Error('PNL_UNEXPECTED_FILE');
 const s=await info(path);if(!s.isFile()||s.size>20*1024*1024||+now-s.mtimeMs>15*60000)throw new Error('PNL_UNEXPECTED_FILE');
 return read(path);
}
export async function acceptExtras(ext,extras,planned,now,deps={}){
 const status=ext.extrasStatus||={},pending=ext.pendingExtras||={},out={};delete ext.forceExtras;delete ext.extrasScheduled;
 const at=now.toISOString(),asked=planned||{smallcases:[],pnl:false};
 for(const item of Array.isArray(extras?.smallcases)?extras.smallcases:[]){
  const id=String(item?.id||'');if(!asked.smallcases?.includes(id))continue;const key=id.toLowerCase();status.bm||={};
  try{
   if(item.error)throw new Error(/^[A-Z_]+$/.test(item.error)?item.error:'SMALLCASE_FAILED');
   const w=weightsFromPage({...item.page,id});validateMv({partition:key,meta:w.meta,tables:w.tables},'bm.weights');
   (pending.bm||=[]).push({id:key,...w,capturedAt:at});status.bm[key]={attemptedAt:at,capturedAt:at,stocks:w.tables.stocks.length,error:null};
  }catch(error){status.bm[key]={...status.bm[key],attemptedAt:at,error:/^[A-Z_]+$/.test(error.message)?error.message:'SMALLCASE_INVALID'};}
 }
 out.bm=status.bm||null;
 if(asked.pnl&&extras?.pnl){
  status.pnl={...status.pnl,attemptedAt:at};
  try{
   if(extras.pnl.error)throw new Error(/^[A-Z_]+$/.test(extras.pnl.error)?extras.pnl.error:'PNL_FAILED');
   const buf=await readPnlDownload(extras.pnl.path,now,deps);out.pnlRead=true;
   const lots=lotsFromReport(parsePnlReport(buf));validateMv({tables:lots.tables},'pnl.lots');
   pending.pnl={...lots,capturedAt:at};Object.assign(status.pnl,{capturedAt:at,asOf:lots.asOf,lots:lots.tables.lots.length,error:null});
  }catch(error){status.pnl.error=/^[A-Z_]+$/.test(error.message)?error.message:'PNL_REPORT_UNRECOGNISED';}
  out.pnl=status.pnl;
 }
 return out;
}
// Called by the worker after the account's positions: publish whatever the bridge accepted.
export async function publishExtras(ext,account,getStore){
 const pending=ext?.pendingExtras;if(!pending||(!pending.pnl&&!pending.bm?.length))return;
 const mv=await getStore();
 if(pending.pnl){const p=pending.pnl;await mv.publish('pnl.lots',account,p.tables,p.meta,new Date(p.capturedAt),{asOf:p.asOf});delete pending.pnl;if(ext.extrasStatus?.pnl)ext.extrasStatus.pnl.publishedAt=new Date().toISOString();}
 while(pending.bm?.length){const w=pending.bm[0];await mv.publish('bm.weights',w.id,w.tables,w.meta,new Date(w.capturedAt),{asOf:w.asOf||undefined});pending.bm.shift();if(ext.extrasStatus?.bm?.[w.id])ext.extrasStatus.bm[w.id].publishedAt=new Date().toISOString();}
}
