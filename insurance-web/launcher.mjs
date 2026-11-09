import { createApp } from './server.mjs';
import { execFile } from 'node:child_process';
const port=Number(process.env.PORT||4387),host=process.env.HOST||'127.0.0.1';
const url='http://localhost:'+port;
try{
  const response=await fetch(url+'/api/demo-accounts',{signal:AbortSignal.timeout(800)});
  const body=await response.json();
  if(body.demo&&body.agents?.length===3){
    console.log('工作台已启动：'+url);
    execFile('open',[url]);
  }else throw new Error('not running');
}catch{
  const {server}=createApp();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口被占用，请在 .env 中修改 PORT。':error.message);process.exitCode=1;});
  server.listen(port,host,()=>{console.log('工作台已启动：'+url+'\n关闭本窗口会停止服务，数据仍保存在 data 文件夹。');execFile('open',[url]);});
}
