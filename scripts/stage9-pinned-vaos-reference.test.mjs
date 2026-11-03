import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../vaos-reference/',import.meta.url);
const expected=Object.freeze({
  'packages/contracts/vyndi-write-bridge.mjs':'706b069bbf485b86d3f374d1d56c7d84a072b671',
  'platform/execution/vyndi-write-bridge.mjs':'25101350520ff395808ee16f5ee7bd437e4ef122',
  'platform/execution/vyndi-read-bridge-client.mjs':'571d95b7aaea118504a90aa342a001cf350053e9',
});
const sha='f8fa8ec2bcfb64e876d503d7a3a5a4d7c4353e2c';
const objectSha=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');

test('pinned VAOS cross-repo sender matches exact Git blob IDs from the original upstream commit',async()=>{
 const manifest=JSON.parse(await readFile(new URL('./SOURCE-PIN.json',root),'utf8'));
 assert.equal(manifest.repository,'vyndivybes/vaos');
 assert.equal(manifest.commit,sha);
 assert.deepEqual(manifest.files,expected);
 assert.equal(manifest.qualificationOnly,true);
 for(const [path,id] of Object.entries(expected)){
   const bytes=await readFile(new URL(path,root));
   assert.equal(objectSha(bytes),id,path+' has diverged from the independently fetched VAOS blob');
   assert.notEqual(objectSha(Buffer.concat([bytes,Buffer.from('\n')])),id,'modifications must be detected');
 }
});

test('offline Stage 9 fixture is isolated from production and does not require a private checkout token',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/stage9-signed-loopback-qualification.yml',import.meta.url),'utf8');
 assert.match(workflow,/Verify pinned VAOS sender integrity/);
 assert.doesNotMatch(workflow,/repository:\s*vyndivybes\/vaos/);
 assert.doesNotMatch(workflow,/secrets\.|VAOS_CI_TOKEN|PERSONAL_ACCESS_TOKEN/);
 const loopback=await readFile(new URL('./vaos-stage9-signed-loopback.test.mjs',import.meta.url),'utf8');
 assert.match(loopback,/vaos-reference/);
 assert.match(loopback,/127\.0\.0\.1|createStage9SignedLoopbackSandbox/);
});
