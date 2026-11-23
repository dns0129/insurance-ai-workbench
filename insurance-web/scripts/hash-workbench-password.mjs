// Read the password from stdin, so it is not included in shell history or arguments.
import { hashPassword } from '../workbench-auth.mjs';
try{
  process.stdin.setEncoding('utf8');
  let password='';
  for await(const chunk of process.stdin){
    password+=chunk;
    if(password.length>202)throw new Error('密码过长。');
  }
  console.log(await hashPassword(password.replace(/\r?\n$/,'')));
}catch(error){console.error(error.message);process.exitCode=1;}
