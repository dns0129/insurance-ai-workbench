import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { problem } from './knowledge/store.mjs';

const derive=promisify(scrypt);
const usernamePattern=/^[a-z0-9._@-]{3,100}$/;
const lifetime=12*60*60*1000;
const usernameOf=value=>typeof value==='string'?value.trim().toLowerCase():'';
const params={N:32768,r:8,p:1,maxmem:64*1024**2};

export async function hashPassword(password) {
  if(typeof password!=='string'||password.length<14||password.length>200)throw new Error('请使用 14–200 字符的独立密码。');
  const salt=randomBytes(16);
  const hash=await derive(password,salt,64,params);
  return 'scrypt$'+salt.toString('hex')+'$'+hash.toString('hex');
}

export function setupAuth(env,db){
  const production=env.NODE_ENV==='production';
  if(!production)return {production};
  let origin;
  try{
    const url=new URL(env.WORKBENCH_PUBLIC_ORIGIN);
    if(url.protocol!=='https:'||url.origin!==env.WORKBENCH_PUBLIC_ORIGIN)throw new Error();
    origin=url.origin;
  }catch{throw new Error('生产模式需要 WORKBENCH_PUBLIC_ORIGIN=https://你的工作台域名（不含路径或末尾斜杠）。');}
  let data;
  try{data=JSON.parse(readFileSync(env.WORKBENCH_ACCOUNTS_FILE,'utf8'));}
  catch{throw new Error('生产模式需要可读的 WORKBENCH_ACCOUNTS_FILE。');}
  if(!Array.isArray(data)||!data.length||data.length>200)throw new Error('生产账号配置须为 1–200 个账号的 JSON 数组。');
  const users=new Map();
  for(const row of data){
    const username=usernameOf(row?.username);
    const hash=/^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(row?.passwordHash||'');
    const validRole=row?.role==='leader'||row?.role==='agent'&&typeof row.agent_id==='string'&&db.prepare('SELECT 1 FROM agents WHERE id=?').get(row.agent_id);
    if(!usernamePattern.test(username)||users.has(username)||!hash||!validRole)throw new Error('生产账号配置有重复账号、无效密码哈希、角色或代理人编号。');
    users.set(username,{role:row.role,agent_id:row.role==='agent'?row.agent_id:null,salt:Buffer.from(hash[1],'hex'),hash:Buffer.from(hash[2],'hex')});
  }
  if(![...users.values()].some(value=>value.role==='leader'))throw new Error('生产账号配置至少需要一个团队长。');
  const unknown={salt:randomBytes(16),hash:randomBytes(64)};
  const attempts=new Map();
  let inFlight=0;
  async function authenticate(body,address){
    const username=usernameOf(body.username), password=typeof body.password==='string'?body.password:'';
    if(!usernamePattern.test(username)||password.length>200||!password)throw problem(401,'账号或密码不正确。');
    const now=Date.now(), bucket=(address||'local')+'|'+(users.has(username)?username:'?');
    for(const [key,v] of attempts)if(v.until<=now)attempts.delete(key);
    const counter=attempts.get(bucket)||{hits:0,until:now+5*60*1000};
    if(counter.hits>=12||attempts.size>=4000&&!attempts.has(bucket)||inFlight>=4)throw problem(429,'登录尝试过多，请稍后再试。');
    counter.hits++;attempts.set(bucket,counter);inFlight++;
    const actor=users.get(username),target=actor||unknown;
    const authenticated=await derive(password,target.salt,64,params)
      .then(hash=>timingSafeEqual(hash,target.hash))
      .finally(()=>inFlight--);
    if(!actor||!authenticated)throw problem(401,'账号或密码不正确。');
    attempts.delete(bucket);
    return actor;
  }
  return {production,origin,lifetime,authenticate};
}
