import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { createKnowledgeProvider,deepseekEndpoint } from '../knowledge/providers.mjs';
import { openDatabase } from '../db.mjs';
import { initKnowledge } from '../knowledge/store.mjs';
import { answerKnowledge } from '../knowledge/assistant.mjs';
import { hashPassword } from '../workbench-auth.mjs';
import { makePdf,quoteProvider } from './knowledge-fixture.mjs';

const question=(mode,question)=>({method:'POST',body:JSON.stringify({mode,question})});
async function serve(options){
  const {server}=createApp(options);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return {api:async(path,options={},cookie='')=>fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{
    ...options,headers:{'Content-Type':'application/json',Cookie:cookie,...options.headers},
  }),close:()=>new Promise(resolve=>server.close(resolve))};
}
async function login(api,payload,headers={}){
  const r=await api('/login',{method:'POST',body:JSON.stringify(payload),headers});
  assert.equal(r.status,200,await r.text());
  return r.headers.get('set-cookie').split(';')[0];
}
const sendPdf=(name,category,body)=>['/knowledge/documents?'+new URLSearchParams({name,category}),{method:'POST',headers:{'Content-Type':'application/pdf'},body}];

test('上传的 PDF 可跨会话存续，并按真实页码引用；分类、停用和移除即时生效',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'insurance-knowledge-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const dbPath=join(dir,'knowledge.sqlite'),provider=quoteProvider();
  let app=await serve({dbPath,env:{},knowledgeProvider:provider});
  t.after(()=>app.close());
  const {api}=app;
  const leader=await login(api,{role:'leader'});
  const agent=await login(api,{role:'agent',agent_id:'A001'});
  const original=makePdf(['Team methods and workflow reference.','LANTERN onboarding: request the green register for identity verification.']);
  const [path,upload]=sendPdf('团队核对指南.pdf','team',original);
  assert.equal((await api('/knowledge/documents')).status,401);
  assert.equal((await api(path,upload,agent)).status,403);
  assert.equal((await api('/knowledge/search?category=team&q=LANTERN',{},agent)).status,403);
  assert.equal((await api(...sendPdf('扫描件.pdf','team',makePdf([''])),leader)).status,422);
  const created=await api(path,upload,leader);
  assert.equal(created.status,201);
  const {document:d}=await created.json();
  assert.equal(d.pages,2);
  assert.equal(d.chunks,2);
  assert.equal((await api(path,upload,leader)).status,409);
  const filePath='/knowledge/documents/'+d.id;
  assert.equal((await api(filePath+'/file')).status,401);
  const downloaded=await api(filePath+'/file?download=1',{},agent);
  assert.equal(downloaded.headers.get('content-type'),'application/pdf');
  assert.match(downloaded.headers.get('content-disposition'),/^attachment/);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),original);
  const probe=await api('/knowledge/search?category=team&q=LANTERN',{},leader).then(r=>r.json());
  assert.equal(probe.matches[0].page,2);
  assert.match(probe.matches[0].excerpt,/green register/);

  const answer=await api('/knowledge/ask',question('team','LANTERN'),agent).then(r=>r.json());
  assert.equal(answer.status,'grounded');
  assert.equal(answer.sources[0].id,d.id);
  assert.equal(answer.sources[0].page,2);
  assert.equal(answer.sample,false);
  const notFound=await api('/knowledge/ask',question('product','LANTERN'),agent).then(r=>r.json());
  assert.equal(notFound.status,'insufficient');
  assert.equal(provider.calls.length,1);
  assert.equal((await api(filePath,{method:'PATCH',body:'{"enabled":false}'},agent)).status,403);
  assert.equal((await api(filePath,{method:'PATCH',headers:{Origin:'https://wrong.invalid'},body:'{"enabled":false}'},leader)).status,403);
  assert.equal((await api(filePath,{method:'PATCH',body:'{"enabled":false}'},leader)).status,200);
  assert.equal((await api(filePath+'/file',{},agent)).status,404);
  assert.equal((await api('/knowledge/ask',question('team','LANTERN'),agent).then(r=>r.json())).status,'insufficient');

  await app.close();
  app=await serve({dbPath,env:{},knowledgeProvider:provider});
  const persisted=await app.api('/knowledge/documents',{},leader).then(r=>r.json());
  assert.equal(persisted.documents.find(v=>v.id===d.id).enabled,false);
  assert.equal((await app.api(filePath,{method:'PATCH',body:'{"category":"objection","enabled":true}'},leader)).status,200);
  assert.equal((await app.api('/knowledge/ask',question('objection','LANTERN'),agent).then(r=>r.json())).sources[0].page,2);
  assert.equal((await app.api(filePath,{method:'DELETE'},leader)).status,200);
  assert.equal((await app.api('/knowledge/ask',question('objection','LANTERN'),agent).then(r=>r.json())).status,'insufficient');
  assert.equal((await app.api(filePath+'/file',{},leader)).status,404);
});

