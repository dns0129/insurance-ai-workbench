import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { problem } from './store.mjs';

export const deepseekEndpoint='https://api.deepseek.com/chat/completions';
const deepseekDefault='deepseek-flash';
const extractScript=fileURLToPath(new URL('../scripts/extract_pdf.py',import.meta.url));
function executable(bin, env) {
  for(const path of (/[\\/]/.test(bin)?[resolve(bin)]:(env.PATH||'').split(delimiter).filter(Boolean).map(dir=>resolve(dir,bin)))){
    try{accessSync(path,constants.X_OK);return path;}catch{}
  }
  return '';
}

export function runWithInput(bin,args,input,{cwd,env,timeout,maxOutput}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{cwd,env,stdio:['pipe','pipe','ignore'],windowsHide:true});
    let bytes=0;
    const output=[];
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('timeout'));},timeout);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.stdout.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>maxOutput){child.kill('SIGKILL');reject(new Error('output limit'));return;}
      output.push(chunk);
    });
    child.stdin.on('error',()=>{}); // The process may close stdin before reporting a failure.
    child.once('close',code=>{clearTimeout(timer);if(code===0)resolve(Buffer.concat(output).toString('utf8'));else reject(new Error('child exited'));});
    child.stdin.end(input);
  });
}

const pdfErrors={
  dependency:[503,'PDF 解析组件未安装，请联系工作台管理员。'],
  encrypted:[422,'PDF 有密码保护，请解除保护后重新上传。'],
  pages:[422,'PDF 需包含 1–250 页。'],
  text_limit:[422,'PDF 文字量过大，请拆分后分别上传。'],
  empty:[422,'PDF 没有可检索的文字。扫描件请先做 OCR，再上传带文字层的版本。'],
  invalid:[422,'无法读取这份 PDF，请重新导出后上传。'],
};
export async function extractPdf(pdf,env=process.env) {
  if(!/^%PDF-\d\.\d/.test(pdf.subarray(0,9).toString('ascii')))throw problem(422,'这不是有效的 PDF 文件。');
  let result;
  try{
    const {PATH,LANG,LC_ALL}=process.env;
    const python=env.KNOWLEDGE_PYTHON||'python3';
    const raw=await runWithInput(/[\\/]/.test(python)?resolve(python):python,['-I',extractScript],pdf,
      {cwd:tmpdir(),env:{PATH,LANG,LC_ALL},timeout:17000,maxOutput:5_000_000});
    result=JSON.parse(raw);
  }catch(error){if(error.code==='ENOENT')throw problem(503,'未找到 Python PDF 解析组件，请联系工作台管理员。');throw problem(422,'PDF 解析未完成，请检查文件，或拆分成较小的 PDF 后上传。');}
  if(Array.isArray(result.pages)&&result.pages.every(v=>typeof v==='string'))return result.pages;
  const [status,text]=pdfErrors[result.error]||pdfErrors.invalid;
  throw problem(status,text);
}

export function createKnowledgeProvider(env=process.env,{fetcher=fetch,run=runWithInput}={}) {
  const production=env.NODE_ENV==='production';
  if(production){
    const name=(env.DEEPSEEK_MODEL||deepseekDefault).trim(), key=env.DEEPSEEK_API_KEY?.trim();
    return {
      status:{provider:'deepseek',configured:Boolean(key&&name)},
      async complete({system,user}){
        if(!key||!name)throw problem(503,'团队 AI 尚未配置，请联系团队长。');
        const response=await fetcher(deepseekEndpoint,{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(45_000),
          headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
          body:JSON.stringify({model:name,messages:[{role:'system',content:system},{role:'user',content:user}],
            response_format:{type:'json_object'},thinking:{type:'disabled'},max_tokens:3000,temperature:0.2}),
        });
        if(!response.ok)throw new Error('model unavailable');
        const data=await response.json(),choice=data.choices?.[0];
        if(choice?.finish_reason!=='stop'||typeof choice.message?.content!=='string')throw new Error('incomplete response');
        return choice.message.content;
      },
    };
  }
  const childEnv={...process.env,...env};
  const bin=()=>executable(env.PI_AGENT_BIN||'pi',childEnv);
  const provider=env.PI_AGENT_PROVIDER||'openai';
  const model=env.PI_AGENT_MODEL||'gpt-6.1-sol';
  const clean={};
  for(const key of ['HOME','LANG','LC_ALL','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME',
    'OPENAI_API_KEY','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS']){
    if(childEnv[key])clean[key]=childEnv[key];
  }
  clean.PATH=[dirname(process.execPath),childEnv.PATH].filter(Boolean).join(delimiter);
  if(childEnv.PI_CODING_AGENT_DIR)clean.PI_CODING_AGENT_DIR=resolve(childEnv.PI_CODING_AGENT_DIR);
  let readiness,check;
  async function getStatus(){
    const command=bin();
    if(!command)return {provider:'pi',configured:false,reason:'installation'};
    if(readiness?.until>Date.now())return readiness.value;
    if(!check){
      check=(async()=>{
        let configured=false;
        try{
          const output=await run(command,['auth','check','--provider',provider,'--model',model,'--no-refresh'],'',
            {cwd:tmpdir(),env:{...clean,PI_OFFLINE:'1'},timeout:5000,maxOutput:2000});
          configured=output.trim()==='ready';
        }catch{}
        const value={provider:'pi',configured,...(!configured?{reason:'login'}:{})};
        readiness={value,until:Date.now()+(configured?30_000:5000)};
        return value;
      })().finally(()=>{check=null;});
    }
    return check;
  }
  return {
    getStatus,
    async complete({system,user}){
      const command=bin();
      if(!command)throw problem(503,'未找到 Pi Agent。请安装 Pi 并登录 ChatGPT 后重试。');
      if(!(await getStatus()).configured)throw problem(503,'Pi Agent 尚未登录 ChatGPT，登录后即可提问。');
      // Send the query over stdin so it does not appear in the process argument list.
      // No repository context, extensions, tools, MCP or saved conversations.
      const args=['--mode','json','--provider',provider,'--model',model,'--thinking','off',
        '--no-session','--no-tools','--no-extensions','--no-mcp','--no-skills',
        '--no-prompt-templates','--no-context-files','--no-approve','--system-prompt',system];
      const output=await run(command,args,user,{cwd:tmpdir(),env:clean,timeout:60_000,maxOutput:750_000});
      const lines=output.trim().split(/\r?\n/);
      let last;
      for(const line of lines){
        try{
          const event=JSON.parse(line);
          if(event.type==='message_end'&&event.message?.role==='assistant')last=event.message;
        }catch{}
      }
      if(!last||!Array.isArray(last.content)||last.stopReason!=='stop')throw new Error('Pi returned no answer');
      return last.content.filter(block=>block.type==='text').map(block=>block.text).join('\n');
    },
  };
}
