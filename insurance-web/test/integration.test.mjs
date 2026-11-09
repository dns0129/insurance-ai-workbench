import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { analyze } from '../ai.mjs';
import { openDatabase,addPolicy } from '../db.mjs';
const dir=mkdtempSync(path.join(tmpdir(),'insurance-test-'));
const {server,db}=createApp({dbPath:path.join(dir,'test.sqlite'),env:{}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
async function req(route,{cookie='',body,method=body?'POST':'GET'}={}){
  const response=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',cookie},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
let leader,agent;
test.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
test('未登录不能读取业务；模拟目录恰好 3 人',async()=>{
  assert.equal((await req('/dashboard')).status,401);
  assert.equal((await req('/policies')).status,401);
  const result=await req('/demo-accounts');assert.equal(result.data.agents.length,3);
  assert.equal(new Set(result.data.agents.map(a=>a.name)).size,3);
  leader=(await req('/login',{body:{role:'leader'}})).cookie;
  agent=(await req('/login',{body:{role:'agent',agent_id:'A006'}})).cookie;
});
test('团队历史与保单账本一致；个人不返回其他代理人',async()=>{
  const team=(await req('/dashboard',{cookie:leader})).data;
  assert.equal(team.agents.length,3);assert.equal(team.historyMonths.length,6);
  const me=(await req('/dashboard',{cookie:agent})).data;
  assert.equal(me.agents.length,1);assert.equal(me.agents[0].id,'A006');assert.equal(me.agents[0].actual,32000);
  for(const a of team.agents){assert.equal(a.history[5],a.actual);const sum=db.prepare("SELECT SUM(premium) n FROM policies WHERE agent_id=? AND date LIKE '2026-10%'").get(a.id).n;assert.equal(a.actual,sum/100);}
  assert.equal(team.profile.total,90);assert.equal(me.profile.total,30);
});
test('越权查询和写入均被拒绝',async()=>{
  assert.equal((await req('/policies?agent=A001',{cookie:agent})).status,403);
  assert.equal((await req('/clients?agent=A001',{cookie:agent})).status,403);
  assert.equal((await req('/policies',{cookie:agent,body:{agent_id:'A001'}})).status,403);
  const rows=(await req('/policies',{cookie:agent})).data.items;
  assert.ok(rows.every(p=>p.agent_id==='A006'));
  assert.equal((await req('/clients',{cookie:agent})).data.items.length,30);
});
test('录入更新计数、差额和历史；验证重复、归属、金额与非法日期',async()=>{
  const body={id:'QA-POLICY-001',agent_id:'A006',client_id:'A006C01',product:'重疾险',date:'2026-10-31',premium:'1234.56'};
  assert.equal((await req('/policies',{cookie:leader,body})).status,201);
  const me=(await req('/dashboard',{cookie:agent})).data.agents[0];
  assert.equal(me.actual,33234.56);assert.equal(me.count,6);assert.equal(me.history[5],33234.56);
  assert.equal(db.prepare('SELECT premium FROM policies WHERE id=?').get(body.id).premium,123456);
  assert.equal((await req('/policies',{cookie:leader,body})).status,409);
  for(const change of [{client_id:'A001C01'},{date:'2026-09-31'},{premium:-10},{premium:'0.001'},{premium:'Infinity'},{id:'<script>'}]){
    assert.equal((await req('/policies',{cookie:leader,body:{...body,id:'QA-POLICY-002',...change}})).status,400);
  }
});
test('按月份、成员分页，第二页不重复',async()=>{
  const a=(await req('/policies?page=1',{cookie:leader})).data,b=(await req('/policies?page=2',{cookie:leader})).data;
  assert.equal(a.items.length,10);assert.equal(b.items.length,10);assert.ok(!a.items.some(p=>b.items.some(q=>q.id===p.id)));
  const old=(await req('/dashboard?month=2026-05',{cookie:agent})).data;assert.equal(old.historyMonths.length,1);assert.equal(old.agents[0].history[0],old.agents[0].actual);
  assert.equal((await req('/dashboard?month=2027-01',{cookie:leader})).status,400);
});
test('模拟 AI 使用服务端个人上下文，忽略请求中伪造角色和数据',async()=>{
  const answer=await req('/ai/analyze',{cookie:agent,body:{question:'目标差距',role:'leader',agent_id:'A001',context:{actual:99999999}}});
  assert.equal(answer.status,200);assert.equal(answer.data.mode,'demo');assert.ok(answer.data.answer.includes('33,234.56'));assert.ok(!answer.data.answer.includes('99,999,999'));
});
test('AI 适配器仅向服务端指定地址发统计上下文，并处理服务异常',async()=>{
  const context=(await req('/dashboard',{cookie:agent})).data;let captured;
  const response=await analyze({question:'分析',context},{AI_BASE_URL:'https://example.test/v1',AI_API_KEY:'test-only',AI_MODEL:'example'},async(url,options)=>{
    captured={url:String(url),options};
    return {ok:true,json:async()=>({choices:[{message:{content:'测试分析'}}]})};
  });
  assert.equal(response.mode,'connected');assert.equal(captured.url,'https://example.test/v1/chat/completions');
  const sent=JSON.parse(JSON.parse(captured.options.body).messages[1].content).authorizedData;
  assert.deepEqual(sent.agents.map(a=>a.id),['A006']);assert.ok(!JSON.stringify(sent).includes('A001C'));
  await assert.rejects(()=>analyze({question:'分析',context},{AI_BASE_URL:'https://example.test/v1',AI_API_KEY:'test-only',AI_MODEL:'example'},async()=>({ok:false})));
});
test('注销使旧会话失效',async()=>{
  assert.equal((await req('/logout',{cookie:agent,body:{}})).status,200);
  assert.equal((await req('/dashboard',{cookie:agent})).status,401);
});


test('关闭并重新打开数据库后，保单持久保存且不会重复播种',()=>{
  const file=path.join(dir,'persist.sqlite'),first=openDatabase(file);
  addPolicy(first,{role:'leader'},{id:'PERSIST-001',agent_id:'A001',client_id:'A001C01',product:'医疗险',date:'2026-10-31',premium:'10.01'});
  const count=first.prepare('SELECT COUNT(*) n FROM policies').get().n;
  first.close();
  const reopened=openDatabase(file);
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM policies').get().n,count);
  assert.equal(reopened.prepare("SELECT premium FROM policies WHERE id='PERSIST-001'").get().premium,1001);
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM agents').get().n,3);
  reopened.close();
});