test('生产环境拒绝演示登录及旧演示会话，并排除演示资料',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'insurance-prod-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const dbPath=join(dir,'team.sqlite'),accounts=join(dir,'accounts.json');
  const demo=await serve({dbPath,env:{},knowledgeProvider:quoteProvider()});
  const oldSession=await login(demo.api,{role:'leader'});
  await demo.close();
  assert.throws(()=>createApp({dbPath,env:{NODE_ENV:'production'}}),/WORKBENCH_PUBLIC_ORIGIN/);
  const password='unique file based test passphrase',passwordHash=await hashPassword(password);
  await writeFile(accounts,JSON.stringify([{username:'leader',role:'leader',passwordHash},{username:'agent01',role:'agent',agent_id:'A001',passwordHash}]),{mode:0o600});
  const origin='https://team.example.invalid';
  const env={NODE_ENV:'production',WORKBENCH_PUBLIC_ORIGIN:origin,WORKBENCH_ACCOUNTS_FILE:accounts};
  const app=await serve({dbPath,env});
  t.after(app.close);
  const {api}=app;
  assert.equal((await api('/demo-accounts').then(r=>r.json())).demo,false);
  assert.equal((await api('/me',{},oldSession)).status,401);
  assert.equal((await api('/login',{method:'POST',body:'{"role":"leader"}'})).status,401);
  const result=await api('/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify({username:'leader',password})});
  const cookie=result.headers.get('set-cookie');
  assert.match(cookie,/insurance_session=p_[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure/);
  const leader=cookie.split(';')[0];
  const state=await api('/knowledge/documents',{},leader).then(r=>r.json());
  assert.deepEqual(state,{documents:[],ai:{provider:'deepseek',configured:false}});
  assert.equal((await api('/knowledge/documents/demo-team/file',{},leader)).status,404);
  assert.equal((await api('/knowledge/ask',question('team','佣金如何核对？'),leader).then(r=>r.json())).status,'insufficient');
  const agent=await login(api,{username:'agent01',password});
  assert.equal((await api('/me',{},agent).then(r=>r.json())).agent_id,'A001');
});

test('Pi 与 DeepSeek 收到同一份业务提示词、问题和证据；回复经过相同引用校验',async ()=>{
  const db=openDatabase(':memory:');initKnowledge(db,{includeSamples:true});
  const calls={};
  const answer={status:'grounded',title:'佣金核对',intro:'先核对结算单。',blocks:[{title:'核对',text:'核对保单号和结算期间。',sourceIds:['X1']}],followup:'你是在核对哪个期间？'};
  const pi=createKnowledgeProvider({PI_AGENT_BIN:process.execPath},{run:async(_bin,args,input)=>{
    if(args[0]==='auth')return 'ready\n';
    assert.ok(args.includes('--no-tools')&&args.includes('--no-session')&&args.includes('--no-context-files'));
    assert.equal(args.includes(input),false);
    calls.pi={system:args.at(-1),user:input};
    return JSON.stringify({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:JSON.stringify(answer)}]}});
  }});
  const deepseek=createKnowledgeProvider({NODE_ENV:'production',DEEPSEEK_API_KEY:'test-key',PI_AGENT_BIN:process.execPath},{fetcher:async(url,options)=>{
    assert.equal(url,deepseekEndpoint);
    const body=JSON.parse(options.body);
    assert.equal(body.response_format.type,'json_object');
    assert.equal(body.model,'deepseek-flash');
    calls.deepseek={system:body.messages[0].content,user:body.messages[1].content};
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]});
  }});
  const ask=provider=>answerKnowledge(db,{mode:'team',question:'佣金如何发放和核对？'},{provider,includeSamples:true});
  assert.deepEqual(await ask(pi),await ask(deepseek));
  assert.deepEqual(calls.pi,calls.deepseek);
  assert.equal(JSON.parse(calls.pi.user).evidence[0].page,2);
  const invalid={...answer,blocks:[{title:'不存在的引用',text:'虚构比例。',sourceIds:['X999']}]};
  await assert.rejects(ask({complete:async()=>JSON.stringify(invalid)}),{status:502});
  const noResult=await answerKnowledge(db,{mode:'team',question:'明天的天气？'},{provider:{complete(){throw new Error('should never call');}},includeSamples:true});
  assert.equal(noResult.status,'insufficient');
  db.close();
});
