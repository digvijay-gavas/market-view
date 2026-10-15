import {mkdir,copyFile,cp,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
for(const name of ['index.html','SETUP.html','.nojekyll'])await copyFile(root+name,root+'dist/'+name);
await cp(root+'src',root+'dist/src',{recursive:true});
// Deployment is a strict allowlist; tests, local data and credentials are never copied.
const html=await readFile(root+'dist/index.html','utf8');
if(!html.includes('Content-Security-Policy'))throw new Error('CSP is required');
console.log('Built static site in dist/ (HTML, CSS and browser modules only).');
