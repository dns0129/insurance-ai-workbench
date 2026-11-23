import { openDatabase } from '../db.mjs';
import { initKnowledge } from '../knowledge/store.mjs';
import { createKnowledgeProvider } from '../knowledge/providers.mjs';
import { answerKnowledge } from '../knowledge/assistant.mjs';

// Isolated: only a bundled fictional PDF and a fictional question go to the model.
const db=openDatabase(':memory:');
try{
  initKnowledge(db,{includeSamples:true});
  const provider=createKnowledgeProvider();
  const status=provider.getStatus?await provider.getStatus():provider.status;
  if(!status.configured)throw new Error('模型未就绪：'+(status.reason==='login'?'请在 Pi 中登录 ChatGPT':status.reason==='installation'?'未找到 Pi Agent':'缺少 DeepSeek 配置'));
  const result=await answerKnowledge(db,{mode:'objection',question:'客户说保费太贵，应该怎样沟通？'},{provider,includeSamples:true});
  if(result.status!=='grounded')throw new Error('返回了资料不足，没有获得可核对的回答');
  console.log(status.provider+' · '+result.promptVersion+' · '+result.title);
  console.log(result.sources.map(s=>s.name+' · 第 '+s.page+' 页').join('\n'));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{db.close();}
