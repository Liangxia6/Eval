
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const secret='test-secret-value-for-redaction';
const apiToken='only-a-test-token-01234567890123456789';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(){
  const state=await mkdtemp(path.join(root,'workbench/var/api-test-'));
  const cli=path.join(root,'workbench/tests/cli-double.mjs');
  const app=await startServer({repoRoot:root,stateRoot:state,port:0,token:apiToken,cliPath:cli,environment:{...process.env,TEST_SECRET:secret}});
  const request=async(p,options={})=>{
    const response=await fetch(app.url+p,{...options,headers:{Authorization:'Bearer '+apiToken,...options.headers}});
    const data=(response.headers.get('content-type')??'').includes('application/json')?await response.json():await response.text();
    return {status:response.status,data};
  };
  const post=(p,value)=>request(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  const until=async(id,predicate)=>{
    for(let i=0;i<200;i++){const job=app.jobs.get(id);if(predicate(job))return job;await pause(20);}
    throw new Error('Timed out waiting for job');
  };
  return {app,state,request,post,until,async close(){await app.close();await rm(state,{recursive:true,force:true});}};
}
test('authorization, origin, and allowlisted commands',async()=>{
 const s=await setup();try{
  assert.equal((await fetch(s.app.url+'/api/v1/jobs')).status,401);
  assert.equal((await s.request('/api/v1/jobs',{headers:{Origin:'http://evil.example'}})).status,403);
  assert.equal((await s.post('/api/v1/jobs',{action:'run',targetId:'fixture',command:'touch /tmp/forbidden'})).status,400);
  assert.equal((await s.post('/api/v1/jobs',{action:'run',targetId:'fixture',caseId:'../escape'})).status,400);
  assert.equal((await s.post('/api/v1/jobs',{action:'inspect',targetId:'unknown'})).status,400);
  assert.equal((await s.request('/api/v1/capabilities')).data.executeFrozenPlan,false);
 }finally{await s.close();}
});
test('async lifecycle, split CLI summary, logs, secrets and failure',async()=>{
 const s=await setup();try{
  const r=await s.post('/api/v1/jobs',{action:'inspect',targetId:'fixture'});assert.equal(r.status,202);
  const job=await s.until(r.data.id,j=>j.state==='SUCCEEDED');
  assert.equal(job.summary.status,'COMPLETED');assert.equal(job.exitCode,0);
  const e=await s.request('/api/v1/jobs/'+job.id+'/events');
  assert(!JSON.stringify(e.data).includes(secret));assert(JSON.stringify(e.data).includes('[REDACTED]'));
  assert.equal((await s.request('/api/v1/jobs/'+job.id+'/events?after='+e.data.nextCursor)).data.items.length,0);
  const p=await s.post('/api/v1/jobs',{action:'plan',targetId:'fixture'});
  assert.equal((await s.until(p.data.id,j=>j.state==='FAILED')).exitCode,4);
 }finally{await s.close();}
});
test('graceful cancel and terminal idempotency',async()=>{
 const s=await setup();try{
  const r=await s.post('/api/v1/jobs',{action:'run',targetId:'fixture'});
  await s.until(r.data.id,j=>j.events.some(e=>e.text==='READY_FOR_CANCEL'));
  const cancel=await s.post('/api/v1/jobs/'+r.data.id+'/cancel',{});assert.equal(cancel.data.state,'CANCELLING');
  const job=await s.until(r.data.id,j=>j.state==='CANCELLED');assert.equal(job.summary.status,'CANCELLED');
  assert.equal((await s.post('/api/v1/jobs/'+r.data.id+'/cancel',{})).data.state,'CANCELLED');
 }finally{await s.close();}
});
test('concurrent requests enforce API process cap without serializing all jobs',async()=>{
 const s=await setup();try{
  const r=await Promise.all(Array.from({length:5},()=>s.post('/api/v1/jobs',{action:'run',targetId:'fixture'})));
  assert.equal(r.filter(x=>x.status===202).length,4);assert.equal(r.filter(x=>x.status===429).length,1);
  for(const x of r.filter(x=>x.status===202)){await s.until(x.data.id,j=>j.events.some(e=>e.text==='READY_FOR_CANCEL'));await s.app.jobs.cancel(x.data.id);}
  for(const x of r.filter(x=>x.status===202))await s.until(x.data.id,j=>j.state==='CANCELLED');
 }finally{await s.close();}
});
test('history, JSON, HTML, output download and symlink escape',async()=>{
 const s=await setup();try{
  const dir=path.join(s.state,'evaluation-results/agents/test-agent/runs/test-run/cases/test-case');
  await mkdir(path.join(dir,'output'),{recursive:true});
  await writeFile(path.join(dir,'report.json'),JSON.stringify({schema:'dsheval.result/v1',scores:[{score:0}]}));
  await writeFile(path.join(dir,'report.html'),'<html>Actual report</html>');
  await writeFile(path.join(dir,'output/answer.txt'),'actual output');
  await writeFile(path.join(s.state,'outside.txt'),'private');
  await symlink(path.join(s.state,'outside.txt'),path.join(dir,'output/escape.txt'));
  const prefix='/api/v1/runs/workbench/test-agent/test-run';
  assert((await s.request('/api/v1/runs')).data.items.some(x=>x.runId==='test-run'));
  assert.deepEqual((await s.request(prefix)).data.caseIds,['test-case']);
  assert.equal((await s.request(prefix+'/cases/test-case')).data.scores[0].score,0);
  assert.equal((await s.request(prefix+'/cases/test-case/html')).data,'<html>Actual report</html>');
  assert.equal((await s.request(prefix+'/cases/test-case/files/output/answer.txt')).data,'actual output');
  assert.equal((await s.request(prefix+'/cases/test-case/files/output/escape.txt')).status,403);
 }finally{await s.close();}
});
test('restart preserves history and marks unresolved jobs interrupted without PID kill',async()=>{
 const s=await setup();
 try{
  await writeFile(path.join(s.state,'jobs/wb-unresolved.json'),JSON.stringify({id:'wb-unresolved',state:'RUNNING',createdAt:new Date().toISOString(),sequence:0,events:[]}));
  await s.app.close();
  const second=await startServer({repoRoot:root,stateRoot:s.state,port:0,token:apiToken});
  assert.equal(second.jobs.get('wb-unresolved').state,'INTERRUPTED');
  await second.close();
 }finally{await rm(s.state,{recursive:true,force:true});}
});

test('bounded event history reports gaps and persists the latest state during log bursts',async()=>{
 const s=await setup();try{
  const r=await s.post('/api/v1/jobs',{action:'inspect',targetId:'fixture'});
  const job=await s.until(r.data.id,j=>j.state==='SUCCEEDED');
  for(let i=0;i<650;i++)s.app.jobs.event(job,'stderr','burst-'+i);
  const events=(await s.request('/api/v1/jobs/'+job.id+'/events?after=0')).data;
  assert.equal(events.items.length,500);assert.equal(events.gap,true);
  assert.equal(events.items.at(-1).text,'burst-649');
  await s.app.jobs.writes;
  const {readFile}=await import('node:fs/promises');
  const saved=JSON.parse(await readFile(path.join(s.state,'jobs',job.id+'.json'),'utf8'));
  assert.equal(saved.events.at(-1).text,'burst-649');assert.equal(saved.state,'SUCCEEDED');
 }finally{await s.close();}
});
