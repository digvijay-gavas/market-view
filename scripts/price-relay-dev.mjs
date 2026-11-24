// Local stand-in for the Cloudflare Worker: node scripts/price-relay-dev.mjs (port 5175).
// Point the viewer at it with PRICE_PROXY_URL='http://127.0.0.1:5175' and allow that origin in the CSP while testing.
import {createServer} from 'node:http';
import {handle} from '../worker/price-proxy.js';
const port=Number(process.env.PORT||5175);
createServer(async(req,res)=>{
 const response=await handle(new Request('http://127.0.0.1:'+port+req.url,{method:req.method,headers:req.headers}),{ALLOWED_ORIGINS:process.env.ALLOWED_ORIGINS||'http://127.0.0.1:5174,http://localhost:5174'},{cache:null});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port,'127.0.0.1',()=>console.log('Price relay (dev): http://127.0.0.1:'+port+'/quotes?slugs=...'));
