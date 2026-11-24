import {mkdir,copyFile,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
for(const name of ['index.html','SETUP.html','privacy.html','terms.html','.nojekyll'])await copyFile(root+name,root+'dist/'+name);
await cp(root+'src',root+'dist/src',{recursive:true});
// Deployment is a strict allowlist; tests, local data and credentials are never copied.
let html=await readFile(root+'dist/index.html','utf8');
if(!html.includes('Content-Security-Policy'))throw new Error('CSP is required');
// Stamp the commit so the footer shows which version is live (GitHub Actions sets GITHUB_SHA).
let version=(process.env.GITHUB_SHA||'').slice(0,7);
if(!version)try{version=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root}).toString().trim();}catch{version='local';}
html=html.replace('__BUILD_VERSION__',version+' · '+new Date().toISOString().slice(0,16).replace('T',' ')+' UTC');await writeFile(root+'dist/index.html',html);
// Cache-bust per release: GitHub Pages lets browsers keep files for 10 minutes, which could pair a
// new page with old modules. Every module import and the page's script/CSS links carry ?v=<commit>.
const tag='?v='+encodeURIComponent(version);
for(const name of (await readdir(root+'dist/src')).filter(n=>n.endsWith('.js'))){
 const file=root+'dist/src/'+name,source=await readFile(file,'utf8');
 await writeFile(file,source.replace(/(from\s*|import\s*\(\s*)'(\.\/[\w.-]+\.js)'/g,(_,lead,path)=>`${lead}'${path}${tag}'`));
}
for(const name of ['index.html','SETUP.html','privacy.html','terms.html']){
 const file=root+'dist/'+name,page=await readFile(file,'utf8');
 await writeFile(file,page.replace(/(href|src)="\.\/src\/(style\.css|app\.js)"/g,(_,attr,path)=>`${attr}="./src/${path}${tag}"`));
}
console.log('Built static site in dist/ (HTML, CSS and browser modules only).');
