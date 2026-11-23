import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase,dashboard,policiesFor,addPolicy } from './db.mjs';
import { analyze,aiStatus } from './ai.mjs';
import { initPrecheck,precheckTemplates,savePrecheckTemplate,exportPrecheck } from './precheck.mjs';
import { demoEmployment,personalDemo } from './personal-demo.mjs';
import { setupAuth } from './workbench-auth.mjs';
import { answerKnowledge } from './knowledge/assistant.mjs';
import { createKnowledgeProvider,extractPdf } from './knowledge/providers.mjs';
import { initKnowledge,listKnowledge,validateUpload,uploadLimits,saveKnowledge,changeKnowledge,deleteKnowledge,
  getKnowledgeFile,searchKnowledge,maxPdfBytes,problem } from './knowledge/store.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
async function readBody(req,limit){
  const tooLarge=()=>problem(413,limit===maxPdfBytes?'PDF 不能超过 15 MB。':'请求过大');
  if(Number(req.headers['content-length'])>limit){req.resume();throw tooLarge();}
  let size=0;
  const chunks=[];
  for await(const chunk of req.iterator({destroyOnReturn:false})){
    size+=chunk.length;
    if(size>limit){req.resume();throw tooLarge();}
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}
async function readJSON(req){
  const raw=await readBody(req,16_000);
  try{
    const body=JSON.parse(raw.toString('utf8')||'{}');
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();
    return body;
  }catch{throw problem(400,'请求格式错误');}
}
const knowledgeFileRoute=/^\/api\/knowledge\/documents\/((?:demo-[a-z]+)|[a-f0-9-]{36})(?:\/(file))?$/;
const pdfAssetRoute=/^\/pdfjs\/(pdf(?:\.worker)?\.min\.mjs|cmaps\/[\w-]+\.bcmap|standard_fonts\/[\w-]+\.(?:pfb|ttf)|iccs\/[\w-]+\.icc|wasm\/[\w-]+\.(?:wasm|js))$/;
export function createApp({env=process.env,dbPath=env.WORKBENCH_DB_PATH||path.join(here,'data','insurance.sqlite'),
  knowledgeProvider=createKnowledgeProvider(env)}={}){
  const db=openDatabase(dbPath),json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  let auth;
  try{auth=setupAuth(env,db);initPrecheck(db);initKnowledge(db,{includeSamples:!auth.production});}
  catch(error){db.close();throw error;}
  const knowledgeScope={includeSamples:!auth.production};
  const suffix=auth.production?'; Secure':'';
  const cookiePattern=auth.production?/(?:^|;\s*)insurance_session=(p_[a-f0-9]{64})(?=;|$)/:/(?:^|;\s*)insurance_session=([a-f0-9]{64})(?=;|$)/;
  const teamQuestions=new Set();
  let imports=0;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','same-origin');
    try{
      const url=new URL(req.url,'http://localhost'),route=url.pathname;
      if(route.startsWith('/api/')){
        const mutating=['POST','PATCH','DELETE'].includes(req.method);
        if(mutating&&req.headers.origin&&req.headers.origin!==(auth.origin||'http://'+req.headers.host)){req.resume();return json(res,403,{error:'来源校验失败'});}
        const token=cookiePattern.exec(req.headers.cookie||'')?.[1];
        const session=token?db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(token,Date.now()):null;
        if(route==='/api/demo-accounts'&&req.method==='GET')return json(res,200,auth.production?{agents:[],demo:false}:{agents:db.prepare('SELECT id,name FROM agents ORDER BY id').all().map(agent=>({...agent,demoEmployment:demoEmployment(agent.id)})),demo:true});
        if(route==='/api/login'&&req.method==='POST'){
          let actor=await readJSON(req);
          if(auth.production)actor=await auth.authenticate(actor,req.socket.remoteAddress);
          else if(!['leader','agent'].includes(actor.role)||actor.role==='agent'&&!db.prepare('SELECT id FROM agents WHERE id=?').get(typeof actor.agent_id==='string'?actor.agent_id:''))return json(res,400,{error:'请选择有效的演示账号'});
          if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(token);
          db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
          const key=(auth.production?'p_':'')+randomBytes(32).toString('hex');
          const lifetime=auth.lifetime||86_400_000;
          db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(key,actor.role,actor.role==='agent'?actor.agent_id:null,Date.now()+lifetime);
          res.setHeader('Set-Cookie','insurance_session='+key+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+lifetime/1000+suffix);
          return json(res,200,{ok:true});
        }
        if(!session){req.resume();return json(res,401,{error:'请先登录工作台'});}
        const leader=session.role==='leader';
        if(route==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);res.setHeader('Set-Cookie','insurance_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+suffix);return json(res,200,{ok:true});}
        if(route==='/api/me'&&req.method==='GET')return json(res,200,{role:session.role,agent_id:session.agent_id,name:leader?'周宁':db.prepare('SELECT name FROM agents WHERE id=?').get(session.agent_id).name,ai:aiStatus(env)});
        if(route==='/api/knowledge/documents'&&req.method==='GET')return json(res,200,{documents:listKnowledge(db,{leader,...knowledgeScope}),ai:knowledgeProvider.getStatus?await knowledgeProvider.getStatus():knowledgeProvider.status});
        if(route==='/api/knowledge/documents'&&req.method==='POST'){
          if(!leader){req.resume();throw problem(403,'只有团队长可以上传资料。');}
          if(req.headers['content-type']!=='application/pdf'){req.resume();throw problem(415,'请上传 PDF 文件。');}
          const info=validateUpload(url.searchParams.get('name'),url.searchParams.get('category'));
          if(imports>=2){req.resume();throw problem(429,'正在处理其他 PDF，请稍后再上传。');}
          imports++;
          try{
            const pdf=await readBody(req,maxPdfBytes);
            uploadLimits(db,pdf);
            const pages=await extractPdf(pdf,env);
            return json(res,201,{document:saveKnowledge(db,{...info,pdf,pages})});
          }finally{imports--;}
        }
        if(route==='/api/knowledge/search'&&req.method==='GET'){
          if(!leader)throw problem(403,'只有团队长可以试查知识库。');
          const question=url.searchParams.get('q')?.trim();
          if(!question||question.length>200)throw problem(400,'请输入 1–200 字的检索问题。');
          const matches=searchKnowledge(db,url.searchParams.get('category'),question,knowledgeScope);
          return json(res,200,{matches});
        }
        const docRoute=knowledgeFileRoute.exec(route);
        if(docRoute){
          const [,id,file]=docRoute;
          if(file&&req.method==='GET'){
            const item=getKnowledgeFile(db,id,{...knowledgeScope,leader});
            const name=encodeURIComponent(item.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
            const disposition=url.searchParams.get('download')==='1'?'attachment':'inline';
            res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'private, no-store',
              'Content-Disposition':disposition+"; filename*=UTF-8''"+name,'Content-Length':item.pdf.byteLength});
            return res.end(item.pdf);
          }
          if(!file&&['PATCH','DELETE'].includes(req.method)){
            if(!leader){req.resume();throw problem(403,'只有团队长可以管理资料。');}
            if(req.method==='PATCH')return json(res,200,{document:changeKnowledge(db,id,await readJSON(req),knowledgeScope)});
            deleteKnowledge(db,id);return json(res,200,{ok:true});
          }
        }
        if(route==='/api/knowledge/ask'&&req.method==='POST'){
          const scope=session.role+':'+(session.agent_id||'leader');
          if(teamQuestions.has(scope)||teamQuestions.size>=4){req.resume();throw problem(429,'团队 AI 正在整理回答，请稍后重试。');}
          teamQuestions.add(scope);
          try{return json(res,200,await answerKnowledge(db,await readJSON(req),{provider:knowledgeProvider,...knowledgeScope}));}
          finally{teamQuestions.delete(scope);}
        }
        const body=req.method==='POST'?await readJSON(req):{};
        if(route==='/api/dashboard'&&req.method==='GET'){
          const result=dashboard(db,session,url.searchParams.get('month')||'2026-10');
          if(session.role==='agent')result.personal=personalDemo(session,result.month);
          return json(res,200,result);
        }
        if(route==='/api/precheck/templates'&&req.method==='GET')return json(res,200,precheckTemplates(db));
        if(route==='/api/precheck/templates'&&req.method==='POST')return json(res,200,savePrecheckTemplate(db,session,body));
        if(route==='/api/precheck/export'&&req.method==='POST')return json(res,200,exportPrecheck(db,session,body));
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
      const pdfAsset=pdfAssetRoute.exec(route)?.[1];
      if(pdfAsset){
        const extension=path.extname(pdfAsset);
        const type=extension==='.wasm'?'application/wasm':['.mjs','.js'].includes(extension)?'text/javascript; charset=utf-8':'application/octet-stream';
        const data=await readFile(path.join(here,'vendor','pdfjs',pdfAsset)).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
        if(!data)return json(res,404,{error:'页面不存在'});
        res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'");
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});
        return res.end(data);
      }
      const files={'/':'index.html','/app.js':'app.js','/app.css':'app.css','/personal-progress.js':'personal-progress.js','/personal-progress.css':'personal-progress.css','/precheck.js':'precheck.js','/precheck.css':'precheck.css','/assistants.js':'assistants.js','/pdf-preview.js':'pdf-preview.js','/assistants.css':'assistants.css','/ai-reply.js':'ai-reply.js','/ai-reply.css':'ai-reply.css','/demo/medical.pdf':'demo/medical.pdf','/demo/critical.pdf':'demo/critical.pdf','/demo/team-guide.pdf':'demo/team-guide.pdf','/demo/objections.pdf':'demo/objections.pdf','/fonts/round-regular.woff':'fonts/round-regular.woff','/fonts/round-bold.woff':'fonts/round-bold.woff','/fonts/round-supplement-regular.woff2':'fonts/round-supplement-regular.woff2','/fonts/round-supplement-bold.woff2':'fonts/round-supplement-bold.woff2','/fonts/LICENSE.md':'fonts/LICENSE.md'};
      if(auth.production&&route.startsWith('/demo/'))return json(res,404,{error:'页面不存在'});
      if(!files[route])return json(res,404,{error:'页面不存在'});
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff':'font/woff','.woff2':'font/woff2','.md':'text/plain; charset=utf-8','.pdf':'application/pdf'};
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
      const data=await readFile(path.join(here,'public',files[route]));res.writeHead(200,{'Content-Type':types[path.extname(files[route])],'Cache-Control':'no-cache'});res.end(data);
    }catch(error){if(res.destroyed||res.headersSent)return;req.resume();json(res,error.status||500,{error:error.status?error.message:'服务处理失败，请稍后重试'});}
  });
  server.on('close',()=>db.close());
  return {server,db};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{host:{type:'string'},port:{type:'string'},strictPort:{type:'boolean'}},strict:true});
  const {server}=createApp();server.listen(Number(values.port||process.env.PORT||4387),values.host||process.env.HOST||'127.0.0.1',()=>console.log('Local: http://localhost:'+server.address().port));
}
