
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('real existing CLI: HTTP inspect produces actual Fixture plugin and tool records',async()=>{
 const state=await mkdtemp(path.join(root,'workbench/var/cli-test-'));
 const token='real-cli-integration-token-0123456789';
 const app=await startServer({repoRoot:root,stateRoot:state,port:0,token});
 try{
  const response=await fetch(app.url+'/api/v1/jobs',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'inspect',targetId:'fixture'})});
  assert.equal(response.status,202);const job=await response.json();
  let actual;
  for(let i=0;i<300;i++){actual=app.jobs.get(job.id);if(['SUCCEEDED','FAILED'].includes(actual.state))break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(actual.state,'SUCCEEDED',JSON.stringify(actual.summary));
  const result=await (await fetch(app.url+'/api/v1/jobs/'+job.id+'/result',{headers:{Authorization:'Bearer '+token}})).json();
  assert.equal(result.inspection.profile.name,'fixture-attention');
  assert(result.inspection.pluginCatalog.some(p=>p.id==='fixture.python-tool'));
  assert(result.inspection.toolSchemas.some(t=>t.name==='python'));
  await writeFile(path.join(root,'workbench/var/real-cli-verification.json'),JSON.stringify({state:actual.state,realCli:true,fixture:true,modelCalled:false,result},null,2));
 }finally{await app.close();await rm(state,{recursive:true,force:true});}
});
