
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir,access} from 'node:fs/promises';
import path from 'node:path';
import {HttpError,token} from './files.mjs';
const terminal=new Set(['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED']);
const stamp=()=>new Date().toISOString();
export class Jobs {
  constructor(options){Object.assign(this,options);this.jobs=new Map();this.children=new Map();this.writes=Promise.resolve();this.pendingWrites=new Map();this.closing=false;}
  async init(){
    await mkdir(this.stateRoot,{recursive:true,mode:0o700});
    for(const file of await readdir(this.stateRoot)){
      if(!file.endsWith('.json'))continue;
      const job=JSON.parse(await readFile(path.join(this.stateRoot,file),'utf8'));
      if(!terminal.has(job.state)){
        job.state='INTERRUPTED';job.endedAt=stamp();
        job.recoveryNote='API restarted; previous process outcome is unknown. No PID was signalled or job automatically retried.';
      }
      this.jobs.set(job.id,job);await this.persist(job);
    }
  }
  persist(job){
    const prior=this.pendingWrites.get(job.id);
    if(prior){prior.dirty=true;return prior.promise;}
    const name=path.join(this.stateRoot,job.id+'.json'),pending={dirty:true,promise:null};
    const next=this.writes.then(async()=>{
      // Coalesce bursts rather than queueing complete copies of every log tail.
      do{
        pending.dirty=false;
        await writeFile(name+'.tmp',JSON.stringify(job,null,2)+'\n',{mode:0o600});
        await rename(name+'.tmp',name);
      }while(pending.dirty);
    }).finally(()=>this.pendingWrites.delete(job.id));
    pending.promise=next;this.pendingWrites.set(job.id,pending);
    this.writes=next.catch(e=>{this.storageError=e;});
    return next;
  }
  clean(text){
    let out=String(text);
    for(const value of this.secrets??[]) if(value.length>=6) out=out.split(value).join('[REDACTED]');
    return out.replace(/(Bearer\s+)[^\s"']+/gi,'$1[REDACTED]').replace(/((?:api[_-]?key|authorization|password)\s*[:=]\s*)[^\s,}]+/gi,'$1[REDACTED]');
  }
  event(job,kind,text){
    job.sequence++;job.events.push({sequence:job.sequence,time:stamp(),kind,text:this.clean(text).slice(0,8192)});
    if(job.events.length>500){job.events.shift();job.eventsTruncated=true;}
    void this.persist(job).catch(()=>{});
  }
  get(id){const job=this.jobs.get(token(id));if(!job)throw new HttpError(404,'JOB_NOT_FOUND');return job;}
  view(job){const {events,recordRoot,...view}=job;return {...view,links:{self:'/api/v1/jobs/'+job.id,events:'/api/v1/jobs/'+job.id+'/events',cancel:'/api/v1/jobs/'+job.id+'/cancel',result:'/api/v1/jobs/'+job.id+'/result'}};}
  async start(input){
    if(this.closing)throw new HttpError(503,'SERVER_CLOSING');
    if(this.storageError)throw new HttpError(503,'JOB_STORAGE_FAILED');
    if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'INVALID_REQUEST');
    const allowed=new Set(['action','targetId','caseId','maxCases','stopAfterCase','fixtureBehavior']);
    if(Object.keys(input).some(x=>!allowed.has(x)))throw new HttpError(400,'UNKNOWN_FIELD');
    if(!['inspect','plan','run'].includes(input.action))throw new HttpError(400,'UNSUPPORTED_ACTION');
    const target=this.targets.find(x=>x.id===input.targetId);
    if(!target)throw new HttpError(400,'UNKNOWN_TARGET');
    if(this.children.size>=this.maxConcurrentJobs)throw new HttpError(429,'ACTIVE_JOB_LIMIT');
    for(const k of ['caseId','maxCases','stopAfterCase','fixtureBehavior'])if(input[k]!==undefined&&input.action!=='run')throw new HttpError(400,'RUN_OPTION_ONLY');
    if(input.caseId!==undefined)token(input.caseId);
    if(input.maxCases!==undefined&&(!Number.isSafeInteger(input.maxCases)||input.maxCases<1||input.maxCases>10000))throw new HttpError(400,'INVALID_CASE_LIMIT');
    if(input.stopAfterCase!==undefined&&typeof input.stopAfterCase!=='boolean')throw new HttpError(400,'INVALID_STOP_AFTER_CASE');
    if(target.fixture&&(input.caseId!==undefined||input.maxCases!==undefined||input.stopAfterCase!==undefined))throw new HttpError(400,'FIXTURE_BATCH_UNSUPPORTED');
    if(input.fixtureBehavior!==undefined&&(!target.fixture||!['success','bad-output','insufficient-probe','reset-mismatch'].includes(input.fixtureBehavior)))throw new HttpError(400,'INVALID_FIXTURE_BEHAVIOR');
    const config=JSON.parse(await readFile(target.config,'utf8'));
    const recordRoot=path.resolve(this.repoRoot,config.runRoot??'var/records');
    try{await access(this.cliPath);}catch{throw new HttpError(409,'CLI_NOT_BUILT','Build the DSHEval CLI before starting a job.');}
    // Reserve synchronously after async preflight, preventing simultaneous requests exceeding the cap.
    if(this.closing)throw new HttpError(503,'SERVER_CLOSING');
    if(this.children.size>=this.maxConcurrentJobs)throw new HttpError(429,'ACTIVE_JOB_LIMIT');
    const id='wb-'+randomUUID(), runId=id;
    const args=[...this.cliPrefix,input.action,'--target',target.descriptor,'--config',target.config,'--run-id',runId];
    if(target.fixture)args.push('--fixture');
    if(input.action==='run'&&target.fixture)args.push('--fixture-behavior',input.fixtureBehavior??'success');
    if(input.caseId!==undefined)args.push('--case',input.caseId);
    if(input.maxCases!==undefined)args.push('--max-cases',String(input.maxCases));
    if(input.stopAfterCase===true)args.push('--stop-after-case');
    const job={schema:'dsheval.workbench.job/v1',id,runId,action:input.action,targetId:target.id,request:input,
      recordRoot,state:'STARTING',createdAt:stamp(),sequence:0,events:[],eventsTruncated:false,summary:null,
      warnings:target.warnings??[],exitCode:null,signal:null};
    this.jobs.set(id,job);this.children.set(id,null);
    try{await this.persist(job);}catch(e){this.children.delete(id);this.jobs.delete(id);throw new HttpError(503,'JOB_STORAGE_FAILED');}
    let child;
    try{child=spawn(this.nodePath,args,{cwd:this.repoRoot,env:this.environment??process.env,stdio:['ignore','pipe','pipe'],shell:false});}
    catch(e){this.children.delete(id);job.state='FAILED';job.endedAt=stamp();this.event(job,'error','PROCESS_START_FAILED');return this.view(job);}
    this.children.set(id,child);
    child.once('spawn',()=>{if(job.state!=='CANCELLING')job.state='RUNNING';job.startedAt=stamp();this.event(job,'state',job.state);if(job.state==='CANCELLING')child.kill('SIGINT');});
    child.once('error',()=>this.event(job,'error','PROCESS_START_FAILED'));
    // Incremental framing handles split JSON lines and oversized output without unbounded buffers.
    const buffers={stdout:'',stderr:''};
    const consume=(stream,line)=>{
      if(!line.trim())return;
      this.event(job,stream,line);
      if(stream==='stdout'&&line.length<=2*1024*1024){
        try{const value=JSON.parse(line);if(value&&typeof value==='object'&&typeof value.schema==='string'&&value.schema.startsWith('dsheval.'))job.summary=JSON.parse(this.clean(JSON.stringify(value)));}catch{}
      }
    };
    for(const stream of ['stdout','stderr']){
      child[stream].setEncoding('utf8');
      child[stream].on('data',chunk=>{
        buffers[stream]+=chunk;
        let pos;while((pos=buffers[stream].indexOf('\n'))!==-1){consume(stream,buffers[stream].slice(0,pos));buffers[stream]=buffers[stream].slice(pos+1);}
        if(buffers[stream].length>2*1024*1024){buffers[stream]='';job.outputTruncated=true;this.event(job,'warning','CLI_OUTPUT_LINE_TOO_LARGE');}
      });
    }
    child.once('close',(code,signal)=>{
      for(const s of ['stdout','stderr'])consume(s,buffers[s]);
      this.children.delete(id);job.exitCode=code;job.signal=signal;job.endedAt=stamp();
      const summary=job.summary;
      if(code===130||summary?.status==='CANCELLED'||(job.cancelRequestedAt&&signal==='SIGINT'))job.state='CANCELLED';
      else job.state=code===0&&summary?.status==='COMPLETED'?'SUCCEEDED':'FAILED';
      this.event(job,'state',job.state);
    });
    return this.view(job);
  }
  async cancel(id){
    const job=this.get(id);
    if(terminal.has(job.state))return this.view(job);
    if(!job.cancelRequestedAt){
      job.cancelRequestedAt=stamp();job.state='CANCELLING';this.event(job,'state','Cancellation requested; waiting for CLI collection and cleanup.');
      this.children.get(id)?.kill('SIGINT');
    }
    return this.view(job);
  }
  async shutdown(){
    this.closing=true;
    await Promise.all([...this.children.keys()].map(id=>this.cancel(id)));
    await this.writes;
  }
}
