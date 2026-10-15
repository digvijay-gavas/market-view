// Local-only synthetic UI fixture. Not included in the production build.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let body,type='text/html; charset=utf-8';
    if(pathname==='/') {
      body=(await readFile(root+'/index.html','utf8')).replace('<script src="https://accounts.google.com/gsi/client" async defer></script>','<script src="./tests/browser-fixture.js"></script>').replace('<body>','<body><p role="note">SYNTHETIC TEST FIXTURE — invented data, fake authorization, no Google requests.</p>');
    } else {
      const path=resolve(root,'.'+pathname);
      if(!path.startsWith(root+sep)||(!pathname.startsWith('/src/')&&pathname!=='/tests/browser-fixture.js'))throw new Error('Not served');
      body=await readFile(path);type=extname(path)==='.css'?'text/css':'text/javascript';
    }
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(5174,'127.0.0.1',()=>console.log('Synthetic UI fixture: http://127.0.0.1:5174/'));
