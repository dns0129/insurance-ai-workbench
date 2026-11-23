(() => {
  const {inline,plain,summary,play,nearBottom}=window.InsuranceReply;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({spark:'<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/>',book:'<path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15"/>',chat:'<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 1-6a9 9 0 1 1 18-5Z"/><path d="M7 10h10M7 14h6"/>',file:'<path d="M6 3h8l4 4v14H6Z M14 3v5h4M9 12h6M9 16h4"/>',up:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z m-4 9 3 3 5-6"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',down:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',check:'<path d="m5 12 4 4L19 6"/>',list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',quote:'<path d="M10 7a5 5 0 0 0-5 5v4h5v-5H6m13-4a5 5 0 0 0-5 5v4h5v-5h-4"/>'})[name] || ''}</svg>`;
  const categories = {product:'保险产品',team:'公司与团队',objection:'异议处理'};
  const modes = {
    product:{title:'产品知识助手',icon:'spark',greeting:'这次，想为哪位客户找到保障？',description:'一起读懂产品资料，梳理适合人群，再把原始 PDF 带给你。',prompts:['团队目前有哪些产品？','医疗保障适合哪些客户？','重疾保障有什么优势？'],placeholder:'问产品特点、适合人群，或描述客户的保障需求…'},
    team:{title:'保险新人助手',icon:'book',greeting:'第一周，先把要做的事理清。',description:'了解团队、梳理晋升与佣金流程，找到系统使用的下一步。',prompts:['介绍一下公司和团队','新人第一周应该做什么？','晋升流程是怎样的？','佣金如何发放和核对？','工作台怎么使用？'],placeholder:'问团队情况、晋升、佣金，或系统如何使用…'},
    objection:{title:'保险异议处理',icon:'chat',greeting:'先理解顾虑，再一起找到回应。',description:'告诉我客户的原话，整理回应思路、参考话术和下一步追问。',prompts:['客户觉得保费太高','客户说已经有保险了','客户担心理赔问题','客户想对比其他产品'],placeholder:'输入客户的原话，例如：“一年交这么多，感觉不太划算”…'}
  };
  const bytes = n => n<1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  const date = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'});
  const chats={product:[],team:[],objection:[]}, drafts={product:'',team:'',objection:''};
  const compactPreview=matchMedia('(max-width: 980px)');
  const previewIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M14 4.5v15m3-10 1.5 2.5L17 14.5"/></svg>';
  const closeIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  let preview={open:false,id:'',page:1,cited:false};
  let unmountPdf;
  let root,ctx,view,actorKey='',version=0,requestId=0,docs=[],ai={},loaded=false,loading=false,loadError='';
  let mode='product',busy='',filter='',category='all',status='all',pending=[],uploadCategory='product',uploadBusy=false;
  let probe={open:false,category:'product',query:'',matches:null,error:'',busy:false};
  const leader=()=>ctx?.actor.role==='leader';
  const enabled=cat=>docs.filter(d=>d.enabled&&(!cat||d.category===cat));
  const active=key=>version===key&&root?.isConnected;
  const choices=selected=>Object.entries(categories).map(([k,v])=>`<option value="${k}" ${k===selected?'selected':''}>${v}</option>`).join('');
  const currentFile=id=>docs.find(d=>d.id===id);
  const pageLabel=page=>`第 ${page} 页`;
  compactPreview.addEventListener('change',syncPreview);
  function reset(){
    unmountPdf?.();unmountPdf=null;
    version++;requestId++;actorKey='';root=null;ctx=null;mode='product';busy='';pending=[];uploadBusy=false;
    docs=[];ai={};loaded=loading=false;loadError='';filter='';category=status='all';uploadCategory='product';
    probe={open:false,category:'product',query:'',matches:null,error:'',busy:false};
    preview={open:false,id:'',page:1,cited:false};
    for(const key of Object.keys(modes)){chats[key]=[];drafts[key]='';}
  }
  function mount(element,options){
    const key=options.actor.role+':'+(options.actor.agent_id||'leader');
    if(actorKey!==key){reset();actorKey=key;}
    if(root!==element){unmountPdf?.();unmountPdf=null;}
    root=element;ctx=options;view=options.page;
    root.onclick=onClick;root.oninput=onInput;root.onchange=onChange;root.onsubmit=onSubmit;root.onkeydown=onKeydown;
    root.ondragover=e=>{if(e.target.closest('.a-dropzone'))e.preventDefault();};
    root.ondrop=e=>{if(e.target.closest('.a-dropzone')){e.preventDefault();selectFiles(e.dataTransfer.files);}};
    loadDocuments();
    render();
  }
  async function loadDocuments(){
    if(loading)return;
    loading=true;
    const current=version;
    try{
      const data=await ctx.api('/knowledge/documents');
      if(version!==current)return;
      docs=data.documents;ai=data.ai;loadError='';loaded=true;
    }catch(error){if(version===current)loadError=error.message;}
    finally{if(version===current){loading=false;render();}}
  }
  function render(){
    if(!root?.isConnected||root.querySelector('.a-dialog[open]'))return;
    const previous=document.activeElement,isForm=root.contains(previous)&&previous.matches('input,textarea,select');
    const focusId=isForm?previous.id:'',cursor=isForm?previous.selectionStart:null;
    const scroll=root.querySelector('#a-messages')?.scrollTop;
    if(view==='knowledge'&&leader()){
      unmountPdf?.();unmountPdf=null;
      root.innerHTML=knowledgeView();
    }
    else{
      const layout=root.querySelector('.a-layout');
      if(layout){
        layout.dataset.assistant=mode;
        root.querySelector('.a-tabs').outerHTML=assistantTabs();
        layout.querySelector('.a-chat').outerHTML=chatView();
      }else{
        root.innerHTML=`${assistantTabs()}<div class="a-layout" data-assistant="${mode}">${chatView()}${previewShell()}</div>`;
        root.querySelector('#a-pdf-panel').addEventListener('cancel',event=>{event.preventDefault();closePreview();});
      }
      syncPreview();
    }
    const replacement=focusId?document.getElementById(focusId):null;
    if(replacement){replacement.focus({preventScroll:true});if(typeof cursor==='number'&&replacement.setSelectionRange)replacement.setSelectionRange(cursor,cursor);}
    if(typeof scroll==='number'&&root.querySelector('#a-messages'))root.querySelector('#a-messages').scrollTop=scroll;
  }
  function assistantTabs(){
    return `<div class="a-tabs" role="tablist" aria-label="选择团队助理">${Object.entries(modes).map(([key,v])=>`<button role="tab" id="a-tab-${key}" aria-selected="${mode===key}" aria-controls="a-tabpanel" tabindex="${mode===key?'0':'-1'}" data-amode="${key}"><span class="a-tab-icon">${icon(v.icon)}</span><span><strong>${v.title}</strong></span>${icon('arrow')}</button>`).join('')}</div>`;
  }
  function chatView(){
    const m=modes[mode],history=chats[mode],thinking=busy===mode;
    const state=!loaded?(loadError?'资料未加载':'正在连接'):(ai.configured?'连接已配置':ai.reason==='login'?'待登录 ChatGPT':'模型未连接');
    return `<section class="a-chat panel" id="a-tabpanel" role="tabpanel" aria-labelledby="a-tab-${mode}">
      <div class="a-chat-head"><div><span class="a-online ${ai.configured?'is-ready':''}"></span><strong>${m.title}</strong><span class="a-badge">${state}</span></div><div class="a-chat-tools"><button class="a-textbtn" data-aaction="new-chat" ${thinking?'disabled':''}>＋ 新对话</button><button class="a-preview-toggle" id="a-preview-toggle" data-aaction="toggle-preview" aria-expanded="${preview.open}" aria-controls="a-pdf-panel">${previewIcon}<span>PDF 预览</span></button></div></div>
      <div class="a-messages" id="a-messages" role="log" aria-label="${m.title}对话" aria-live="polite" aria-busy="${thinking}">${history.length?history.map(messageView).join(''):welcome(m)}${thinking?`<div class="a-thinking">${icon('spark')} 正在查团队资料并整理回答…</div>`:''}</div>
      <form id="a-chat-form" class="a-composer"><label class="sr" for="a-question">${m.title}提问</label><textarea id="a-question" rows="2" maxlength="1600" required placeholder="${m.placeholder}">${esc(drafts[mode])}</textarea><div class="a-compose-bottom"><span>${icon('shield')}依据启用的团队资料回答</span><button class="black" type="submit" ${busy?'disabled':''}>${thinking?'整理中…':'发送'} ${icon('arrow')}</button></div></form>
      <p class="a-demo-note">${loadError?esc(loadError):'请勿填写姓名、证件号、保单号或健康病史。'}</p></section>`;
  }
  function welcome(m){return `<div class="a-welcome"><span class="a-hero-icon">${icon(m.icon)}</span><h2>${m.greeting}</h2><p>${m.description}</p><div class="a-prompts">${m.prompts.map(p=>`<button data-aprompt="${esc(p)}" ${busy?'disabled':''}>${p}${icon('arrow')}</button>`).join('')}</div></div>`;}
  function previewShell(){
    return `<dialog class="a-pdf-panel" id="a-pdf-panel" aria-labelledby="a-pdf-title">
      <header class="a-pdf-header"><span class="a-pdf-mark">${previewIcon}</span><h3 id="a-pdf-title">PDF 预览</h3><button class="a-pdf-close" data-aaction="close-preview" aria-label="收起 PDF 预览" title="收起 PDF 预览" autofocus>${closeIcon}</button></header>
      <div class="a-pdf-content"></div>
    </dialog>`;
  }
  function previewFiles(items){
    return `<section class="a-pdf-library" aria-labelledby="a-pdf-files-title"><div class="a-pdf-library-head"><h4 id="a-pdf-files-title">${categories[mode]}</h4><span>${items.length} 份资料</span></div>
      <div class="a-pdf-files">${items.map(d=>`<button data-apdf="${esc(d.id)}"><span class="a-pdf-file-icon">${icon('file')}</span><span><strong>${esc(d.name)}</strong><small>${d.sample?'示例资料':'团队资料'} · ${d.pages} 页</small></span>${icon('arrow')}</button>`).join('')||`<p>${loading?'正在读取资料…':'暂无启用的 PDF 资料。'}</p>`}</div>
      ${leader()?`<button class="a-pdf-manage" data-aaction="manage">${icon('book')} 管理团队知识库</button>`:''}</section>`;
  }
  function previewDocument(doc){
    const location=`${esc(doc.url)}#page=${preview.page}`;
    return `<div class="a-pdf-bar"><button class="a-pdf-back" data-aaction="pdf-files" title="返回资料列表" aria-label="返回资料列表">${icon('arrow')}</button><div class="a-pdf-filename"><strong title="${esc(doc.name)}">${esc(doc.name)}</strong><small>${preview.cited?`引用位置：${pageLabel(preview.page)} · `:''}共 ${doc.pages} 页</small></div><a class="a-pdf-action" href="${esc(doc.downloadUrl)}" download title="下载 PDF" aria-label="下载 PDF">${icon('down')}</a></div>
      <div class="a-pdf-viewer"><div class="a-pdf-scroll" tabindex="0" role="region" aria-label="PDF 页面"><p class="a-pdf-status" role="status">正在读取 PDF…</p><div class="a-pdf-paper"></div></div>
      <div class="a-pdf-tools" aria-label="PDF 页面工具"><div><button data-pdf-step="-1" aria-label="上一页" title="上一页" disabled>${icon('arrow')}</button><output class="a-pdf-page-number" aria-live="polite">${preview.page} / ${doc.pages}</output><button data-pdf-step="1" aria-label="下一页" title="下一页" disabled>${icon('arrow')}</button></div><div><button data-pdf-zoom="-1" aria-label="缩小" title="缩小" disabled>−</button><button data-pdf-zoom="1" aria-label="放大" title="放大" disabled>+</button></div></div></div>
      <div class="a-pdf-footer"><a href="${location}" target="_blank" rel="noopener">在新标签打开 ${icon('arrow')}</a></div>`;
  }
  async function loadPdf(viewer,doc,page){
    try{
      const {mountPdf}=await import('/pdf-preview.js');
      if(viewer.isConnected)unmountPdf=mountPdf(viewer,{url:doc.url,page});
    }catch{
      if(viewer.isConnected)viewer.querySelector('.a-pdf-status').textContent='PDF 无法预览。可以在新标签打开或下载原文件。';
    }
  }
  function syncPreview(reload=false){
    const panel=root?.querySelector('#a-pdf-panel');
    if(!panel||view!=='assistants'||root.closest('[hidden]'))return;
    const visible=preview.open;
    panel.parentElement.toggleAttribute('data-preview-open',visible);
    root.querySelector('#a-preview-toggle').setAttribute('aria-expanded',visible);
    root.querySelector('#a-preview-toggle').title=visible?'收起 PDF 预览':'展开 PDF 预览';
    if(!visible){if(panel.open)panel.close();return;}
    const content=panel.querySelector('.a-pdf-content');
    const doc=currentFile(preview.id);
    const items=doc?[]:enabled(mode);
    const key=JSON.stringify(doc?[doc.id,preview.page,preview.cited]:[mode,loading,items]);
    if(reload===true||content.dataset.rendered!==key){
      unmountPdf?.();unmountPdf=null;
      content.innerHTML=doc?previewDocument(doc):previewFiles(items);
      content.dataset.rendered=key;
      if(doc)loadPdf(content.querySelector('.a-pdf-viewer'),doc,preview.page);
    }
    const modal=compactPreview.matches;
    if(panel.open&&panel.matches(':modal')!==modal)panel.close();
    if(!panel.open){if(modal)panel.showModal();else panel.show();}
  }
  function openPdf(id,page){
    const doc=currentFile(id);
    if(!doc){ctx.notify('这份资料已经不可用。');return;}
    preview={open:true,id,page:Math.max(1,Math.min(doc.pages,page||1)),cited:!!page};
    syncPreview(true);
    root.querySelector('.a-pdf-header button')?.focus({preventScroll:true});
  }
  function closePreview(){
    preview.open=false;
    syncPreview();
    root.querySelector('#a-preview-toggle')?.focus({preventScroll:true});
  }
  function productItem(item,sources,citations){
    const parts=item.match(/^([^：:\r\n]{1,100})([：:])([\s\S]+)$/);
    if(!parts)return inline(item);
    let [,label,colon,detail]=parts;
    if(label.startsWith('**')&&!label.endsWith('**')&&detail.startsWith('**')){
      label=label.slice(2);
      detail=detail.slice(2);
    }
    label=plain(label).replace(/`([^`\n]+)`/g,'$1');
    const productCodes=value=>value.normalize('NFKC').match(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g)||[];
    const code=productCodes(label).find(code=>/\d/.test(code));
    const exactTitle=label.trim();
    const ordered=[...sources].sort((a,b)=>Number(citations.includes(b.ref))-Number(citations.includes(a.ref)));
    const source=code?ordered.find(s=>productCodes(s.name).includes(code))||
      ordered.find(s=>{const codes=new Set(productCodes(s.excerpt));return codes.size===1&&codes.has(code);})||
      ordered.find(s=>productCodes(s.excerpt).includes(code)):
      ordered.find(s=>exactTitle.length>=4&&s.name.includes(exactTitle));
    const title=source?`<a class="a-product-link" href="${esc(source.url)}#page=${source.page}" data-acitesource="${esc(source.id)}" data-acitepage="${source.page}" title="预览原文 · ${pageLabel(source.page)}">${esc(label)}</a>`:`<strong>${esc(label)}</strong>`;
    return `${title}${colon}${inline(detail)}`;
  }
  function messageView(message){
    if(message.role==='user')return `<div class="a-user-message"><span>${esc(message.text)}</span><small>你</small></div>`;
    if(message.role==='error')return `<div class="a-chat-error" role="alert">${esc(message.text)}<button class="quiet" data-aaction="retry" ${busy?'disabled':''}>重试</button></div>`;
    const r=message.answer;
    return `<article class="a-reply ai-response" data-reply="${message.id}" tabindex="-1" aria-labelledby="a-reply-title-${message.id}">
    <header class="reply-meta"><span class="reply-symbol">${icon(modes[message.mode].icon)}</span><strong>${modes[message.mode].title}</strong><span class="reply-badge">${r.sample?'示例资料练习':r.status==='insufficient'?'资料不足':'引用团队资料'}</span><button type="button" class="reply-skip" data-reveal-skip hidden>显示全文</button></header>
    <h3 id="a-reply-title-${message.id}">${inline(r.title)}</h3><div data-reveal="text" class="a-reply-summary"><span class="reply-section-icon">${icon('check')}</span><p>${summary(r.intro)}</p></div>
    ${r.blocks.map(b=>`<section class="a-answer-block ${b.tone==='a-script'?'a-script':''}"><h4 class="reply-section-title" data-reveal="block"><span class="reply-section-icon">${icon(b.tone==='a-script'?'quote':'list')}</span><span>${inline(b.title)}</span></h4>${b.text?`<p data-reveal="text">${inline(b.text)}</p>`:''}${b.items.length?`<ul>${b.items.map(t=>`<li data-reveal="text">${message.mode==='product'?productItem(t,r.sources,b.citations):inline(t)}</li>`).join('')}</ul>`:''}<div class="a-citations" data-reveal="block">${b.citations.map(c=>{const src=r.sources.find(s=>s.ref===c);return src?`<button class="a-cite" data-acitesource="${src.id}" data-acitepage="${src.page}">${esc(c)} · ${pageLabel(src.page)}</button>`:'';}).join('')}</div></section>`).join('')}
    ${r.followup?`<div class="a-followup" data-reveal="block">${icon('chat')}<div><strong>下一步</strong><p>${inline(r.followup)}</p></div></div>`:''}${r.sources.length?`<div class="a-sources" data-reveal="tail"><h4><span class="reply-section-title"><span class="reply-section-icon">${icon('book')}</span>参考资料</span><small>${r.sources.length} 条页码引用</small></h4>${r.sources.map(source=>attachment(source,true)).join('')}</div>`:''}
    ${r.status==='grounded'?`<div class="a-reply-actions" data-reveal="tail"><button class="a-textbtn" data-acopy="${message.id}">复制回答</button><span>${r.sample?'示例资料不代表实际产品或公司制度':'使用前请核对原文与有效版本'}</span></div>`:''}${r.suggestions?.length?`<div class="a-follow-chips" data-reveal="tail">${r.suggestions.map(p=>`<button data-aprompt="${esc(p)}" ${busy?'disabled':''}>${esc(p)} ${icon('arrow')}</button>`).join('')}</div>`:''}</article>`;
  }
  function attachment(s,inPanel=false){
    const open=inPanel?`<button class="a-textbtn a-source-link" data-acitesource="${esc(s.id)}" data-acitepage="${s.page}">预览第 ${s.page} 页</button>`:
      `<a class="a-textbtn" href="${esc(s.url)}#page=${s.page}" target="_blank" rel="noopener">打开第 ${s.page} 页</a>`;
    return `<details class="a-source-detail"><summary>${icon('file')}<span>${esc(s.name)}<small>${s.ref?esc(s.ref)+' · ':''}${pageLabel(s.page)}${s.sample?' · 示例':''}</small></span></summary><div><p>${esc(s.excerpt)}</p>${open}<a class="a-textbtn" href="${esc(s.downloadUrl)}" download>下载 PDF</a></div></details>`;
  }
  async function send(raw){
    const question=raw.trim();if(!question||busy||question.length>1600)return;
    const selected=mode,current=version,serial=++requestId;
    const messages=chats[selected];
    const history=messages.filter((m,i)=>m.role==='user'&&messages[i+1]?.role==='assistant').slice(-3).map(m=>m.text);
    messages.push({role:'user',text:question});drafts[selected]='';busy=selected;render();scrollMessages();
    let replyId;
    try{
      const answer=await ctx.api('/knowledge/ask',{method:'POST',body:JSON.stringify({mode:selected,question,history})});
      if(version===current){replyId=String(serial);messages.push({id:replyId,role:'assistant',mode:selected,answer});}
    }catch(error){if(version===current)messages.push({role:'error',text:error.message,question});}
    finally{
      if(version===current){
        const previous=root?.querySelector('#a-messages'),follow=!previous||nearBottom(previous);
        busy='';render();
        if(selected===mode&&view==='assistants'){
          const area=root?.querySelector('#a-messages');
          if(replyId)play(area?.querySelector(`[data-reply="${replyId}"]`),area,follow);
          else if(follow)scrollMessages();
        }
      }
    }
  }
  function scrollMessages(){requestAnimationFrame(()=>{const area=root?.querySelector('#a-messages');if(area)area.scrollTop=area.scrollHeight;});}
  const filteredDocs=()=>docs.filter(d=>(d.name+' '+categories[d.category]).toLowerCase().includes(filter.toLowerCase())&&(category==='all'||d.category===category)&&(status==='all'||(status==='enabled')===d.enabled));
  function knowledgeView(){
    const totalChunks=docs.reduce((sum,d)=>sum+(d.enabled?d.chunks:0),0);
    return `<section class="a-kb-banner"><div><span class="a-eyebrow">团队资料维护</span><h2>把团队经验，变成可查的依据。</h2><p>上传产品条款、团队制度和沟通手册。入库后，助手会按分类搜索，并在回答里标出 PDF 页码。</p></div><button class="black" data-aaction="upload">${icon('up')} 上传 PDF</button></section>
    <div class="a-kb-metrics"><div><strong>${docs.filter(d=>!d.sample).length}</strong><span>正式资料</span></div><div><strong>${enabled().length}</strong><span>当前启用</span></div><div><strong>${totalChunks}</strong><span>可检索片段</span></div><div><strong>${docs.filter(d=>d.sample).length}</strong><span>示例 PDF</span></div></div>
    ${loadError?`<p class="a-local-note" role="alert">${esc(loadError)} <button class="quiet" data-aaction="reload">重新加载</button></p>`:!loaded?`<p class="a-local-note" role="status">正在读取团队资料…</p>`:''}
    <section class="panel a-kb-panel"><div class="a-kb-heading"><div><h2>资料库</h2><p>停用后，助手的新回答不会使用这份资料。</p></div><button class="quiet" data-aaction="back-assistants">进入团队助手 ${icon('arrow')}</button></div>
    <div class="a-kb-toolbar"><div class="a-search">${icon('search')}<input id="a-file-search" aria-label="搜索资料" placeholder="搜索文件名或分类" value="${esc(filter)}"></div><select id="a-file-category" aria-label="筛选资料分类"><option value="all">全部分类</option>${choices(category)}</select><select id="a-file-status" aria-label="筛选资料状态">${[['all','全部状态'],['enabled','已启用'],['disabled','已停用']].map(([k,v])=>`<option value="${k}" ${status===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div id="a-file-results">${fileResults(filteredDocs())}</div></section>
    <section class="panel a-retrieval" aria-labelledby="a-retrieval-title"><div class="a-kb-heading"><div><h2 id="a-retrieval-title">检查助手能查到什么</h2><p>输入一个实际问题，查看助手会收到哪些原文片段。</p></div><button class="quiet" data-aaction="probe" aria-expanded="${probe.open}" aria-controls="a-probe-panel">${probe.open?'收起':'试查资料'} ${icon('search')}</button></div><div id="a-probe-panel" ${probe.open?'':'hidden'}>${probe.open?probeView():''}</div></section>`;
  }
  function fileResults(matches){
    if(!matches.length)return `<div class="a-file-empty">${icon('search')}<h3>${docs.length?'没有找到相关资料':'暂无资料'}</h3><p>${docs.length?'试试其他文件名，或调整分类与状态。':'上传第一份可复制文字的 PDF。'}</p>${docs.length?'<button class="quiet" data-aaction="clear-filters">重置筛选</button>':''}</div>`;
    return `<div class="tablewrap"><table class="a-file-table" aria-label="团队知识库资料"><thead><tr><th>文件名称</th><th>分类</th><th>状态</th><th>更新日期</th><th>操作</th></tr></thead><tbody>${matches.map(d=>`<tr><td><button class="a-file-name" data-adoc="${d.id}">${icon('file')}<span>${esc(d.name)}<small>${bytes(d.size)} · ${d.pages} 页 · ${d.sample?'示例':'正式资料'}</small></span></button></td><td>${categories[d.category]}</td><td><span class="a-status ${d.enabled?'':'a-pending'}">${d.enabled?'● 已启用':'○ 已停用'}</span><small class="a-index-count">${d.chunks} 个片段</small></td><td>${date.format(new Date(d.updated))}</td><td><div class="a-file-actions"><button class="a-textbtn" data-adoc="${d.id}">查看</button>${d.sample?'':`<button class="a-textbtn" data-aedit="${d.id}">分类</button>`}<button class="a-textbtn" data-atoggle="${d.id}">${d.enabled?'停用':'启用'}</button>${d.sample?'':`<button class="a-textbtn red" data-adelete="${d.id}">移除</button>`}</div></td></tr>`).join('')}</tbody></table></div><div class="a-file-total">共 ${matches.length} 份资料<span>PDF · 单文件最多 15 MB</span></div>`;
  }
  function probeView(){return `<form id="a-probe-form" class="a-probe-form"><label>选择分类<select id="a-probe-category">${choices(probe.category)}</select></label><label>搜索内容<input id="a-probe-query" required maxlength="200" placeholder="例如：佣金什么时候核对？" value="${esc(probe.query)}"></label><button type="submit" class="black" ${probe.busy?'disabled':''}>${probe.busy?'检索中…':'检索'}</button></form><div aria-live="polite">${probe.error?`<p class="red">${esc(probe.error)}</p>`:probe.matches?probe.matches.length?`<div class="a-probe-results"><p>找到 ${probe.matches.length} 条资料片段</p>${probe.matches.map(source=>attachment(source)).join('')}</div>`:'<p class="a-rail-note">没有命中启用资料。试试更具体的制度名称、条款或客户顾虑。</p>':''}</div>`;}
  async function runProbe(){
    if(!probe.query.trim()||probe.busy)return;
    const current=version;
    probe.busy=true;probe.matches=null;probe.error='';render();
    try{
      const result=await ctx.api('/knowledge/search?'+new URLSearchParams({category:probe.category,q:probe.query.trim()}));
      if(version===current)probe.matches=result.matches;
    }catch(error){if(version===current)probe.error=error.message;}
    finally{if(version===current){probe.busy=false;render();}}
  }
  function dialog(content,label){
    const previous=document.activeElement;
    root.querySelector('dialog')?.remove();
    const el=document.createElement('dialog');el.className='a-dialog';el.setAttribute('aria-label',label);el.innerHTML=content;root.append(el);
    el.addEventListener('cancel',e=>{if(uploadBusy)e.preventDefault();});
    el.addEventListener('close',()=>{el.remove();if(previous?.isConnected)previous.focus({preventScroll:true});render();});
    el.showModal();return el;
  }
  const closeButton=()=>'<button class="a-textbtn" type="button" data-aaction="close-dialog" aria-label="关闭对话框">关闭 ×</button>';
  function uploadDialog(){
    pending=[];
    dialog(`<form id="a-upload-form"><div class="panelhead"><div><h2>添加团队资料</h2><p>PDF 会先提取文字，再按页入库。</p></div>${closeButton()}</div><div class="a-dropzone"><span>${icon('up')}</span><strong>拖放 PDF 到这里，或选择文件</strong><small>一次最多 10 份 · 每份最多 15 MB、250 页</small><input type="file" id="a-upload-input" accept=".pdf,application/pdf" multiple aria-label="选择要上传的 PDF"></div><label class="a-field">资料分类<select id="a-upload-category">${choices(uploadCategory)}</select></label><div id="a-pending-files"></div><p id="a-upload-progress" role="status"></p><p id="a-upload-error" class="red" role="alert"></p><p class="a-soft-note">请上传团队有权使用、可复制文字的文件。纯扫描件请先做 OCR。</p><div class="formactions"><button type="button" class="quiet" data-aaction="close-dialog">取消</button><button class="black" id="a-upload-save" disabled>上传并入库</button></div></form>`,'上传 PDF 资料');
  }
  function renderPending(el,errors=[]){
    if(!el?.isConnected)return;
    el.querySelector('#a-pending-files').innerHTML=pending.map((f,i)=>`<div class="a-pending-file">${icon('file')}<span>${esc(f.name)}<small>${bytes(f.size)}</small></span><button type="button" class="a-textbtn" data-aremove="${i}" aria-label="取消选择 ${esc(f.name)}" ${uploadBusy?'disabled':''}>移除</button></div>`).join('');
    const save=el.querySelector('#a-upload-save');save.disabled=uploadBusy||!pending.length;
    el.querySelector('#a-upload-error').textContent=errors.join('；');
  }
  async function selectFiles(files){
    const el=root?.querySelector('dialog[open]'),input=el?.querySelector('#a-upload-input');
    if(uploadBusy||!leader()||!input)return;
    const errors=[],selected=Array.from(files);input.value='';
    for(const file of selected.slice(0,10)){
      if(!el.isConnected)break;
      if(pending.length>=10){errors.push('一次最多上传 10 份 PDF');break;}
      if(!/\.pdf$/i.test(file.name)||file.size>15*1024**2){errors.push(file.name+'：请选择 15 MB 内的 PDF');continue;}
      if(pending.some(f=>f.name===file.name&&f.size===file.size))continue;
      try{
        if(await file.slice(0,5).text()!=='%PDF-'){errors.push(file.name+'：不是有效的 PDF 文件');continue;}
        if(el.isConnected&&!uploadBusy&&pending.length<10&&!pending.some(f=>f.name===file.name&&f.size===file.size))pending.push(file);
      }catch{errors.push(file.name+'：浏览器无法读取文件');}
    }
    if(selected.length>10)errors.push('一次最多上传 10 份 PDF');
    renderPending(el,errors);
  }
  async function saveUpload(){
    const el=root?.querySelector('dialog[open]'),current=version;
    if(!leader()||uploadBusy||!pending.length||!el)return;
    const files=[...pending],chosen=uploadCategory,errors=[],save=el.querySelector('#a-upload-save');
    const controls=el.querySelectorAll('input,select,[data-aaction="close-dialog"]');
    uploadBusy=true;controls.forEach(node=>node.disabled=true);save.textContent='正在入库…';renderPending(el);
    let added=0;
    for(const [i,file] of files.entries()){
      if(version!==current||!el.isConnected)break;
      el.querySelector('#a-upload-progress').textContent=`正在解析第 ${i+1} / ${files.length} 份：${file.name}`;
      try{
        const params=new URLSearchParams({name:file.name,category:chosen});
        const {document}=await ctx.api('/knowledge/documents?'+params,{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});
        if(version===current){docs.unshift(document);pending=pending.filter(item=>item!==file);added++;}
      }catch(error){errors.push(file.name+'：'+error.message);}
    }
    if(version!==current)return;
    uploadBusy=false;controls.forEach(node=>node.disabled=false);save.textContent='上传并入库';
    if(el.isConnected){
      el.querySelector('#a-upload-progress').textContent=added?`已入库 ${added} 份。`:'';
      renderPending(el,errors);
      if(!errors.length)el.close();
    }
    if(added)ctx.notify(`已入库 ${added} 份 PDF，助手现在可以按分类检索。`);
    render();
  }
  function showDocument(id,page){
    const d=currentFile(id),source=chats[mode].filter(m=>m.answer).flatMap(m=>m.answer.sources).find(s=>s.id===id&&s.page===page);
    if(!d&&!source)return;
    const item=d||source, title=d?categories[d.category]:'参考资料';
    dialog(`<div class="panelhead"><div><span class="a-eyebrow">${title} · ${item.sample?'示例 PDF':'团队 PDF'}</span><h2>${esc(item.name)}</h2></div>${closeButton()}</div><div class="a-doc-preview">${icon('file')}<p>${source?esc(source.excerpt):d?d.pages+' 页 · '+d.chunks+' 个文字片段':''}</p><small>${page?pageLabel(page)+' · ':''}${item.sample?'示例内容仅供练习':d?.enabled===false?'已停用':'请核对原文和有效版本'}</small></div><div class="formactions"><a class="quiet" href="${esc(item.url)}${page?'#page='+page:''}" target="_blank" rel="noopener">打开 PDF</a><a class="black" href="${esc(item.downloadUrl)}" download>下载 PDF</a></div>`,'查看 PDF 资料');
  }
  function editCategory(id){
    const d=currentFile(id);if(!d||d.sample)return;
    dialog(`<form id="a-category-form" data-docid="${d.id}"><div class="panelhead"><h2>调整资料分类</h2>${closeButton()}</div><p>${esc(d.name)}</p><label class="a-field">资料分类<select name="category">${choices(d.category)}</select></label><p class="red" id="a-edit-error" role="alert"></p><div class="formactions"><button class="black">保存分类</button></div></form>`,'调整资料分类');
  }
  async function updateFile(id,fields){
    const current=version;
    const {document}=await ctx.api('/knowledge/documents/'+id,{method:'PATCH',body:JSON.stringify(fields)});
    if(version===current)docs=docs.map(d=>d.id===id?document:d);
  }
  async function onClick(e){
    const b=e.target.closest('button,a[data-acitesource]');if(!b)return;
    const current=version;
    try{
      if(b.dataset.amode){mode=b.dataset.amode;render();root.querySelector('#a-tab-'+mode)?.focus({preventScroll:true});return;}
      if(b.dataset.aprompt){send(b.dataset.aprompt);return;}
      if(b.dataset.adoc){showDocument(b.dataset.adoc);return;}
      if(b.dataset.apdf){openPdf(b.dataset.apdf);return;}
      if(b.dataset.acitesource){
        if(b.tagName==='A'&&(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey))return;
        e.preventDefault();
        openPdf(b.dataset.acitesource,Number(b.dataset.acitepage));return;
      }
      if(b.dataset.acopy){
        const r=chats[mode].find(m=>m.id===b.dataset.acopy)?.answer;
        if(r){
          const text=[r.sample?'【示例练习】':'',plain(r.title),plain(r.intro),...r.blocks.map(v=>[v.title,v.text,...v.items].filter(Boolean).map(plain).concat(v.citations.join('、')).join('\n')),plain(r.followup),...r.sources.map(s=>s.ref+' '+s.name+' '+pageLabel(s.page))].filter(Boolean).join('\n\n');
          try{await navigator.clipboard.writeText(text);ctx?.notify('已复制回答和来源。');}catch{ctx?.notify('无法自动复制，请选中回答文字复制。');}
        }return;
      }
      if(b.dataset.aremove!==undefined&&!uploadBusy){pending.splice(Number(b.dataset.aremove),1);renderPending(root.querySelector('dialog[open]'));return;}
      if(b.dataset.aedit&&leader()){editCategory(b.dataset.aedit);return;}
      if(b.dataset.atoggle&&leader()){
        const d=currentFile(b.dataset.atoggle);
        if(d){b.disabled=true;try{await updateFile(d.id,{enabled:!d.enabled});if(active(current))ctx.notify(d.enabled?'资料已停用。':'资料已启用。');}finally{if(active(current))render();}}return;
      }
      if(b.dataset.adelete&&leader()){
        const d=currentFile(b.dataset.adelete);
        if(d)dialog(`<div class="panelhead"><h2>移除团队资料</h2>${closeButton()}</div><p>将移除“${esc(d.name)}”及其检索索引。需要时可以重新上传。</p><p id="a-edit-error" class="red" role="alert"></p><div class="formactions"><button class="quiet" data-aaction="close-dialog">取消</button><button class="black" data-aconfirmdelete="${d.id}">确认移除</button></div>`,'确认移除团队资料');
        return;
      }
      if(b.dataset.aconfirmdelete&&leader()){
        b.disabled=true;
        try{
          await ctx.api('/knowledge/documents/'+b.dataset.aconfirmdelete,{method:'DELETE'});
          if(active(current)){docs=docs.filter(d=>d.id!==b.dataset.aconfirmdelete);root.querySelector('dialog')?.close();ctx.notify('已移除资料和索引。');}
        }finally{b.disabled=false;}
        return;
      }
      const action=b.dataset.aaction;
      if(action==='toggle-preview'){
        if(preview.open)closePreview();
        else{preview.open=true;syncPreview();}
      }
      if(action==='close-preview')closePreview();
      if(action==='pdf-files'){
        preview.id='';syncPreview();
        const firstFile=root.querySelector('.a-pdf-files button');
        (firstFile||root.querySelector('.a-pdf-header button'))?.focus({preventScroll:true});
      }
      if(action==='new-chat'&&busy!==mode){chats[mode]=[];drafts[mode]='';render();root.querySelector('#a-question')?.focus();}
      if(action==='retry'&&!busy){const history=chats[mode],last=history.at(-1);if(last?.role==='error'){history.splice(-2);send(last.question);}}
      if(action==='manage'&&leader())ctx.navigate('knowledge');
      if(action==='back-assistants')ctx.navigate('assistants');
      if(action==='upload'&&leader())uploadDialog();
      if(action==='close-dialog'&&!uploadBusy)root.querySelector('dialog')?.close();
      if(action==='clear-filters'){filter='';category=status='all';render();}
      if(action==='reload')loadDocuments();
      if(action==='probe'){probe.open=!probe.open;render();if(probe.open)root.querySelector('#a-probe-query')?.focus();}
    }catch(error){
      if(active(current)){const output=root.querySelector('#a-edit-error');if(output)output.textContent=error.message;else ctx.notify(error.message);}
    }
  }
  function onInput(e){
    const {id,value}=e.target;
    if(id==='a-question')drafts[mode]=value;
    if(id==='a-probe-query')probe.query=value;
    if(id==='a-file-search'){filter=value;root.querySelector('#a-file-results').innerHTML=fileResults(filteredDocs());}
  }
  function onChange(e){
    const {id,value}=e.target;
    if(id==='a-file-category'){category=value;render();}
    if(id==='a-file-status'){status=value;render();}
    if(id==='a-upload-input')selectFiles(e.target.files);
    if(id==='a-upload-category')uploadCategory=value;
    if(id==='a-probe-category'){probe.category=value;probe.matches=null;probe.error='';}
  }
  async function onSubmit(e){
    e.preventDefault();
    const form=e.target, current=version;
    if(form.id==='a-chat-form')send(root.querySelector('#a-question').value);
    if(form.id==='a-upload-form')saveUpload();
    if(form.id==='a-probe-form')runProbe();
    if(form.id==='a-category-form'&&leader()){
      const submit=form.querySelector('.black');submit.disabled=true;
      try{await updateFile(form.dataset.docid,{category:new FormData(form).get('category')});if(active(current)){form.closest('dialog')?.close();ctx.notify('资料分类已更新。');}}
      catch(error){if(form.isConnected)form.querySelector('#a-edit-error').textContent=error.message;}
      finally{submit.disabled=false;}
    }
  }
  function onKeydown(e){
    if(e.key==='Escape'&&preview.open&&!compactPreview.matches){e.preventDefault();closePreview();return;}
    if(e.target.id==='a-question'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send(e.target.value);}
    if(e.target.dataset.amode&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
      e.preventDefault();const keys=Object.keys(modes),i=keys.indexOf(mode);
      mode=e.key==='Home'?keys[0]:e.key==='End'?keys.at(-1):keys[(i+(e.key==='ArrowRight'?1:2))%3];
      render();root.querySelector('#a-tab-'+mode).focus();
    }
  }
  window.InsuranceAssistants={mount,reset};
})();
