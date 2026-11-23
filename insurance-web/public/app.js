const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'¥'+Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
const compactMoney=n=>n>=1000000?'¥'+(n/10000).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 万':money(n);
const pct=n=>n===null?'—':Number(n).toFixed(1)+'%';
const rate=a=>a.actual/a.target*100,gap=a=>Math.max(0,a.target-a.actual);
let me=null,data=null,selected='',memberPage=1,policyPage=1,clientPage=1,search='',status='all',orders=null,clients=[],chartObserver,loadVersion=0,clientVersion=0,aiAnswer=null,aiBusy=null,noticeTimer,activePage="overview";
let demoLogin=true;
const isLeader=()=>me?.role==='leader';
async function api(url,options={}){
  const response=await fetch('/api'+url,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const body=await response.json();
  if(!response.ok){if(response.status===401&&me){showLogin();}throw Object.assign(new Error(body.error||'请求失败'),{status:response.status});}
  return body;
}
function notify(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,5000);}
function showLogin(){window.InsuranceAssistants.reset();window.InsurancePrecheck.reset();$("insurance-ops").dataset.state="login";delete $('insurance-ops').dataset.page;activePage="overview";loadVersion++;me=null;data=null;orders=null;clients=[];selected='';aiAnswer=aiBusy=null;$('workspace').hidden=true;$('workspace-actions').hidden=true;$('login').hidden=false;$('io-content').replaceChildren();$('switch-account').hidden=true;$('role-label').textContent=demoLogin?'3 人团队演示':'团队成员登录';chartObserver?.disconnect();}
const options=agents=>agents.map(a=>`<option value="${a.id}">${esc(a.name)}${a.demoEmployment?' · '+esc(a.demoEmployment)+'演示':''} · ${a.id}</option>`).join('');
const head=(title,subtitle='',extra='')=>`<div class="panelhead"><div><h2>${title}</h2><p>${subtitle}</p></div>${extra}</div>`;
const track=(value,red=false)=>`<span class="track" aria-hidden="true"><span class="${red?'dangerfill':''}" style="width:${Math.min(100,value)}%"></span></span>`;
function aggregate(){return data.agents.reduce((s,a)=>({name:'全团队',target:s.target+a.target,actual:s.actual+a.actual,count:s.count+a.count,history:s.history.map((v,i)=>v+a.history[i])}),{target:0,actual:0,count:0,history:data.historyMonths.map(()=>0)});}
function statCards(){
  const a=aggregate();
  const cards=[
    ['团队首年保费',compactMoney(a.actual),'本月已生效保单'],['月度目标达成率',pct(rate(a)),'目标 '+money(a.target)],['距离团队目标',compactMoney(gap(a)),'按团队总业绩计算'],['团队开单',a.count+' 单','共 '+data.agents.length+' 位代理人']
  ];
  return `<div class="stats">${cards.map(([label,value,note,red])=>`<div class="stat"><div class="stat-label">${label}</div><div class="stat-value ${red?'red':''}">${value}</div><small>${note}</small></div>`).join('')}</div>`;
}



function pager(name,page,total,size=10){const pages=Math.max(1,Math.ceil(total/size));return `<div class="pager"><span>共 ${total} 条 · 第 ${page} / ${pages} 页</span><button class="quiet" data-page="${name}" data-step="-1" ${page<=1?'disabled':''}>上一页</button><button class="quiet" data-page="${name}" data-step="1" ${page>=pages?'disabled':''}>下一页</button></div>`;}

