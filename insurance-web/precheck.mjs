import { randomUUID } from 'node:crypto';

const examples = [
  {
    id: 'demo-medical', title: '虚构医疗保障', example: ['application','identity'],
    items: [
      ['application','投保申请表','核对基本栏目是否填写。',true],
      ['identity','身份资料说明','确认示例身份资料已准备。',true],
      ['occupation','职业及工作内容说明','说明日常工作职责，留待人工核对。',true],
      ['health','健康告知表','核对表格是否齐备，页面不收集健康信息。',true],
      ['extra','补充说明','如有额外情况，可另行准备说明。',false],
    ],
  },
  {
    id: 'demo-family', title: '虚构家庭保障', example: ['application','occupation'],
    items: [
      ['application','投保申请表','核对签署栏与资料栏目。',true],
      ['occupation','职业及工作内容说明','核对工作内容说明是否已准备。',true],
      ['residence','居住状况说明','核对需要说明的居住情况。',true],
      ['finance','财务资料说明','核对资料范围，页面不收集真实财务信息。',true],
      ['extra','其他附件清单','记下可能需要补充的文件。',false],
    ],
  },
];
const fail = (status,message) => { throw Object.assign(new Error(message),{status}); };

export function initPrecheck(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS precheck_templates(
    id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version>0),
    items TEXT NOT NULL,
    PRIMARY KEY (id,version)
  )`);
  const insert=db.prepare('INSERT OR IGNORE INTO precheck_templates VALUES (?,1,?)');
  for(const {id,items} of examples)insert.run(id,JSON.stringify(items.map(([id,name,note,required])=>({id,name,note,required}))));
}

function template(db,id) {
  const demo=examples.find(entry=>entry.id===id);
  if(!demo)fail(404,'找不到该虚构清单。');
  const row=db.prepare('SELECT version,items FROM precheck_templates WHERE id=? ORDER BY version DESC LIMIT 1').get(id);
  const items=JSON.parse(row.items);
  return {id,title:demo.title,version:row.version,items,example:demo.example.filter(id=>items.some(item=>item.id===id))};
}

export function precheckTemplates(db) {
  return {items:examples.map(d=>template(db,d.id))};
}

function currentTemplate(db,body) {
  const current=template(db,body?.id);
  if(body.version!==current.version)fail(409,'团队长已更新清单，请按最新版本重新核对。');
  return current;
}

export function savePrecheckTemplate(db,session,body) {
  if(session.role!=='leader')fail(403,'只有团队长可以维护材料清单。');
  const current=currentTemplate(db,body);
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>16)fail(400,'每份清单需要 1 至 16 项材料。');
  const names=new Set(),ids=new Set();
  const items=body.items.map(row=>{
    if(typeof row?.name!=='string'||typeof row.note!=='string'||typeof row.required!=='boolean')fail(400,'材料名称、说明或必备状态不完整。');
    const name=row.name.trim(),note=row.note.trim(),key=name.normalize('NFKC').toLowerCase();
    if(!name||name.length>60||note.length>160||/[\u0000-\u001f\u007f]/.test(name+note))fail(400,'请填写有效的材料名称（最多 60 字）和说明（最多 160 字）。');
    if(names.has(key))fail(400,'同一份清单中的材料名称不能重复。');
    names.add(key);
    const id=row.id??randomUUID();
    if(row.id!=null&&!current.items.some(item=>item.id===id)||ids.has(id))fail(400,'材料条目无效，请重新加载清单。');
    ids.add(id);
    return {id,name,note,required:row.required};
  });
  if(!items.some(item=>item.required))fail(400,'清单至少需要一项必备材料。');
  if(JSON.stringify(items)===JSON.stringify(current.items))return current;
  db.prepare('INSERT INTO precheck_templates VALUES (?,?,?)').run(current.id,current.version+1,JSON.stringify(items));
  return template(db,current.id);
}

export function exportPrecheck(db,session,body) {
  if(session.role!=='agent')fail(403,'请使用代理人账号核对和导出。');
  if(body?.confirmed!==true)fail(400,'请先人工确认本次核对状态。');
  const current=currentTemplate(db,body);
  if(!Array.isArray(body.checked)||body.checked.length>current.items.length||
    new Set(body.checked).size!==body.checked.length||body.checked.some(id=>!current.items.some(item=>item.id===id)))fail(400,'勾选内容与当前清单不一致。');
  const checked=new Set(body.checked);
  const missing=current.items.filter(item=>item.required&&!checked.has(item.id)).length;
  const reviewer=db.prepare('SELECT name FROM agents WHERE id=?').get(session.agent_id)?.name;
  if(!reviewer)fail(403,'找不到当前代理人。');
  const result=[
    '保顾智库｜投保资料预检记录（虚构演示）',
    '清单：'+current.title+' · 第 '+current.version+' 版',
    '确认人：'+reviewer+'（'+session.agent_id+'）',
    '确认时间（香港）：'+new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',dateStyle:'medium',timeStyle:'medium'}).format(new Date()),
    '核对结果：'+(missing?'待补 '+missing+' 项必备资料':'必备资料已勾选，仍需人工审阅'),
    '',
    ...current.items.map((item,i)=> (i+1)+'. '+item.name+'｜'+(item.required?'必备':'选备')+'｜'+(checked.has(item.id)?'已备':item.required?'待补':'未勾选')+(item.note?'｜'+item.note:'')),
    '',
    '本记录仅演示资料核对，不是正式投保文件或核保结论。'
  ].join('\r\n');
  return {filename:current.id+'-v'+current.version+'-预检记录.txt',text:result};
}
