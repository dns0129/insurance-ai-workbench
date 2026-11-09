import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,name TEXT NOT NULL,target INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id),name TEXT NOT NULL,age INTEGER NOT NULL,gender TEXT NOT NULL,source TEXT NOT NULL,due INTEGER NOT NULL,renewed INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS policies(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id),client_id TEXT NOT NULL REFERENCES clients(id),product TEXT NOT NULL,date TEXT NOT NULL,premium INTEGER NOT NULL CHECK(premium>0));
    CREATE INDEX IF NOT EXISTS policies_agent_date ON policies(agent_id,date);
    CREATE INDEX IF NOT EXISTS clients_agent ON clients(agent_id);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,role TEXT NOT NULL,agent_id TEXT,expires INTEGER NOT NULL);
  `);
  if(!db.prepare('SELECT COUNT(*) n FROM agents').get().n) seed(db);
  return db;
}
function seed(db){
  let state=20261106;
  const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const int=(a,b)=>a+Math.floor(random()*(b-a+1));
  const surnames=[...'王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文'];
  const given=['子涵','思远','雨桐','梓宁','嘉禾','一诺','星辰','清越','沐言','若溪','明轩','安琪','景行','舒然','文博','可欣','知夏','泽宇','亦凡','芷晴'];
  const initial=['苏晴','陈宇','许佳','张怡','何杰','林晓'];
  const agentInsert=db.prepare('INSERT INTO agents VALUES(?,?,?)');
  const clientInsert=db.prepare('INSERT INTO clients VALUES(?,?,?,?,?,?,?,?)');
  const policyInsert=db.prepare('INSERT INTO policies VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN');
  try{
    for(const i of [0,2,5]){
      const id='A'+String(i+1).padStart(3,'0'),name=initial[i]||surnames[(i-6)%surnames.length]+given[Math.floor((i-6)/surnames.length)];
      agentInsert.run(id,name,10000000);
      for(let c=0;c<30;c++){
        const cid=id+'C'+String(c+1).padStart(2,'0'),gender=c%5<3?'女':'男',due=c<16?1:0;
        clientInsert.run(cid,id,surnames[int(0,surnames.length-1)]+(gender==='女'?'女士':'先生'),int(21,65),gender,['老客转介绍','线上咨询','线下活动'][c<14?0:c<24?1:2],due,due&&c<13?1:0);
      }
      for(let m=5;m<=10;m++){
        const count=m===10?(i<6?[18,15,13,11,8,5][i]:int(3,20)):int(5,19);
        const total=m===10&&i<6?[128000,102000,82000,68000,48000,32000][i]*100:Math.round((count*int(4200,8500))/100)*10000;
        let left=total;
        for(let n=0;n<count;n++){
          const premium=n===count-1?left:Math.floor(total/count/100)*100;left-=premium;
          policyInsert.run(`PA-26${String(m).padStart(2,'0')}-${id}-${String(n+1).padStart(2,'0')}`,id,id+'C'+String(n+1).padStart(2,'0'),['重疾险','寿险','医疗险','意外险'][n%4],`2026-${String(m).padStart(2,'0')}-${String(int(1,28)).padStart(2,'0')}`,premium);
        }
      }
    }
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function dashboard(db,session,month='2026-10'){
  if(!/^2026-(0[5-9]|10)$/.test(month))throw Object.assign(new Error('请选择 2026 年 5–10 月'),{status:400});
  const agentId=session.role==='agent'?session.agent_id:null;
  const agents=db.prepare('SELECT * FROM agents '+(agentId?'WHERE id=?':'')+' ORDER BY id').all(...(agentId?[agentId]:[]));
  const totals=db.prepare(`SELECT agent_id,substr(date,1,7) month,SUM(premium) actual,COUNT(*) count FROM policies WHERE date>=? AND date<? ${agentId?'AND agent_id=?':''} GROUP BY agent_id,month`).all('2026-05-01',month+'-32',...(agentId?[agentId]:[]));
  const historyMonths=Array.from({length:Number(month.slice(5))-4},(_,i)=>'2026-'+String(i+5).padStart(2,'0'));
  const result=agents.map(a=>{
    const rows=totals.filter(t=>t.agent_id===a.id),current=rows.find(t=>t.month===month);
    return {...a,target:a.target/100,actual:(current?.actual||0)/100,count:current?.count||0,history:historyMonths.map(m=>(rows.find(r=>r.month===m)?.actual||0)/100)};
  });
  const clients=db.prepare('SELECT * FROM clients '+(agentId?'WHERE agent_id=?':'')).all(...(agentId?[agentId]:[]));
  const countBy=fn=>Object.entries(clients.reduce((s,c)=>{const k=fn(c);s[k]=(s[k]||0)+1;return s},{})).map(([label,count])=>({label,count}));
  const products=db.prepare(`SELECT product label,COUNT(*) count FROM policies WHERE substr(date,1,7)=? ${agentId?'AND agent_id=?':''} GROUP BY product`).all(month,...(agentId?[agentId]:[]));
  const due=clients.filter(c=>c.due),renewed=due.filter(c=>c.renewed);
  return {month,historyMonths,agents:result,profile:{total:clients.length,sources:countBy(c=>c.source),ages:countBy(c=>c.age<30?'18–29 岁':c.age<45?'30–44 岁':'45 岁以上'),genders:countBy(c=>c.gender),products,due:due.length,renewed:renewed.length,retention:due.length?renewed.length/due.length*100:null}};
}
export function policiesFor(db,session,url){
  const requested=url.searchParams.get('agent');
  if(session.role==='agent'&&requested&&requested!==session.agent_id)throw Object.assign(new Error('只能查看自己的保单'),{status:403});
  const agent=session.role==='agent'?session.agent_id:requested;
  const month=url.searchParams.get('month')||'2026-10',page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page'))||1));
  if(!/^2026-(0[5-9]|10)$/.test(month))throw Object.assign(new Error('月份无效'),{status:400});
  const where='WHERE substr(p.date,1,7)=?'+(agent?' AND p.agent_id=?':''),params=[month,...(agent?[agent]:[])];
  const total=db.prepare('SELECT COUNT(*) n FROM policies p '+where).get(...params).n;
  const items=db.prepare(`SELECT p.*,a.name agent,c.name customer FROM policies p JOIN agents a ON a.id=p.agent_id JOIN clients c ON c.id=p.client_id ${where} ORDER BY p.date DESC,p.id DESC LIMIT 10 OFFSET ?`).all(...params,(page-1)*10).map(p=>({...p,premium:p.premium/100}));
  return {items,total,page,pages:Math.max(1,Math.ceil(total/10))};
}
export function addPolicy(db,session,body){
  if(session.role!=='leader')throw Object.assign(new Error('只有团队长可以录入保单'),{status:403});
  const {id,agent_id,client_id,product,date}=body,raw=String(body.premium??'');
  const dateObj=new Date(date+'T00:00:00Z');
  if(typeof id!=='string'||!/^[-A-Za-z0-9]{3,40}$/.test(id)||!['重疾险','寿险','医疗险','意外险'].includes(product)||!/^2026-(0[5-9]|10)-\d{2}$/.test(date||'')||!Number.isFinite(dateObj.getTime())||dateObj.toISOString().slice(0,10)!==date||!/^\d{1,8}(\.\d{1,2})?$/.test(raw)||Number(raw)<=0||Number(raw)>10000000)throw Object.assign(new Error('请填写有效保单号、险种、日期和金额（最多两位小数）'),{status:400});
  if(!db.prepare('SELECT id FROM clients WHERE id=? AND agent_id=?').get(client_id||'',agent_id||''))throw Object.assign(new Error('客户不属于所选代理人'),{status:400});
  if(db.prepare('SELECT id FROM policies WHERE lower(id)=lower(?)').get(id))throw Object.assign(new Error('该保单号已存在，请勿重复录入'),{status:409});
  db.prepare('INSERT INTO policies VALUES(?,?,?,?,?,?)').run(id,agent_id,client_id,product,date,Math.round(Number(raw)*100));
  return {id};
}
