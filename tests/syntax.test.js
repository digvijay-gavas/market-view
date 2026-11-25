import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
// Browser-only modules (app.js) are not imported by other tests; parse every source file.
test('every viewer and collector source file parses',()=>{
 for(const dir of ['src','automation','extension','worker'])for(const f of readdirSync(dir).filter(n=>/\.m?js$/.test(n))){
  try{execFileSync(process.execPath,['--check',dir+'/'+f],{stdio:'pipe'});}catch(error){assert.fail(dir+'/'+f+': '+String(error.stderr).split('\n').slice(0,5).join(' '));}
 }
});
