/* Frontend prototype. No model, PDF extraction, embeddings or remote uploads. */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({spark:'<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/>',book:'<path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15"/>',chat:'<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 1-6a9 9 0 1 1 18-5Z"/><path d="M7 10h10M7 14h6"/>',file:'<path d="M6 3h8l4 4v14H6Z M14 3v5h4M9 12h6M9 16h4"/>',up:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z m-4 9 3 3 5-6"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',down:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',check:'<path d="m5 12 4 4L19 6"/>'})[name] || ''}</svg>`;
  const categories = {product:'保险产品',team:'公司与团队',objection:'异议处理'};
  const seeds = [
    {id:'demo-medical',name:'安心医疗保障 · 产品说明（示例）.pdf',category:'product',pages:3,size:0,enabled:true,sample:true,url:'/demo/medical.pdf',summary:'说明医疗保障的阅读重点、适合进一步沟通的人群，以及免赔额、续保与除外责任的核对方式。',updated:'2026-11-09'},
    {id:'demo-critical',name:'家庭重疾保障 · 产品说明（示例）.pdf',category:'product',pages:3,size:0,enabled:true,sample:true,url:'/demo/critical.pdf',summary:'说明重疾保障的用途、家庭经济支柱的需求分析及确诊条件、等待期等核对要点。',updated:'2026-11-09'},
    {id:'demo-team',name:'启航团队 · 新人入职指南（示例）.pdf',category:'team',pages:3,size:0,enabled:true,sample:true,url:'/demo/team-guide.pdf',summary:'公司与团队介绍占位、入职学习、晋升核对、佣金核对和工作台使用路径。不含真实公司制度。',updated:'2026-11-09'},
    {id:'demo-objection',name:'客户沟通与异议处理手册（示例）.pdf',category:'objection',pages:3,size:0,enabled:true,sample:true,url:'/demo/objections.pdf',summary:'保费、已有保障、理赔和产品对比四种场景。先倾听，再澄清，最后约定下一步。',updated:'2026-11-09'}
  ];
  const modes = {
    product:{title:'产品知识助手',short:'读懂产品，找到适合的人',icon:'spark',greeting:'这次，想为哪位客户找到保障？',description:'一起读懂产品资料，梳理适合人群，再把原始 PDF 带给你。',prompts:['团队目前有哪些产品？','医疗保障适合哪些客户？','重疾保障有什么优势？'],placeholder:'问产品特点、适合人群，或描述客户的保障需求…'},
    team:{title:'新人入职助手',short:'从第一天开始，有人带你',icon:'book',greeting:'加入启航，从这里迈出第一步。',description:'了解团队、梳理晋升与佣金流程，找到系统使用的下一步。',prompts:['介绍一下公司和团队','新人第一周应该做什么？','晋升流程是怎样的？','佣金如何发放和核对？','工作台怎么使用？'],placeholder:'问团队情况、晋升、佣金，或系统如何使用…'},
    objection:{title:'异议处理助手',short:'理解顾虑，让沟通更进一步',icon:'chat',greeting:'先理解顾虑，再一起找到回应。',description:'告诉我客户的原话，整理回应思路、参考话术和下一步追问。',prompts:['客户觉得保费太高','客户说已经有保险了','客户担心理赔问题','客户想对比其他产品'],placeholder:'输入客户的原话，例如：“一年交这么多，感觉不太划算”…'}
  };
  let root, ctx, page='assistants', mode='product', docs=seeds.map(d=>({...d})), dbPromise, loaded=false, storageError='', actorKey='', session=0;
  let filter='', category='all', status='all', pending=[], uploadCategory='product', uploadBusy=false, busy=false, timer;
  const chats={product:[],team:[],objection:[]}, drafts={product:'',team:'',objection:''};
  const customer={product:'未指定产品',stage:'初次了解',note:''};
  const bytes = n => n ? n<1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB` : '3 页';
  const leader = () => ctx?.actor.role==='leader';
  const enabled = cat => docs.filter(d=>d.sample&&d.enabled&&(!cat||d.category===cat&&seeds.find(s=>s.id===d.id)?.category===cat));
  function database(){
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open('insurance-qihang-knowledge-v1',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('documents',{keyPath:'id'});
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    return dbPromise;
  }
  async function storeDocument(doc, remove=false){
    const db=await database();
    await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');const store=tx.objectStore('documents');remove?store.delete(doc.id):store.put(doc);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存失败'));});
  }
  async function loadDocuments(){
    try{
      const db=await database();
      const values=await new Promise((resolve,reject)=>{const req=db.transaction('documents').objectStore('documents').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
      docs=[...seeds.map(d=>({...d,...values.find(v=>v.id===d.id)})),...values.filter(d=>!d.sample)];
    }catch{storageError='浏览器本地存储不可用，PDF 上传和管理暂不可用。';}
    loaded=true;render();
  }
  function mount(element, options){
    root=element;ctx=options;page=options.page;
    const key=ctx.actor.role+':'+(ctx.actor.agent_id||'leader');
    if(actorKey!==key){clearChats();actorKey=key;}
    root.onclick=onClick;root.oninput=onInput;root.onchange=onChange;root.onsubmit=onSubmit;root.onkeydown=onKeydown;
    root.ondragover=e=>{if(e.target.closest('.a-dropzone'))e.preventDefault();};
    root.ondrop=e=>{if(e.target.closest('.a-dropzone')){e.preventDefault();selectFiles(e.dataTransfer.files);}};
    if(!loaded)loadDocuments();render();
  }
  function clearChats(){session++;clearTimeout(timer);busy=false;Object.keys(chats).forEach(k=>{chats[k]=[];drafts[k]='';});customer.product='未指定产品';customer.stage='初次了解';customer.note='';}
  function reset(){clearChats();actorKey='';root=null;ctx=null;}
  function render(){
    if(!root?.isConnected)return;
    if(root.querySelector('dialog[open]'))return;
    const active=document.activeElement,focusId=root.contains(active)&&active.matches('input,textarea,select')?active.id:'',cursor=active.selectionStart;
    root.innerHTML=page==='knowledge'&&leader()?knowledgeView():assistantView();
    const replacement=focusId?root.querySelector('#'+focusId):null;
    if(replacement){replacement.focus({preventScroll:true});if(typeof cursor==='number'&&replacement.setSelectionRange)replacement.setSelectionRange(cursor,cursor);}
  }
  function assistantView(){
    const m=modes[mode],history=chats[mode];
    return `<div class="a-tabs" role="tablist" aria-label="选择团队助理">${Object.entries(modes).map(([key,v])=>`<button role="tab" id="a-tab-${key}" aria-selected="${mode===key}" aria-controls="a-tabpanel" tabindex="${mode===key?'0':'-1'}" data-amode="${key}"><span class="a-tab-icon">${icon(v.icon)}</span><span><strong>${v.title}</strong><small>${v.short}</small></span>${icon('arrow')}</button>`).join('')}</div>
      <div class="a-layout"><section class="a-chat panel" id="a-tabpanel" role="tabpanel" aria-labelledby="a-tab-${mode}">
      <div class="a-chat-head"><div><span class="a-online"></span><strong>${m.title}</strong><span class="a-badge">交互演示</span></div><button class="a-textbtn" data-aaction="new-chat" ${busy?'disabled':''}>＋ 新对话</button></div>
      <div class="a-messages" id="a-messages" role="log" aria-label="${m.title}对话" aria-live="polite" aria-busy="${busy}">${history.length?history.map(messageView).join(''):welcome(m)}${busy?`<div class="a-thinking">${icon('spark')} 正在整理演示资料…</div>`:''}</div>
      <form id="a-chat-form" class="a-composer"><label class="sr" for="a-question">${m.title}提问</label><textarea id="a-question" rows="2" maxlength="1600" required placeholder="${m.placeholder}">${esc(drafts[mode])}</textarea><div class="a-compose-bottom"><span>${icon('shield')}${mode==='product'?'仅依据启用的示例资料回答':'示例资料与沟通流程演示'}</span><button class="black" type="submit" ${busy?'disabled':''}>${busy?'整理中…':'发送'} ${icon('arrow')}</button></div></form>
      <p class="a-demo-note">当前为预设交互演示，尚未连接 AI；真实回答将在接入团队资料后生成。</p></section>
      <aside class="a-rail">${mode==='product'?productRail():mode==='team'?teamRail():objectionRail()}</aside></div>`;
  }
  function welcome(m){return `<div class="a-welcome"><span class="a-hero-icon">${icon(m.icon)}</span><span class="a-eyebrow">启航团队 · 你的专属助理</span><h2>${m.greeting}</h2><p>${m.description}</p><div class="a-prompts">${m.prompts.map((p,i)=>`<button data-aprompt="${esc(p)}"><span><small>0${i+1}</small>${p}</span>${icon('arrow')}</button>`).join('')}</div></div>`;}
  function productRail(){return `<section class="panel a-scope"><span class="a-eyebrow">资料范围</span><h3>答案有依据，资料可带走。</h3><p>产品结论附来源，资料不足时会说明缺口，并继续追问需求。</p><div class="a-scope-count"><strong>${enabled('product').length.toString().padStart(2,'0')}</strong><span>份启用的产品示例 PDF</span></div><div class="a-rail-files">${enabled('product').map(d=>`<button data-adoc="${d.id}">${icon('file')}<span>${esc(d.name)}<small>示例资料 · ${d.pages} 页</small></span>${icon('arrow')}</button>`).join('')||'<p>暂无启用的产品示例</p>'}</div></section><section class="panel a-process"><h3>不止回答一个问题</h3><ol><li><span>01</span><div>读懂产品<small>特点、保障与核对要点</small></div></li><li><span>02</span><div>找到适合的人<small>从客户需求出发</small></div></li><li><span>03</span><div>把沟通继续下去<small>追问情况，附上原始资料</small></div></li></ol></section>${manageLink()}`;}
  function teamRail(){return `<section class="panel a-scope"><span class="a-eyebrow">新人学习路径</span><h3>每一步，都有方向。</h3><ol class="a-learning"><li><b>01</b><div>认识公司与团队<small>团队分工 · 找到你的带教人</small></div></li><li><b>02</b><div>了解发展与收入<small>晋升流程 · 佣金核对</small></div></li><li><b>03</b><div>熟悉日常工具<small>业绩查看 · 保单与客户档案</small></div></li></ol><p>具体公司介绍、晋升门槛及发佣日期，等待团队正式资料接入。</p></section><section class="panel a-topics"><h3>快速找到答案</h3>${modes.team.prompts.map(p=>`<button data-aprompt="${esc(p)}">${p}${icon('arrow')}</button>`).join('')}</section>${manageLink()}`;}
  function objectionRail(){return `<section class="panel a-customer"><span class="a-eyebrow">补充沟通背景 · 选填</span><h3>让回应贴近这位客户。</h3><label>沟通产品<select id="a-customer-product">${['未指定产品','安心医疗保障（示例）','家庭重疾保障（示例）'].map(v=>`<option ${customer.product===v?'selected':''}>${v}</option>`).join('')}</select></label><label>沟通阶段<select id="a-customer-stage">${['初次了解','需求分析','方案沟通','后续跟进'].map(v=>`<option ${customer.stage===v?'selected':''}>${v}</option>`).join('')}</select></label><label>客户需求与顾虑<textarea id="a-customer-note" rows="3" maxlength="500" placeholder="例如：已有单位医保，重视住院开支">${esc(customer.note)}</textarea></label><small>填写需求即可，无需填写姓名或证件信息。演示会将背景带入沟通清单。</small></section><section class="panel a-process"><h3>好的沟通，先从倾听开始</h3><p>理解顾虑 → 澄清原因 → 对应资料 → 约定下一步</p><div class="a-soft-note">不承诺必赔，不贬低其他产品；让客户在充分了解后做决定。</div></section>${manageLink()}`;}
  function manageLink(){return leader()?`<button class="a-manage-link" data-aaction="manage">${icon('book')} 管理团队知识库 ${icon('arrow')}</button>`:`<p class="a-rail-note">团队资料由团队长统一维护。</p>`;}
  function messageView(message){
    if(message.role==='user')return `<div class="a-user-message"><span>${esc(message.text)}</span><small>你</small></div>`;
    const r=message.answer;
    return `<article class="a-reply"><div class="a-reply-label">${icon(modes[message.mode].icon)} ${modes[message.mode].title}<span>示例回答</span></div><h3>${esc(r.title)}</h3><p>${esc(r.intro)}</p>${r.blocks.map(b=>`<section class="a-answer-block ${b.tone||''}"><h4>${esc(b.title)}</h4>${b.text?`<p>${esc(b.text)}</p>`:''}${b.items?`<ul>${b.items.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}</section>`).join('')}${r.followup?`<div class="a-followup">${icon('chat')}<div><strong>我还想了解</strong><p>${esc(r.followup)}</p></div></div>`:''}${r.sources.length?`<div class="a-sources"><h4>参考资料 <span>${r.sources.length} 份 · 均为演示 PDF</span></h4>${r.sources.map(s=>attachment(s)).join('')}</div>`:''}<div class="a-reply-actions"><button class="a-textbtn" data-acopy="${message.id}">复制回答</button><span>示例内容，不代表实际产品或公司制度</span></div>${r.suggestions?.length?`<div class="a-follow-chips">${r.suggestions.map(p=>`<button data-aprompt="${esc(p)}">${esc(p)} ↗</button>`).join('')}</div>`:''}</article>`;
  }
  function attachment(source){const d=docs.find(d=>d.id===source.id);if(!d)return '';return `<div class="a-attachment">${icon('file')}<div><strong>${esc(d.name)}</strong><small>${esc(source.pages)} · ${d.enabled?'示例来源':'目前已停用'}</small></div><button class="a-textbtn" data-adoc="${d.id}">查看</button><a href="${d.url}" download class="a-download" aria-label="下载${esc(d.name)}">${icon('down')}</a></div>`;}
  function answerFor(question, selectedMode){
    const source=(id,pages)=>({id,pages});
    const missing=message=>({title:'还需要一份可靠的资料',intro:message,blocks:[{title:'下一步',text:'请由团队长补充相应资料。正式接入后，助手将检索有效文件、标注出处，并返回对应 PDF。'}],followup:'你可以补充具体产品名称，或说明想核对的条款。',sources:[]});
    if(selectedMode==='product'){
      let list=enabled('product');
      if(/医疗|住院|医保|免赔|续保/.test(question))list=list.filter(d=>d.id==='demo-medical');
      else if(/重疾|经济支柱|收入中断/.test(question))list=list.filter(d=>d.id==='demo-critical');
      else if(!/产品|保障|保险|客户|适合|优势|推荐/.test(question))return missing('当前演示资料没有覆盖这个问题，不能据此给出结论。');
      if(!list.length)return missing('当前没有与问题匹配的启用产品示例。已停用的文件不会用于新的回答。');
      const medical=list.some(d=>d.id==='demo-medical'),critical=list.some(d=>d.id==='demo-critical');
      return {title:list.length>1?'先看产品方向，再看客户需要什么。':medical?'安心医疗保障：从医疗支出需求切入。':'家庭重疾保障：关注疾病带来的收入缺口。',intro:'以下仅整理启用的演示 PDF，不含真实产品费率或承保承诺。',blocks:[
        ...(medical?[{title:'01 · 安心医疗保障（示例）',items:['产品特点：围绕符合条款约定的医疗支出整理保障；需要核对报销范围和给付条件。','适合进一步沟通：担心住院自费开支、希望补充已有医疗保障的客户。','沟通前核对：现有医保、免赔额、除外责任、健康告知及续保条件。'],text:'来源：《安心医疗保障》示例 PDF，第 1–2 页。'}]:[]),
        ...(critical?[{title:'02 · 家庭重疾保障（示例）',items:['产品特点：围绕合同约定的疾病及给付条件，讨论治疗期间的经济支持需求。','适合进一步沟通：承担家庭主要收入、担心患病后收入中断的客户。','沟通前核对：已有保额、家庭开支、等待期、疾病定义及给付条件。'],text:'来源：《家庭重疾保障》示例 PDF，第 1–2 页。'}]:[]),
        {title:'把优势转成一次需求沟通',text:'先了解客户现有保障和最担心的支出，再讨论是否存在缺口；具体保费与保障结论，需等正式产品文件和客户情况齐备后核对。',tone:'a-block-muted'}
      ],followup:'这位客户处于哪个年龄段？已有医疗或重疾保障吗？他更担心医疗费用，还是患病后的家庭收入？',sources:list.map(d=>source(d.id,'第 1–3 页')),suggestions:['医疗保障适合哪些客户？','重疾保障有什么优势？']};
    }
    if(selectedMode==='team'){
      if(!enabled('team').length)return missing('新人入职示例指南已停用，当前没有可引用的团队资料。');
      let title='从第一周开始，熟悉团队与工作方式。',items=['确认带教人和团队分工，了解公司的业务范围及服务方式。','在带教陪同下学习产品资料、需求分析和日常沟通流程。','登录工作台，熟悉业绩、保单和客户档案入口。'],followup='你现在最想了解团队介绍、晋升、佣金，还是系统操作？',p='第 1 页';
      if(/晋升/.test(question)){title='晋升流程：先核对制度，再确认个人进度。';items=['向团队长取得当前有效的职级与晋升制度。','逐项核对考核周期、业绩口径、培训及任职条件。','整理达标证明，按正式制度提交申请并确认审核结果。'];followup='你目前处于什么职级，想了解申请材料还是考核条件？';p='第 2 页';}
      else if(/佣金|发佣|收入/.test(question)){title='佣金流程：从业务记录核对到到账确认。';items=['先核对保单生效状态及公司规定的佣金计算口径。','取得正式佣金结算单，核对保单号、期间和调整项目。','有差异时记录问题并联系结算负责人；到账日期以正式制度为准。'];followup='你想了解结算流程，还是有某笔佣金需要核对？';p='第 2 页';}
      else if(/系统|工作台|操作/.test(question)){title='工作台使用：从左侧入口找到日常工作。';items=['经营总览：查看本月业绩、目标和历史走势。','保单明细：查看权限内的保单；团队长可录入保单。','客户档案：代理人查看自己的客户信息。','团队 AI 助理：选择产品、新人或异议主题；经营分析使用 AI 经营助理入口。'];followup='你准备先查看业绩，还是查询保单？';p='第 3 页';}
      else if(/公司|团队|介绍/.test(question)){title='认识公司与启航团队';items=['公司介绍：等待团队提供正式公司简介，目前没有可核实的成立时间、业务规模或服务承诺。','团队介绍：当前工作台演示包含团队长与三位代理人；实际团队分工和带教安排等待正式资料。','入职联系：先确认带教人、制度资料入口和日常沟通渠道。'];followup='你更想了解带教安排，还是新人第一周的学习路径？';}
      else if(!/新人|第一周|入职|带教|学习/.test(question))return missing('当前新人指南没有覆盖这个问题，具体制度需要团队正式资料。');
      return {title,intro:'根据新人指南演示工作流程，具体公司制度仍待补充。',blocks:[{title:'建议按这几步进行',items},{title:'需要团队补充的资料',text:'正式公司及团队介绍、晋升门槛与考核周期、佣金比例和发放日期、真实系统操作手册。',tone:'a-block-muted'}],followup,sources:[source('demo-team',p)],suggestions:['晋升流程是怎样的？','佣金如何发放和核对？','工作台怎么使用？']};
    }
    if(!enabled('objection').length)return missing('异议处理示例手册已停用，当前没有可引用的沟通资料。');
    const kind=/贵|太高|保费|预算|划算|交这么多/.test(question)?'price':/已经|已有|买过|用不上|有保险/.test(question)?'existing':/理赔|赔付|不赔|赔不/.test(question)?'claims':/对比|比较|其他|别家/.test(question)?'compare':'';
    if(!kind)return missing('这条问题尚未匹配演示中的四类场景。你可以尝试描述保费、已有保障、理赔或产品对比方面的顾虑。');
    const scripts={
      price:{title:'客户说保费高，先问清“高”在哪里。',reason:'可能在意年度预算，也可能还没有看清保障与需求之间的关系。',quote:'“理解，保费确实需要长期安排。您觉得是超出了每年的预算，还是这份保障与您的需要还不够匹配？我们可以先把已有保障和最担心的风险梳理清楚，再讨论是否需要调整。”',steps:['询问客户可持续承担的预算，区分负担问题与价值疑问。','结合正式条款解释与需求相关的保障，不用收益或必赔承诺促成。','若预算不匹配，先调整讨论范围；保额与方案需以正式资料核算。'],follow:'如果只保留您最想解决的一项风险，会是哪一项？',pages:'第 1 页'},
      existing:{title:'客户已有保障，先一起看看覆盖了什么。',reason:'已有保障是分析的起点，需要先了解范围，避免重复推荐。',quote:'“已经有保障是很好的基础。如果您愿意，我们可以一起核对目前保单覆盖了哪些风险，以及您现在的家庭责任有没有变化。没有缺口的话，也不需要为了买而买。”',steps:['征得客户同意后核对已有保单的险种、保额和主要责任。','围绕医疗自费开支、家庭收入等需求确认是否存在缺口。','若没有明确需求，保留服务联系，尊重客户当前决定。'],follow:'您现有保障主要覆盖医疗支出，还是重疾后的收入支持？',pages:'第 1 页'},
      claims:{title:'担心理赔，先把具体条件讲清楚。',reason:'客户可能担心条款理解、申请材料或实际赔付条件。',quote:'“您的顾虑很实际。我们可以把您最关心的情形对应到条款，逐项核对保障责任、除外责任、等待期和健康告知要求。我也可以整理申请材料清单，但是否赔付要以合同和审核为准。”',steps:['请客户描述担心的具体情形，避免泛泛保证。','查找对应条款及页码；资料缺失时先补充，不推断必赔。','说明申请流程和材料，不能将服务协助表述为赔付承诺。'],follow:'您最担心哪一种情况，或哪一条条款看不明白？',pages:'第 2 页'},
      compare:{title:'想对比其他产品，就把标准先对齐。',reason:'客户希望理解差异，需要在相同需求和条件下比较。',quote:'“当然可以比较。我们先用相同的保障需求和预算，逐项看保障范围、给付条件、除外责任及续保安排。您可以提供另一款产品的正式资料，我们一起核对；没有文件的部分，先标记待确认。”',steps:['确认客户最关注的比较维度和可持续预算。','收集两款产品同版本的正式条款及费率资料。','只陈述资料可支持的差异，缺少竞品资料时不下优劣结论。'],follow:'您最想比较价格、保障范围，还是续保与理赔条件？',pages:'第 3 页'}
    }[kind];
    return {title:scripts.title,intro:scripts.reason,blocks:[{title:'沟通背景',text:`阶段：${customer.stage}；产品：${customer.product}。${customer.note?'已记录需求：'+customer.note:'可在右侧补充客户关心的需求。'}`},{title:'可以这样回应',text:scripts.quote,tone:'a-script'},{title:'接下来怎么做',items:scripts.steps},{title:'资料边界',text:'示例仅演示沟通结构。实际保障、费率与理赔结论必须核对正式产品 PDF，当前不能据此推荐具体方案。',tone:'a-block-muted'}],followup:scripts.follow,sources:[source('demo-objection',scripts.pages)],suggestions:['客户觉得保费太高','客户担心理赔问题']};
  }
  function send(question){
    question=question.trim();if(!question||busy||question.length>1600)return;
    const selectedMode=mode,version=session;chats[mode].push({role:'user',text:question});drafts[mode]='';busy=true;render();scrollMessages();
    timer=setTimeout(()=>{if(version!==session)return;const answer=answerFor(question,selectedMode);chats[selectedMode].push({id:crypto.randomUUID(),role:'assistant',mode:selectedMode,answer});busy=false;render();scrollMessages();},420);
  }
  function scrollMessages(){requestAnimationFrame(()=>{const area=root?.querySelector('#a-messages');if(area)area.scrollTop=area.scrollHeight;});}
  function knowledgeView(){
    const uploads=docs.filter(d=>!d.sample),matches=docs.filter(d=>(d.name+' '+categories[d.category]).toLowerCase().includes(filter.toLowerCase())&&(category==='all'||d.category===category)&&(status==='all'||status==='pending'&&!d.sample||status==='enabled'&&d.sample&&d.enabled||status==='disabled'&&d.sample&&!d.enabled));
    return `<div class="a-kb-banner"><div><span class="a-eyebrow">启航团队 · 团队长管理</span><h2>把团队的经验，变成随手可用的支持。</h2><p>统一维护产品、团队制度与沟通资料，之后由专属助手按范围检索。</p></div><button class="black" data-aaction="upload" ${storageError||!loaded?'disabled':''}>${icon('up')} 上传 PDF</button></div>
    <div class="a-kb-metrics"><div><strong>${docs.length}</strong><span>资料总数</span></div><div><strong>${enabled().length}</strong><span>启用的演示资料</span></div><div><strong>${uploads.length}</strong><span>本地 PDF · 待解析</span></div><div><strong>3</strong><span>助理使用场景</span></div></div>
    <div class="a-local-note" role="status">${icon('shield')}<span>${storageError||'前端演示：上传的 PDF 仅保存在当前浏览器，不会上传服务器；尚未解析或建立检索索引。'}${!loaded?' 正在读取本地资料…':''}</span></div>
    <section class="panel a-kb-panel"><div class="a-kb-heading"><div><h2>资料库</h2><p>产品回答仅使用启用的演示资料；上传文件接入解析后才能用于回答。</p></div><button class="quiet" data-aaction="back-assistants">体验 AI 助理 ${icon('arrow')}</button></div>
    <div class="a-kb-toolbar"><div class="a-search">${icon('search')}<input id="a-file-search" aria-label="搜索资料" placeholder="搜索文件名或分类" value="${esc(filter)}"></div><select id="a-file-category" aria-label="筛选资料分类"><option value="all">全部分类</option>${Object.entries(categories).map(([k,v])=>`<option value="${k}" ${category===k?'selected':''}>${v}</option>`).join('')}</select><select id="a-file-status" aria-label="筛选资料状态">${[['all','全部状态'],['enabled','演示已启用'],['disabled','演示已停用'],['pending','待解析']].map(([k,v])=>`<option value="${k}" ${status===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div id="a-file-results">${fileResults(matches)}</div></section><section class="a-boundary"><span>${icon('book')}</span><div><h3>资料管理规则</h3><p>按团队维护有效版本；正式接入后，仅授权资料可参与检索，回答附 PDF 来源，资料不足时先追问。新人制度与产品知识分别管理。</p></div></section>`;
  }
  function fileResults(matches){return `<div class="tablewrap"><table class="a-file-table" aria-label="团队知识库资料"><thead><tr><th>文件名称</th><th>分类</th><th>状态</th><th>更新日期</th><th>操作</th></tr></thead><tbody>${matches.map(d=>`<tr><td><button class="a-file-name" data-adoc="${d.id}">${icon('file')}<span>${esc(d.name)}<small>${bytes(d.size)} · ${d.sample?'演示资料':'仅当前浏览器'}</small></span></button></td><td>${categories[d.category]}</td><td><span class="a-status ${!d.sample?'a-pending':''}">${d.sample?d.enabled?'● 演示已启用':'○ 演示已停用':'◷ 待解析'}</span></td><td>${d.updated}</td><td><div class="a-file-actions"><button class="a-textbtn" data-adoc="${d.id}">查看</button><button class="a-textbtn" data-aedit="${d.id}" ${storageError?'disabled':''}>分类</button>${d.sample?`<button class="a-textbtn" data-atoggle="${d.id}" ${storageError?'disabled':''}>${d.enabled?'停用':'启用'}</button>`:`<button class="a-textbtn red" data-adelete="${d.id}" ${storageError?'disabled':''}>移除</button>`}</div></td></tr>`).join('')}</tbody></table></div>${matches.length?'':`<div class="a-file-empty">${icon('search')}<h3>没有找到相关资料</h3><p>试试其他文件名，或调整分类与状态。</p><button class="quiet" data-aaction="clear-filters">重置筛选</button></div>`}<div class="a-file-total">共 ${matches.length} 份资料<span>PDF · 单个文件不超过 10 MB</span></div>`;}
  function dialog(content,label){
    root.querySelector('dialog')?.remove();const el=document.createElement('dialog');el.className='a-dialog';el.setAttribute('aria-label',label);el.innerHTML=content;root.append(el);el.addEventListener('cancel',e=>{if(uploadBusy)e.preventDefault();});el.addEventListener('close',()=>{el.remove();render();});el.showModal();return el;
  }
  function closeButton(){return '<button class="a-textbtn" type="button" data-aaction="close-dialog" aria-label="关闭对话框">关闭 ×</button>';}
  function uploadDialog(){pending=[];dialog(`<form id="a-upload-form"><div class="panelhead"><div><h2>添加团队资料</h2><p>选择 PDF，先归类，再等待接入解析。</p></div>${closeButton()}</div><div class="a-dropzone"><span>${icon('up')}</span><strong>拖放 PDF 到这里，或选择文件</strong><small>支持多文件 · 每个不超过 10 MB</small><input type="file" id="a-upload-input" accept=".pdf,application/pdf" multiple aria-label="选择要上传的 PDF"></div><label class="a-field">资料分类<select id="a-upload-category">${Object.entries(categories).map(([k,v])=>`<option value="${k}" ${uploadCategory===k?'selected':''}>${v}</option>`).join('')}</select></label><div id="a-pending-files"></div><p id="a-upload-error" class="red" role="alert"></p><p class="a-soft-note">文件保存在当前浏览器。此步骤不会读取 PDF 正文，也不会将其加入 AI 回答。</p><div class="formactions"><button type="button" class="quiet" data-aaction="close-dialog">取消</button><button class="black" id="a-upload-save" disabled>保存到本地资料库</button></div></form>`,'上传 PDF 资料');}
  async function selectFiles(files){
    if(uploadBusy||!leader())return;
    const errors=[];const selectedFiles=Array.from(files);
    for(const file of selectedFiles){
      if(!/\.pdf$/i.test(file.name)){errors.push(`${file.name}：仅支持 PDF。`);continue;}
      if(file.size>10*1024*1024){errors.push(`${file.name}：超过 10 MB。`);continue;}
      if(await file.slice(0,5).text()!=='%PDF-'){errors.push(`${file.name}：不是有效的 PDF 文件。`);continue;}
      if(pending.some(p=>p.name===file.name&&p.size===file.size)||docs.some(d=>!d.sample&&d.name===file.name&&d.size===file.size)){errors.push(`${file.name}：文件已存在。`);continue;}
      pending.push(file);
    }
    const list=root?.querySelector('#a-pending-files');if(!list)return;
    list.innerHTML=pending.map((f,i)=>`<div class="a-pending-file">${icon('file')}<span>${esc(f.name)}<small>${bytes(f.size)}</small></span><button type="button" class="a-textbtn" data-aremove="${i}" aria-label="取消选择${esc(f.name)}">移除</button></div>`).join('');
    root.querySelector('#a-upload-error').textContent=errors.join(' ');root.querySelector('#a-upload-save').disabled=!pending.length;
    const input=root.querySelector('#a-upload-input');if(input)input.value='';
  }
  async function saveUpload(){
    if(!leader()||uploadBusy||!pending.length)return;uploadBusy=true;
    const version=session,localActor=actorKey,files=[...pending],cat=uploadCategory;
    const save=root.querySelector('#a-upload-save');save.disabled=true;save.textContent='保存中…';
    try{
      for(const file of files){const doc={id:crypto.randomUUID(),name:file.name,size:file.size,category:cat,enabled:false,sample:false,blob:file,updated:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),summary:'此文件尚未接入 PDF 解析和检索，正文不会用于演示回答。'};await storeDocument(doc);docs.push(doc);pending=pending.filter(item=>item!==file);}
      pending=[];
      if(version===session&&localActor===actorKey){root.querySelector('dialog')?.close();ctx.notify(`已保存 ${files.length} 份 PDF 到当前浏览器，待接入解析。`);}
    }catch{const error=root?.querySelector('#a-upload-error');if(error)error.textContent='本地保存失败，请检查浏览器存储空间后重试。已保存的文件可在资料库查看。';}
    finally{uploadBusy=false;if(save.isConnected){save.disabled=!pending.length;save.textContent='保存到本地资料库';}}
  }
  function showDocument(id){
    const d=docs.find(d=>d.id===id);if(!d)return;
    const url=d.sample?d.url:URL.createObjectURL(d.blob);
    const el=dialog(`<div class="panelhead"><div><span class="a-eyebrow">${categories[d.category]} · ${d.sample?'示例 PDF':'本地 PDF'}</span><h2>${esc(d.name)}</h2></div>${closeButton()}</div><div class="a-doc-preview">${icon('file')}<p>${esc(d.summary)}</p><small>${d.sample?`${d.pages} 页 · 仅供交互演示，不代表实际产品或公司制度`:'待解析 · 尚未加入 AI 检索'}</small></div><div class="formactions"><a class="quiet" href="${url}" target="_blank" rel="noopener">打开 PDF ↗</a><a class="black" href="${url}" download="${esc(d.name)}">下载 PDF</a></div>`,'查看 PDF 资料');
    if(!d.sample)el.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
  }
  function editCategory(id){const d=docs.find(d=>d.id===id);if(!d)return;dialog(`<form id="a-category-form" data-docid="${d.id}"><div class="panelhead"><h2>调整资料分类</h2>${closeButton()}</div><p>${esc(d.name)}</p><label class="a-field">资料分类<select name="category">${Object.entries(categories).map(([k,v])=>`<option value="${k}" ${d.category===k?'selected':''}>${v}</option>`).join('')}</select></label>${d.sample?'<p class="a-soft-note">示例回答按原定主题展示。更改分类会影响该文件的可用范围。</p>':''}<p class="red" id="a-category-error" role="alert"></p><div class="formactions"><button class="black">保存分类</button></div></form>`,'调整资料分类');}
  async function onClick(e){
    const b=e.target.closest('button');if(!b)return;
    try{
      if(b.dataset.amode){mode=b.dataset.amode;render();return;}
      if(b.dataset.aprompt){send(b.dataset.aprompt);return;}
      if(b.dataset.adoc){showDocument(b.dataset.adoc);return;}
      if(b.dataset.acopy){const msg=Object.values(chats).flat().find(m=>m.id===b.dataset.acopy);const r=msg?.answer;if(r){const text=['【示例回答】',r.title,r.intro,...r.blocks.map(v=>v.title+'\n'+(v.text||'')+'\n'+(v.items||[]).join('\n')),r.followup||'',...r.sources.map(s=>(docs.find(d=>d.id===s.id)?.name||'')+' '+s.pages)].join('\n\n');try{await navigator.clipboard.writeText(text);ctx.notify('已复制示例回答与来源');}catch{ctx.notify('浏览器未允许剪贴板，请选中回答文字复制。');}}return;}
      if(b.dataset.aremove!==undefined){pending.splice(Number(b.dataset.aremove),1);await selectFiles([]);return;}
      if(b.dataset.aedit&&leader()){editCategory(b.dataset.aedit);return;}
      if(b.dataset.atoggle&&leader()){const d=docs.find(d=>d.id===b.dataset.atoggle);if(d){const updated={...d,enabled:!d.enabled};await storeDocument(updated);Object.assign(d,updated);render();ctx.notify(d.enabled?'演示资料已启用':'演示资料已停用，新的回答将排除此资料');}return;}
      if(b.dataset.adelete&&leader()){const d=docs.find(d=>d.id===b.dataset.adelete);if(d)dialog(`<div class="panelhead"><h2>移除本地资料</h2>${closeButton()}</div><p>将从当前浏览器移除“${esc(d.name)}”。可以重新上传。</p><div class="formactions"><button class="quiet" data-aaction="close-dialog">取消</button><button class="black" data-aconfirmdelete="${d.id}">确认移除</button></div>`,'确认移除本地资料');return;}
      if(b.dataset.aconfirmdelete&&leader()){const d=docs.find(d=>d.id===b.dataset.aconfirmdelete);if(d&&!d.sample){await storeDocument(d,true);docs=docs.filter(v=>v.id!==d.id);root.querySelector('dialog')?.close();ctx.notify('已移除本地资料');}return;}
      const action=b.dataset.aaction;
      if(action==='new-chat'){chats[mode]=[];drafts[mode]='';render();}
      if(action==='manage'&&leader())ctx.navigate('knowledge');
      if(action==='back-assistants')ctx.navigate('assistants');
      if(action==='upload'&&leader())uploadDialog();
      if(action==='close-dialog'&&!uploadBusy)root.querySelector('dialog')?.close();
      if(action==='clear-filters'){filter='';category=status='all';render();}
    }catch{ctx?.notify('操作未保存，请检查浏览器本地存储后重试。');}
  }
  function onInput(e){
    if(e.target.id==='a-question')drafts[mode]=e.target.value;
    if(e.target.id==='a-customer-note')customer.note=e.target.value;
    if(e.target.id==='a-file-search'){
      filter=e.target.value;const list=docs.filter(d=>(d.name+' '+categories[d.category]).toLowerCase().includes(filter.toLowerCase())&&(category==='all'||d.category===category)&&(status==='all'||status==='pending'&&!d.sample||status==='enabled'&&d.sample&&d.enabled||status==='disabled'&&d.sample&&!d.enabled));root.querySelector('#a-file-results').innerHTML=fileResults(list);
    }
  }
  function onChange(e){
    const id=e.target.id;
    if(id==='a-file-category'){category=e.target.value;render();}
    if(id==='a-file-status'){status=e.target.value;render();}
    if(id==='a-upload-input')selectFiles(e.target.files).catch(()=>ctx.notify('读取文件失败，请重新选择。'));
    if(id==='a-upload-category')uploadCategory=e.target.value;
    if(id==='a-customer-product')customer.product=e.target.value;
    if(id==='a-customer-stage')customer.stage=e.target.value;
  }
  function onSubmit(e){
    e.preventDefault();
    if(e.target.id==='a-chat-form')send(root.querySelector('#a-question').value);
    if(e.target.id==='a-upload-form')saveUpload();
    if(e.target.id==='a-category-form'&&leader()){
      const d=docs.find(d=>d.id===e.target.dataset.docid),cat=new FormData(e.target).get('category');
      if(d&&categories[cat]){const updated={...d,category:cat};storeDocument(updated).then(()=>{Object.assign(d,updated);root.querySelector('dialog')?.close();ctx.notify('资料分类已更新');}).catch(()=>{root.querySelector('#a-category-error').textContent='分类保存失败，请重试。';});}
    }
  }
  function onKeydown(e){
    if(e.target.id==='a-question'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send(e.target.value);}
    if(e.target.dataset.amode&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const keys=Object.keys(modes),i=keys.indexOf(mode);mode=e.key==='Home'?keys[0]:e.key==='End'?keys.at(-1):keys[(i+(e.key==='ArrowRight'?1:2))%3];render();root.querySelector(`[data-amode="${mode}"]`).focus();}
  }
  window.InsuranceAssistants={mount,reset};
})();
