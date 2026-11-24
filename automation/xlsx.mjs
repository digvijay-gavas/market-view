// Minimal read-only XLSX reader (no dependencies): enough for Groww's exported reports.
// An .xlsx is a ZIP of XML parts; this reads the central directory, inflates the parts it
// needs and returns every sheet as rows of plain cell values (string | number | null).
import {inflateRawSync} from 'node:zlib';

const MAX_PART=64*1024*1024;
function entries(buf){
 // End of central directory: last 22+ bytes, signature 0x06054b50.
 let eocd=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw new Error('XLSX_INVALID');
 const count=buf.readUInt16LE(eocd+10);let at=buf.readUInt32LE(eocd+16);const out=new Map();
 for(let n=0;n<count;n++){
  if(buf.readUInt32LE(at)!==0x02014b50)throw new Error('XLSX_INVALID');
  const method=buf.readUInt16LE(at+10),size=buf.readUInt32LE(at+20),raw=buf.readUInt32LE(at+24),nameLen=buf.readUInt16LE(at+28),extra=buf.readUInt16LE(at+30),comment=buf.readUInt16LE(at+32),local=buf.readUInt32LE(at+42);
  out.set(buf.toString('utf8',at+46,at+46+nameLen),{method,size,raw,local});at+=46+nameLen+extra+comment;
 }
 return out;
}
function part(buf,list,name){
 const e=list.get(name);if(!e)return null;if(e.raw>MAX_PART)throw new Error('XLSX_TOO_LARGE');
 const start=e.local+30+buf.readUInt16LE(e.local+26)+buf.readUInt16LE(e.local+28),data=buf.subarray(start,start+e.size);
 const out=e.method===0?data:e.method===8?inflateRawSync(data,{maxOutputLength:MAX_PART}):null;if(!out)throw new Error('XLSX_UNSUPPORTED');
 return out.toString('utf8');
}
const unescape=s=>s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi,(m,e)=>e==='lt'?'<':e==='gt'?'>':e==='quot'?'"':e==='apos'?"'":e==='amp'?'&':String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10)));
const textOf=xml=>unescape([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>m[1]).join(''));
const column=ref=>{let n=0;for(const c of ref.match(/^[A-Z]+/)[0])n=n*26+c.charCodeAt(0)-64;return n-1;};

export function readWorkbook(buf){
 const list=entries(buf),wb=part(buf,list,'xl/workbook.xml');if(!wb)throw new Error('XLSX_INVALID');
 const rels=part(buf,list,'xl/_rels/workbook.xml.rels')||'',targets=new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m=>[m[0].match(/Id="([^"]+)"/)?.[1],m[0].match(/Target="([^"]+)"/)?.[1]]));
 const shared=[...(part(buf,list,'xl/sharedStrings.xml')||'').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m=>textOf(m[1]));
 const sheets={};
 for(const m of wb.matchAll(/<sheet\b[^>]*>/g)){
  const name=unescape(m[0].match(/name="([^"]*)"/)[1]),rid=m[0].match(/r:id="([^"]+)"/)?.[1],target=targets.get(rid);if(!target)continue;
  const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,''),xml=part(buf,list,path);if(!xml)continue;
  const rows=[];
  for(const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)){
   const index=Number((r[1]||r[3]).match(/r="(\d+)"/)?.[1]||rows.length+1)-1,cells=[];
   for(const c of (r[2]||'').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const attrs=c[1],body=c[2]||'',ref=attrs.match(/r="([A-Z]+)\d+"/)?.[1],type=attrs.match(/t="([^"]+)"/)?.[1],v=body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    let value=null;
    if(type==='s')value=v==null?null:shared[Number(v)]??null;
    else if(type==='inlineStr')value=textOf(body);
    else if(type==='str'||type==='e')value=v==null?null:unescape(v);
    else if(type==='b')value=v==='1';
    else if(v!=null){const n=Number(v);value=Number.isFinite(n)?n:unescape(v);}
    cells[ref?column(ref):cells.length]=value;
   }
   rows[index]=Array.from(cells,x=>x===undefined?null:x);
  }
  sheets[name]=Array.from(rows,x=>x||[]);
 }
 return sheets;
}
