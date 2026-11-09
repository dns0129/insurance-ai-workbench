import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDatabase,dashboard,policiesFor,addPolicy } from './db.mjs';
import { analyze,aiStatus } from './ai.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export function createApp({dbPath=path.join(here,'data','insurance.sqlite'),env=process.env}={}){
  const db=openDatabase(dbPath),json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','same-origin');
    const url=new URL(req.url,'http://localhost'),route=url.pathname;
    try{
      if(route.startsWith('/api/')){
        if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'来源校验失败'});
        let body={};
        if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)throw Object.assign(new Error('请求过大'),{status:413});}try{body=JSON.parse(raw||'{}')}catch{throw Object.assign(new Error('请求格式错误'),{status:400})}}
        const token=/(?:^|;\s*)insurance_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];
        const session=token?db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(token,Date.now()):null;
        if(route==='/api/demo-accounts'&&req.method==='GET')return json(res,200,{agents:db.prepare('SELECT id,name FROM agents ORDER BY id').all(),demo:true});
        if(route==='/api/login'&&req.method==='POST'){
          if(!['leader','agent'].includes(body.role)||body.role==='agent'&&!db.prepare('SELECT id FROM agents WHERE id=?').get(body.agent_id||''))return json(res,400,{error:'请选择有效的演示账号'});
          if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(token);
          db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
          const key=randomBytes(32).toString('hex');
          db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(key,body.role,body.role==='agent'?body.agent_id:null,Date.now()+86400000);
          res.setHeader('Set-Cookie',`insurance_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
          return json(res,200,{ok:true});
        }
        if(!session)return json(res,401,{error:'请先选择演示账号登录'});
        if(route==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);res.setHeader('Set-Cookie','insurance_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
        if(route==='/api/me'&&req.method==='GET')return json(res,200,{role:session.role,agent_id:session.agent_id,name:session.role==='leader'?'周宁':db.prepare('SELECT name FROM agents WHERE id=?').get(session.agent_id).name,ai:aiStatus(env)});
        if(route==='/api/dashboard'&&req.method==='GET')return json(res,200,dashboard(db,session,url.searchParams.get('month')||'2026-10'));
        if(route==='/api/policies'&&req.method==='GET')return json(res,200,policiesFor(db,session,url));
        if(route==='/api/policies'&&req.method==='POST')return json(res,201,addPolicy(db,session,body));
        if(route==='/api/clients'&&req.method==='GET'){
          const requested=url.searchParams.get('agent'),id=session.role==='agent'?session.agent_id:requested;
          if(session.role==='agent'&&requested&&requested!==session.agent_id)return json(res,403,{error:'只能查看自己的客户'});
          if(!id)return json(res,400,{error:'请选择代理人'});
          return json(res,200,{items:db.prepare('SELECT id,name,age,gender,source FROM clients WHERE agent_id=? ORDER BY id').all(id)});
        }
        if(route==='/api/ai/analyze'&&req.method==='POST'){
          if(typeof body.question!=='string'||!body.question.trim()||body.question.length>1000)return json(res,400,{error:'请输入 1–1000 字的问题'});
          const context=dashboard(db,session,body.month||'2026-10');
          // context 永远从服务端会话生成，忽略客户端提交的角色、人员和统计数据。
          try{return json(res,200,await analyze({question:body.question,context},env));}catch{return json(res,502,{error:'AI 服务暂时不可用，请检查服务地址、模型和密钥后重试'});}
        }
        return json(res,404,{error:'接口不存在'});
      }
      if(req.method!=='GET')return json(res,405,{error:'不支持的请求方式'});
      const files={'/':'index.html','/app.js':'app.js','/app.css':'app.css','/fonts/round-regular.woff':'fonts/round-regular.woff','/fonts/round-bold.woff':'fonts/round-bold.woff','/fonts/LICENSE.md':'fonts/LICENSE.md'};
      if(!files[route])return json(res,404,{error:'页面不存在'});
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff':'font/woff','.md':'text/plain; charset=utf-8'};
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
      const data=await readFile(path.join(here,'public',files[route]));res.writeHead(200,{'Content-Type':types[path.extname(files[route])],'Cache-Control':'no-cache'});res.end(data);
    }catch(error){json(res,error.status||500,{error:error.status?error.message:'服务处理失败，请稍后重试'});}
  });
  server.on('close',()=>db.close());
  return {server,db};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {server}=createApp();server.listen(Number(process.env.PORT||4387),process.env.HOST||'127.0.0.1',()=>console.log('Local: http://localhost:'+server.address().port));
}
