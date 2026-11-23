import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {reusableProfile,savedProfiles} from '../automation/profiles.mjs';
test('saved collector profile discovery checks metadata without copying or opening the ordinary Chrome profile',async()=>{
 const home=await mkdtemp(join(tmpdir(),'market-profile-test-'));try{
  const chromeRoot=join(home,'normal'),legacy=join(home,'saved'),profile=join(legacy,'Profile_2');await mkdir(join(chromeRoot,'Default'),{recursive:true});await writeFile(join(chromeRoot,'Local State'),'{}');await mkdir(join(profile,'Default'),{recursive:true});await writeFile(join(profile,'Local State'),'{}');await mkdir(join(legacy,'incomplete'),{recursive:true});
  await assert.rejects(reusableProfile(chromeRoot,{chromeRoot}),/NORMAL_CHROME_PROFILE_UNSUPPORTED/);await assert.rejects(reusableProfile(join(chromeRoot,'Default'),{chromeRoot}),/NORMAL_CHROME_PROFILE_UNSUPPORTED/);
  const found=await savedProfiles({root:legacy,chromeRoot});assert.equal(found.length,1);assert.equal(found[0].id,'legacy:Profile_2');assert.equal(found[0].path,await realpath(profile));assert.equal(await reusableProfile(profile,{chromeRoot}),await realpath(profile));
 }finally{assert.ok(resolve(home).startsWith(resolve(tmpdir())));await rm(home,{recursive:true,force:true});}
});
