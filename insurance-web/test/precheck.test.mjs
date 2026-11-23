import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

test('团队长发布版本，代理人只能按最新版确认导出',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'insurance-precheck-'));
  const dbPath=join(dir,'test.sqlite');
  let server;
  async function start(){
    ({server}=createApp({dbPath,env:{}}));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  }
  async function request(path,{cookie='',body}={}){
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{
      method:body?'POST':'GET',headers:{'content-type':'application/json',cookie},...(body?{body:JSON.stringify(body)}:{})
    });
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    await start();
    const leader=(await request('/login',{body:{role:'leader'}})).cookie;
    const agent=(await request('/login',{body:{role:'agent',agent_id:'A006'}})).cookie;
    const list='/precheck/templates',exportPath='/precheck/export';
    assert.equal((await request(list)).status,401);
    const [old]= (await request(list,{cookie:agent})).data.items;
    const patch={id:old.id,version:old.version,items:[...old.items,{name:'演示职业说明附件',note:'仅演示',required:true}]};
    assert.equal((await request(list,{cookie:agent,body:patch})).status,403);
    assert.equal((await request(list,{cookie:leader,body:{...patch,items:patch.items.map(i=>({...i,required:false}))}})).status,400);
    assert.equal((await request(list,{cookie:leader,body:{...patch,items:[...old.items,old.items[0]]}})).status,400);
    const saved=await request(list,{cookie:leader,body:patch});
    assert.equal(saved.status,200);
    assert.equal(saved.data.version,2);
    assert.equal((await request(list,{cookie:leader,body:patch})).status,409);
    const input={id:old.id,version:old.version,checked:old.example,confirmed:true};
    assert.equal((await request(exportPath,{cookie:agent,body:input})).status,409);
    const fresh=(await request(list,{cookie:agent})).data.items[0];
    assert.equal(fresh.items.at(-1).name,'演示职业说明附件');
    const freshInput={...input,version:fresh.version};
    assert.equal((await request(exportPath,{cookie:agent,body:{...freshInput,confirmed:false}})).status,400);
    assert.equal((await request(exportPath,{cookie:leader,body:freshInput})).status,403);
    assert.equal((await request(exportPath,{cookie:agent,body:{...freshInput,checked:['invalid']}})).status,400);
    const exported=await request(exportPath,{cookie:agent,body:{...freshInput,agent_id:'A001'}});
    assert.equal(exported.status,200);
    assert.match(exported.data.text,/确认人：林晓（A006）/);
    assert.match(exported.data.text,/演示职业说明附件｜必备｜待补/);
    assert.match(exported.data.text,/补充说明｜选备｜未勾选/);
    await new Promise(resolve=>server.close(resolve));server=null;
    await start();
    assert.equal((await request(list,{cookie:agent})).data.items[0].version,2);
  }finally{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