function members(){return `<section class="panel full" id="members">${head('团队成员','选择成员，查看对应业绩走势与保单','<span class="count">3 位代理人</span>')}<div class="toolbar"><input id="member-search" aria-label="搜索成员姓名或编号" placeholder="搜索姓名 / 成员编号" value="${esc(search)}"><select id="member-status" aria-label="成员状态"><option value="all">全部状态</option><option value="warning">重点注意（低于 60%）</option><option value="unmet">所有未达标成员</option><option value="met">已达标</option></select><button class="quiet" data-action="all-team">查看全团队走势</button></div><div id="member-results">${memberRows()}</div></section>`;}
function profilePanels(){
  const p=data.profile,rows=(values,total)=>values.map(v=>`<div class="barrow"><span>${esc(v.label)}</span>${track(v.count/total*100)}<strong class="num">${pct(v.count/total*100)}</strong></div>`).join('');
  const list=values=>values.map(v=>`<div><span>${esc(v.label)}</span><strong>${v.count} 位</strong></div>`).join('');
  return `<div class="duo"><section class="panel">${head('客户来源与留存','客户档案 '+p.total+' 位 · 按首次获客渠道归类')}<div class="distribution">${rows(p.sources,p.total)}</div><div class="chartmeta"><span>近 12 个月留存率 ${pct(p.retention)}</span><span>${p.renewed} / ${p.due} 位到期客户续保</span></div></section><section class="panel">${head('客户画像','险种按本月保单；年龄与性别按客户档案')}<div class="profilegrid"><div><h3>购买险种</h3><div class="subrow">${p.products.map(v=>`<div><span>${esc(v.label)}</span><strong>${v.count} 单</strong></div>`).join('')}</div></div><div class="democol"><h3>年龄 · 性别</h3><div class="subrow">${list([...p.ages].sort((a,b)=>parseInt(a.label)-parseInt(b.label)))}${list(p.genders)}</div></div></div></section></div>`;
}
function policyTable(){
  if(!orders)return '<p class="empty">正在加载保单…</p>';
  const who=data.agents.find(a=>a.id===selected);
  const filter=isLeader()?`<div class="toolbar"><label for="policy-agent">代理人</label><select id="policy-agent"><option value="">全团队</option>${data.agents.map(a=>`<option value="${a.id}" ${selected===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div>`:'';
  return filter+head(isLeader()?(who?esc(who.name)+' · 开单明细':'团队开单明细'):'我的开单明细',data.month+' · 已生效保单',`<span class="count">${orders.total} 单</span>`)+`<div class="tablewrap"><table aria-label="保单明细"><thead><tr><th>保单号</th>${isLeader()?'<th>代理人</th>':''}<th>客户</th><th>险种</th><th>开单日期</th><th class="num">首年保费</th><th>状态</th></tr></thead><tbody>${orders.items.map(p=>`<tr><td>${esc(p.id)}</td>${isLeader()?`<td>${esc(p.agent)}</td>`:''}<td>${esc(p.customer)}</td><td>${esc(p.product)}</td><td>${p.date}</td><td class="num">${money(p.premium)}</td><td><span class="status">已生效</span></td></tr>`).join('')}</tbody></table>${orders.items.length?'':'<p class="empty">本月暂无保单</p>'}</div>${pager('policies',policyPage,orders.total)}`;
}
function clientTable(){return head('我的客户档案','仅当前账号名下客户')+`<div class="tablewrap"><table aria-label="客户档案"><thead><tr><th>客户编号</th><th>客户</th><th>年龄</th><th>性别</th><th>客户来源</th></tr></thead><tbody>${clients.slice((clientPage-1)*10,clientPage*10).map(c=>`<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${c.age} 岁</td><td>${c.gender}</td><td>${esc(c.source)}</td></tr>`).join('')}</tbody></table></div>${pager('clients',clientPage,clients.length)}`;}

async function load(){
  const version=++loadVersion,month=$('month').value;
  const d=await api('/dashboard?month='+month);
  if(version!==loadVersion||!me)return;
  data=d;
  if(!data.agents.some(a=>a.id===selected))selected='';
  const query=new URLSearchParams({month,page:String(policyPage),...(isLeader()&&selected?{agent:selected}:{})});
  const [p,c]=await Promise.all([api('/policies?'+query),!isLeader()?api('/clients'):Promise.resolve({items:[]})]);
  if(version!==loadVersion||!me)return;
  orders=p;clients=c.items;render();
}
async function loadOrders(){
  const version=++loadVersion,query=new URLSearchParams({month:data.month,page:String(policyPage),...(isLeader()&&selected?{agent:selected}:{})});
  const p=await api('/policies?'+query);
  if(version!==loadVersion||!me)return;
  orders=p;$('policies').innerHTML=policyTable();
}
async function selectAgent(id){
  selected=id;policyPage=1;
  $('chart-agent').value=id;drawChart();
  $('member-results').innerHTML=memberRows();
  await loadOrders();
  notify(id?'已切换到 '+data.agents.find(a=>a.id===id).name+' 的走势和保单':'已显示全团队走势和保单');
}
async function entryClients(){
  const version=++clientVersion;
  $('entry-save').disabled=true;$('entry-client').innerHTML='<option value="">正在加载…</option>';
  const c=await api('/clients?agent='+$('entry-agent').value);
  if(version!==clientVersion)return;
  $('entry-client').innerHTML=c.items.map(c=>`<option value="${c.id}">${esc(c.name)} · ${c.age} 岁 · ${c.id}</option>`).join('');$('entry-save').disabled=false;
}
async function ask(question){
  if(aiBusy||!me||$('month').value!==data.month)return;
  const request={actor:me,month:data.month};aiBusy=request;aiAnswer=null;
  updateAiOutput();
  let result;
  try{
    result=await api('/ai/analyze',{method:'POST',body:JSON.stringify({question,month:request.month})});
  }catch(e){result={error:e.message+'。可以重试。'};}
  if(aiBusy!==request)return;
  aiBusy=null;
  if(me===request.actor&&data?.month===request.month&&$('month').value===request.month)aiAnswer=result;
  updateAiOutput();
  if(aiAnswer?.answer)window.InsuranceReply.play($('ai-answer')?.querySelector('.ai-response'));
}
function updateAiOutput(){
  const send=$('ai-send'),output=$('ai-answer');
  if(send){send.disabled=!!aiBusy;send.textContent=aiBusy?'分析中…':'开始分析';}
  if(output)output.innerHTML=aiReplyView();
}
$('login-form').addEventListener('change',()=>{
  if(!demoLogin)return;
  const role=new FormData($('login-form')).get('role');
  $('agent-login-label').hidden=role!=='agent';$('login-description').textContent=role==='leader'?'查看 3 位成员，分析走势并录入保单。':'可选择兼职或全职演示账号，登录后查看自己的进度。';$('login-submit').textContent=role==='leader'?'进入团队长工作台':'进入我的工作台';
});
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();$('login-submit').disabled=true;
  try{await api('/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});me=await api('/me');selected='';search='';status='all';memberPage=policyPage=clientPage=1;aiAnswer=aiBusy=null;$('month').value='2026-10';await load();}catch(e){notify(e.message);}finally{$('login-submit').disabled=false;$('workbench-password').value='';}
});
$('switch-account').addEventListener('click',async()=>{try{await api('/logout',{method:'POST'});showLogin();}catch(e){notify(e.message);}});
$('month').addEventListener('change',async()=>{policyPage=1;aiAnswer=aiBusy=null;updateAiOutput();try{await load();}catch(e){notify(e.message);}});
$('add-policy').addEventListener('click',async()=>{
  $('entry-form').reset();$('entry-error').textContent='';$('entry-agent').innerHTML=options(data.agents);$('entry-agent').value=selected||data.agents[0].id;$('entry-form').elements.date.value=data.month+'-28';$('io-collect').showModal();
  try{await entryClients();}catch(e){$('entry-error').textContent=e.message;}
});
$('entry-agent').addEventListener('change',()=>entryClients().catch(e=>$('entry-error').textContent=e.message));
$('entry-form').addEventListener('submit',async e=>{
  e.preventDefault();$('entry-save').disabled=true;$('entry-error').textContent='';
  const body=Object.fromEntries(new FormData(e.target));
  try{
    await api('/policies',{method:'POST',body:JSON.stringify(body)});
    activePage='policies';selected=body.agent_id;$('month').value=body.date.slice(0,7);policyPage=1;aiAnswer=aiBusy=null;$('io-collect').close();
    await load();notify('保单已保存，业绩、目标差额与走势已更新');
  }catch(e){if($('io-collect').open)$('entry-error').textContent=e.message;else notify('保单已保存，但刷新失败：'+e.message);}
  finally{$('entry-save').disabled=false;}
});
$('insurance-ops').addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button)return;
  try{
    if(button.dataset.nav){showPage(button.dataset.nav);window.scrollTo({top:0,behavior:'instant'});}
    else if(button.dataset.action==='close')$('io-collect').close();
    else if(button.dataset.agent)await selectAgent(button.dataset.agent);
    else if(button.dataset.action==='all-team')await selectAgent('');
    else if(button.dataset.action==='warnings'){status='warning';search='';memberPage=1;$('member-status').value=status;$('member-search').value='';$('member-results').innerHTML=memberRows();$('members').scrollIntoView({behavior:'smooth',block:'start'});}
    else if(button.dataset.page){
      const step=Number(button.dataset.step);
      if(button.dataset.page==='members'){memberPage+=step;$('member-results').innerHTML=memberRows();}
      else if(button.dataset.page==='policies'){policyPage+=step;await loadOrders();}
      else{clientPage+=step;$('clients').innerHTML=clientTable();}
    }else if(button.dataset.question){$('ai-question').value=button.dataset.question;await ask(button.dataset.question);}
  }catch(e){notify(e.message);}
});
$('insurance-ops').addEventListener('change',e=>{
  if(e.target.id==='chart-agent'||e.target.id==='policy-agent')selectAgent(e.target.value).catch(e=>notify(e.message));
  if(e.target.id==='member-status'){status=e.target.value;memberPage=1;$('member-results').innerHTML=memberRows();}
});
$('insurance-ops').addEventListener('input',e=>{if(e.target.id==='member-search'){search=e.target.value;memberPage=1;$('member-results').innerHTML=memberRows();}});
$('insurance-ops').addEventListener('submit',e=>{if(e.target.id==='ai-form'){e.preventDefault();ask($('ai-question').value.trim());}});
async function init(){
  try{
    const accounts=await api('/demo-accounts');demoLogin=accounts.demo;
    if(demoLogin){$('login-agent').innerHTML=options(accounts.agents);$('login-agent').value='A006';}
    else{
      $('demo-login-options').hidden=true;$('demo-login-options').querySelectorAll('input').forEach(el=>el.disabled=true);
      $('production-credentials').hidden=false;$('production-credentials').querySelectorAll('input').forEach(el=>{el.disabled=false;el.required=true;});
      $('login-caption').textContent='使用团队分配的账号登录';$('login-description').hidden=true;
      $('login-submit').textContent='登录工作台';$('login-footnote').hidden=true;
      $('switch-account').textContent='退出登录';$('role-label').textContent='团队成员登录';
    }
  }catch(e){notify('账号设置加载失败：'+e.message);return;}
  try{me=await api('/me');await load();}catch(e){if(me)notify(e.message);else showLogin();}
}



function showPage(page){
  if(page==='knowledge'&&!isLeader())page='assistants';
  activePage=page;
  $('insurance-ops').dataset.state='workspace';
  $('insurance-ops').dataset.page=page;
  const names={overview:isLeader()?'团队经营总览':'我的进度',policies:isLeader()?'团队保单明细':'我的保单明细',precheck:'投保资料预检',ai:'AI 经营助理',clients:'我的客户档案',assistants:'团队 AI 助理',knowledge:'团队知识库'};
  $('workspace').setAttribute('aria-label',names[page]);
  const assistantPage=['assistants','knowledge'].includes(page);
  $('assistant-section').dataset.section=assistantPage?page:'assistants';
  $('workspace-actions').hidden=assistantPage||page==='precheck';
  $('workspace-footer-note').textContent=assistantPage?'团队资料有据可查 · 使用前核对原文':page==='precheck'?'虚构样例 · 投保材料核对':'首年保费（人民币）· 已生效保单';
  document.querySelectorAll('[data-section]').forEach(el=>el.hidden=el.dataset.section!==page);
  document.querySelectorAll('#main-nav [data-nav]').forEach(el=>{if(el.dataset.nav===page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  const nav=$('main-nav'),current=nav.querySelector('[aria-current="page"]');
  if(nav.scrollWidth>nav.clientWidth&&current)nav.scrollTo({left:current.offsetLeft-nav.offsetLeft-12,behavior:'instant'});
  if(assistantPage)window.InsuranceAssistants.mount($('assistant-root'),{page,actor:me,api,notify,navigate:showPage});
  if(page==='precheck')window.InsurancePrecheck.mount($('precheck-root'),{actor:me,api,notify});
  if(page==='overview')requestAnimationFrame(drawChart);
}
function render(){
  if(!me||!data)return;
  $('login').hidden=true;$('workspace').hidden=false;$('switch-account').hidden=false;
  $('role-label').textContent=me.name+' / '+(isLeader()?'团队长':'代理人');
  $('nav-overview-label').textContent=isLeader()?'经营总览':'个人进度';
  $('sidebar-avatar').textContent=me.name[0];
  $('sidebar-user-name').innerHTML=esc(me.name)+'<small>'+(isLeader()?'团队长':'代理人 · '+me.agent_id)+'</small>';
  $('nav-clients').hidden=isLeader();
  $('nav-knowledge').hidden=!isLeader();
  $('add-policy').hidden=!isLeader();
  const summary=isLeader()?statCards():window.InsurancePersonalProgress.render(data);
  $('io-content').innerHTML=`<div data-section="overview">${summary}<div class="duo">${chartPanel()}${attention()}</div>${isLeader()?members():profilePanels()}</div><div data-section="ai">${aiPanel()}</div><div data-section="policies"><section class="panel full" id="policies">${policyTable()}</section></div>${isLeader()?'':`<div data-section="clients"><section class="panel full" id="clients">${clientTable()}</section></div>`}<div data-section="assistants" id="assistant-section"><div id="assistant-root"></div></div>`;
  const precheckSection=document.createElement('section');
  precheckSection.dataset.section='precheck';
  precheckSection.id='precheck-root';
  $('io-content').append(precheckSection);
  $('assistant-section').dataset.section=['assistants','knowledge'].includes(activePage)?activePage:'assistants';
  if(isLeader()){$('chart-agent').value=selected;$('member-status').value=status;}
  showPage(activePage);
  chartObserver?.disconnect();chartObserver=new ResizeObserver(drawChart);chartObserver.observe($('chart'));drawChart();
}
function memberRows(){
  const filtered=data.agents.filter(a=>(a.name+a.id).toLowerCase().includes(search.toLowerCase())&&(status==='all'||status==='warning'&&rate(a)<60||status==='met'&&rate(a)>=100||status==='unmet'&&rate(a)<100));
  return `<div class="member-grid">${filtered.map(a=>{
    const warn=rate(a)<60;
    return `<article class="member-card ${warn?'warn':''} ${selected===a.id?'selected':''}" aria-label="${esc(a.name)}的业绩">
    <div class="member-top"><span class="avatar ${warn?'red':''}">${esc(a.name[0])}</span><div class="member-name">${esc(a.name)}<small>代理人 ${a.id}</small></div><span class="status ${warn?'red':''}">${warn?'! 重点预警':rate(a)>=100?'已达标':'待达标'}</span></div>
    <div class="member-amount"><strong>${money(a.actual)}</strong><span>${a.count} 单已生效</span></div>${track(rate(a),warn)}
    <div class="member-progress"><span>目标 ${money(a.target)}</span><strong class="${warn?'red':''}">${pct(rate(a))}</strong></div>
    <div class="member-gap"><span>${gap(a)?'距目标还差':'已超出目标'}</span><strong class="${warn?'red':''}">${money(gap(a)||a.actual-a.target)}</strong></div>
    <button class="rowlink" data-agent="${a.id}" aria-pressed="${selected===a.id}"><span>${selected===a.id?'正在查看此成员':'查看走势与保单'}</span><span aria-hidden="true">↗</span></button></article>`;
  }).join('')}</div>${filtered.length?'':'<p class="empty">没有匹配的成员，请调整筛选条件。</p>'}`;
}


function chartPanel(){return `<section class="panel chart-panel">${head('业绩走势','实际首年保费与月度目标',isLeader()?`<select id="chart-agent" aria-label="选择走势成员"><option value="">全团队</option>${options(data.agents)}</select>`:'')}<div class="chart-legend"><span><i></i>实际业绩</span><span><i class="target-key"></i>月度目标</span></div><div id="chart" class="chartslot"></div><div class="chartmeta"><span class="linekey" id="chart-key"></span><span id="chart-change"></span></div><details class="chart-values"><summary>查看每月详细数值</summary><div id="chart-data" class="tablewrap"></div></details></section>`;}
function drawChart(){
  if(!$('chart')||!data||$('chart').clientWidth<100)return;
  const a=isLeader()?(data.agents.find(a=>a.id===selected)||aggregate()):data.agents[0];
  const values=a.history,w=$('chart').clientWidth,h=236,x0=39,x1=w-27,y0=24,y1=200;
  const max=Math.max(1,a.target,...values),step=Math.ceil(max/4/1000)*1000,top=step*4;
  const x=i=>values.length===1?(x0+x1)/2:x0+(x1-x0)*i/(values.length-1),y=v=>y1-(y1-y0)*v/top;
  const points=values.map((v,i)=>[x(i),y(v)]),line=points.map(p=>p.join(',')).join(' ');
  $('chart').innerHTML=`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(a.name)}首年保费走势：${values.map((v,i)=>data.historyMonths[i]+' '+money(v)).join('，')}；月目标${money(a.target)}">
    <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--accent)" stop-opacity=".15"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${Array.from({length:5},(_,i)=>`<line x1="${x0}" x2="${w-5}" y1="${y(step*i)}" y2="${y(step*i)}" stroke="#ededed"/><text x="${x0-7}" y="${y(step*i)+4}" text-anchor="end" fill="#686868" font-size="11">${Number((step*i/10000).toFixed(2))}</text>`).join('')}
    <line x1="${x0}" x2="${w-5}" y1="${y(a.target)}" y2="${y(a.target)}" stroke="#929292" stroke-dasharray="5 5" stroke-width="1"/>
    <polygon points="${points[0][0]},${y1} ${line} ${points.at(-1)[0]},${y1}" fill="url(#area)"/><polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
    ${points.map(([cx,cy],i)=>`<circle cx="${cx}" cy="${cy}" r="4" stroke="var(--accent)" stroke-width="1.5" fill="${i===values.length-1?'var(--accent)':'#fff'}"><title>${data.historyMonths[i]}：${money(values[i])}</title></circle><text x="${cx}" y="224" text-anchor="middle" fill="var(--muted)" font-size="11">${Number(data.historyMonths[i].slice(5))}月</text>`).join('')}
    <text x="${w-5}" y="${Math.max(14,points.at(-1)[1]-13)}" text-anchor="end" fill="var(--ink)" font-size="12" font-weight="700">${(values.at(-1)/10000).toFixed(2)} 万</text></svg>`;
  $('chart-key').textContent=(isLeader()?a.name:'我的')+'首年保费（万元）';
  $('chart-change').textContent=values.length>1?'较上月 '+pct((values.at(-1)/values.at(-2)-1)*100):'暂无上月数据';
  $('chart-data').innerHTML=`<table><caption class="sr">每月业绩与目标</caption><thead><tr><th>月份</th><th class="num">实际首年保费</th><th class="num">月度目标</th></tr></thead><tbody>${values.map((v,i)=>`<tr><td>${data.historyMonths[i]}</td><td class="num">${money(v)}</td><td class="num">${money(a.target)}</td></tr>`).join('')}</tbody></table>`;
}
function attention(){
  if(!isLeader()){
    const a=data.agents[0],warn=gap(a)>0;
    return `<aside class="panel attention ${warn?'':'attention-empty'}">${head((warn?'<span class="warning-icon">!</span> ':'')+(warn?'目标待完成':'本月目标已达成'),'月度目标 '+money(a.target))}
    <div class="compare"><strong class="${warn?'red':''}">${money(gap(a))}</strong><span>距目标</span></div>${track(rate(a),warn)}<div class="member-progress"><span>目标完成进度</span><strong class="${warn?'red':''}">${pct(rate(a))}</strong></div>
    <div class="focus-ai" style="margin-top:20px"><h3>下一步重点</h3><p>${warn?'优先核对待生效保单，再安排重点客户跟进。':'本月已完成目标，建议复盘主要成交来源。'}</p><button class="ai-shortcut" data-nav="ai">让 AI 分析我的业绩 <span>↗</span></button></div></aside>`;
  }
  const flagged=data.agents.filter(a=>rate(a)<60).sort((a,b)=>gap(b)-gap(a));
  return `<aside class="panel attention ${flagged.length?'':'attention-empty'}">${head((flagged.length?'<span class="warning-icon">!</span> ':'')+(flagged.length?'重点注意':'团队状态良好'),'目标达成低于 60% · '+flagged.length+' 人')}
    ${flagged.map(a=>`<div class="watchitem"><div><button data-agent="${a.id}">${esc(a.name)} ↗</button><small>${a.id} · 达成 ${pct(rate(a))}</small></div><strong class="red">${money(gap(a))}<small>距离个人目标</small></strong></div>`).join('')}
    ${flagged.length?`<button class="quiet" data-action="warnings">查看预警成员</button>`:'<p class="empty">所有成员均高于预警线</p>'}
    <div class="focus-ai"><h3>下一步重点</h3><p>${flagged.length?'先关注 '+esc(flagged[0].name)+' 的目标缺口，结合历史走势核查待生效保单和客户跟进情况。':'继续跟进尚未达标成员，复盘已达标成员的成交来源。'}</p><button class="ai-shortcut" data-nav="ai">打开 AI 经营助理 <span>↗</span></button></div></aside>`;
}
const aiSpark='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/></svg>';
function aiReplyView(){
  const state=aiBusy?'pending':aiAnswer?.error?'error':aiAnswer?.answer?'done':'empty';
  const caption=state==='done'?(aiAnswer.mode==='demo'?'【模拟分析】':'【AI 分析】'):state==='error'?'分析未完成':'分析结果';
  const text=state==='pending'?'正在分析当前权限范围内的数据…':state==='error'?aiAnswer.error:'选择上方主题，或输入你的问题。';
  return `<article class="ai-response" data-state="${state}" tabindex="-1" aria-labelledby="analysis-caption"><header class="reply-meta"><span class="reply-symbol">${aiSpark}</span><strong id="analysis-caption">${caption}</strong><button type="button" class="reply-skip" data-reveal-skip hidden>显示全文</button></header><div class="analysis-body">${state==='done'?window.InsuranceReply.analysis(aiAnswer.answer):`<p>${esc(text)}</p>`}</div></article>`;
}
function aiPanel(){
  const a=isLeader()?aggregate():data.agents[0];
  return `<div class="ai-context"><h2>当前分析范围</h2><span>${isLeader()?'启航团队 · '+data.agents.length+' 人':esc(me.name)+' · 仅本人'}</span><span>统计月份<strong>${data.month}</strong></span><span>首年保费<strong>${money(a.actual)}</strong></span><span>目标达成<strong>${pct(rate(a))}</strong></span></div>
  <section class="panel full" id="ai-panel">${head('AI 经营助理',me.ai.configured?'已连接智能体服务':'待接入智能体 · 当前为模拟分析',`<span class="count">${isLeader()?'团队数据范围':'个人数据范围'}</span>`)}
  <div class="ai-welcome"><span class="ai-orb">${aiSpark}</span><div><h2>从数据里，找到行动方向。</h2><p>询问业绩变化、客户来源，或下一步跟进重点。</p></div></div>
  <div class="qgroup">${['目标差距','销售趋势','客户来源','留存分析'].map(q=>`<button class="qbtn" data-question="${q}">${q}</button>`).join('')}</div>
  <form class="ai-form" id="ai-form"><input id="ai-question" aria-label="向 AI 提问" maxlength="1000" required placeholder="本月业绩发生了哪些变化？"><button class="black" id="ai-send" ${aiBusy?'disabled':''}>${aiBusy?'分析中…':'开始分析'}</button></form>
  <div id="ai-answer" aria-live="polite">${aiReplyView()}</div><p class="ai-note">分析仅使用当前账号权限范围内的统计数据。</p></section>`;
}
init();
