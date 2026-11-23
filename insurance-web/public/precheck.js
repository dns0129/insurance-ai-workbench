/* The checklist is shared via the workbench API. Agent drafts live in this view. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let root,ctx,key,loadId=0,templates=[],selected='',error='',loading=false,busy=false;
  let checked=new Set(),confirmed=false;
  const edits=new Map();
  const find=selector=>root?.querySelector(selector);
  const current=()=>templates.find(t=>t.id===selected);
  const leader=()=>ctx?.actor.role==='leader';
  function reset(){
    loadId++;root=ctx=key=null;templates=[];selected='';error='';loading=busy=confirmed=false;
    checked=new Set();edits.clear();
  }
  function mount(node,options){
    const nextKey=options.actor.role+':'+(options.actor.agent_id||'leader');
    if(nextKey!==key){reset();key=nextKey;}
    root=node;ctx=options;
    root.onclick=click;root.oninput=input;root.onchange=change;root.onsubmit=submit;
    if(busy)render();else refresh();
  }
  async function refresh(message=''){
    const call=++loadId;
    loading=true;error='';render();
    try{
      const previous=current(),data=await ctx.api('/precheck/templates');
      if(call!==loadId)return;
      templates=data.items;
      if(!templates.some(t=>t.id===selected))selected=templates[0]?.id||'';
      if(previous&&previous.version!==current()?.version){
        confirmed=false;checked.clear();
        message=message||'材料清单已更新，请按新版本重新核对。';
      }
      for(const t of templates){if(edits.get(t.id)?.version!==t.version)edits.delete(t.id);}
      error=message;
    }catch(e){if(call===loadId)error=e.message;}
    finally{if(call===loadId){loading=false;render();}}
  }
  function chooser(t){
    return `<label class="pc-field pc-choice">选择虚构样例
      <select id="pc-template" ${loading||busy?'disabled':''}>${templates.map(x=>`<option value="${esc(x.id)}" ${x.id===t.id?'selected':''}>${esc(x.title)}</option>`).join('')}</select>
    </label>`;
  }
  function agentSummary(t){
    const missing=t.items.filter(item=>item.required&&!checked.has(item.id));
    const mandatory=t.items.filter(item=>item.required).length;
    const completed=mandatory-missing.length;
    return `<div class="pc-panel-head"><div><h2>核对结果</h2><p>必备资料已准备 ${completed} / ${mandatory} 项</p></div><span class="count">第 ${t.version} 版</span></div>
      <div class="pc-progress" role="progressbar" aria-label="必备资料准备进度" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="${mandatory}"><i style="width:${completed/mandatory*100}%"></i></div>
      <div class="pc-result ${missing.length?'pc-missing':''}" aria-live="polite">
        <strong>${missing.length?`! 待补 ${missing.length} 项必备资料`:'必备资料已勾选'}</strong>
        ${missing.length?`<ul>${missing.map(item=>`<li>${esc(item.name)}</li>`).join('')}</ul>`:'<p>请再核对内容是否准确、是否使用最新表格。</p>'}
      </div>
      <label class="pc-confirm"><input id="pc-confirm" type="checkbox" ${confirmed?'checked':''} ${busy||loading?'disabled':''}><span>我已人工核对以上材料与缺项</span></label>
      <button class="black pc-export" data-pc="export" ${confirmed&&!busy&&!loading?'':'disabled'}>${busy?'正在生成…':'导出预检记录'}</button>
      <p class="pc-note">有缺项也可导出，记录会列明待补资料。导出内容仅为演示核对记录。</p>`;
  }
  function agentView(t){
    return `<ol class="pc-steps" aria-label="预检步骤"><li><b>1</b> 选择样例</li><li><b>2</b> 勾选已有资料</li><li><b>3</b> 人工确认后导出</li></ol>
      <div class="pc-grid">
        <section class="panel pc-main" aria-labelledby="pc-items-title">
          <div class="pc-panel-head"><div><h2 id="pc-items-title">投保材料</h2><p>只勾选当前已准备的资料。</p></div><button class="quiet" data-pc="example" ${busy||loading||!t.example.length?'disabled':''}>加载示例勾选</button></div>
          ${chooser(t)}<ul class="pc-items">${t.items.map(item=>`<li><label><input type="checkbox" data-pc-item="${esc(item.id)}" ${checked.has(item.id)?'checked':''} ${busy||loading?'disabled':''}><span><strong>${esc(item.name)}</strong>${item.note?`<small>${esc(item.note)}</small>`:''}</span><span class="count">${item.required?'必备':'选备'}</span></label></li>`).join('')}</ul>
        </section>
        <section id="pc-summary" class="panel pc-summary" aria-label="核对结果">${agentSummary(t)}</section>
      </div>`;
  }
  function editor(t){
    if(!edits.has(t.id))edits.set(t.id,{version:t.version,items:t.items.map(item=>({...item}))});
    return edits.get(t.id);
  }
  function leaderView(t){
    const state=editor(t),changed=JSON.stringify(state.items)!==JSON.stringify(t.items);
    return `<section class="panel pc-editor">
      <div class="pc-panel-head"><div><h2>维护材料清单</h2><p>添加、修改或移除材料，标明哪些是必备项。</p></div><span class="count">当前第 ${t.version} 版</span></div>
      ${chooser(t)}
      <form id="pc-editor-form">
        <div class="pc-editor-head" aria-hidden="true"><span>材料名称</span><span>核对说明</span><span>要求</span><span>操作</span></div>
        <div class="pc-editor-rows">${state.items.map((item,i)=>`<div class="pc-edit-row">
          <label class="pc-field"><span class="pc-editor-label">材料 ${i+1} 名称</span><input id="pc-name-${i}" name="name-${i}" data-pc-index="${i}" data-pc-field="name" value="${esc(item.name)}" placeholder="例如：投保申请表" maxlength="60" required ${busy?'disabled':''}></label>
          <label class="pc-field"><span class="pc-editor-label">材料 ${i+1} 核对说明</span><input data-pc-index="${i}" data-pc-field="note" value="${esc(item.note)}" placeholder="说明（选填）" maxlength="160" ${busy?'disabled':''}></label>
          <label class="pc-require"><input type="checkbox" data-pc-index="${i}" data-pc-field="required" aria-label="材料 ${i+1} 为必备" ${item.required?'checked':''} ${busy?'disabled':''}>必备</label>
          <button type="button" class="quiet pc-remove" data-pc-remove="${i}" aria-label="移除第 ${i+1} 项材料" ${busy||state.items.length===1?'disabled':''}>移除</button>
        </div>`).join('')}</div>
        <div class="pc-editor-actions"><button type="button" class="quiet" data-pc="add" ${busy||state.items.length>=16?'disabled':''}>＋ 添加材料</button><div><span id="pc-editor-state" class="pc-note">${changed?'有未保存的修改':'当前为已发布清单'}</span> <button id="pc-save" class="black" ${busy||loading||!changed?'disabled':''}>${busy?'保存中…':'保存新版本'}</button></div></div>
      </form>
      <p class="pc-note">保存后立即供代理人使用。旧版未完成的核对需要按最新版重新确认。</p>
    </section>`;
  }
  function render(){
    if(!root?.isConnected)return;
    const t=current();
    root.innerHTML=`<div class="pc-banner"><span class="count">虚构演示</span><p>仅核对材料是否准备齐全，不收集真实客户资料，也不作核保决定。</p></div>
      <div id="pc-error" class="pc-error" role="alert" tabindex="-1" ${error?'':'hidden'}>${esc(error)}</div>
      ${loading?'<p class="panel pc-empty" role="status">正在加载材料清单…</p>':t?(leader()?leaderView(t):agentView(t)):'<div class="panel pc-empty"><p>未能加载材料清单。</p><button class="quiet" data-pc="retry">重新加载</button></div>'}`;
  }
  function showError(message){error=message;const el=find('#pc-error');if(el){el.hidden=!message;el.textContent=message;if(message)el.focus();}}
  function updateSummary(){
    const panel=find('#pc-summary');if(panel)panel.innerHTML=agentSummary(current());
  }
  function input(e){
    const field=e.target.dataset.pcField;
    if(!field||!leader()||busy)return;
    const t=current(),state=editor(t);
    state.items[Number(e.target.dataset.pcIndex)][field]=field==='required'?e.target.checked:e.target.value;
    const changed=JSON.stringify(state.items)!==JSON.stringify(t.items);
    find('#pc-save').disabled=!changed;
    find('#pc-editor-state').textContent=changed?'有未保存的修改':'当前为已发布清单';
  }
  function change(e){
    if(busy)return;
    if(e.target.id==='pc-template'){selected=e.target.value;checked.clear();confirmed=false;error='';render();find('#pc-template')?.focus();return;}
    if(e.target.id==='pc-confirm'){confirmed=e.target.checked;find('[data-pc="export"]').disabled=!confirmed;return;}
    const item=e.target.dataset.pcItem;
    if(item){e.target.checked?checked.add(item):checked.delete(item);confirmed=false;updateSummary();}
  }
  function click(e){
    const button=e.target.closest('button');
    if(!button||busy)return;
    const action=button.dataset.pc;
    if(action==='retry'){refresh();return;}
    const t=current();if(!t)return;
    if(action==='example'&&!leader()){
      checked=new Set(t.example);confirmed=false;
      find('.pc-items').querySelectorAll('input').forEach(input=>{input.checked=checked.has(input.dataset.pcItem);});
      updateSummary();
    }
    if(action==='export'&&!leader())exportRecord(t);
    if(leader()&&action==='add'){
      const state=editor(t);if(state.items.length>=16)return;
      state.items.push({name:'',note:'',required:true});render();find('#pc-name-'+(state.items.length-1))?.focus();
    }
    if(leader()&&button.dataset.pcRemove!==undefined){
      const state=editor(t);if(state.items.length<=1)return;
      state.items.splice(Number(button.dataset.pcRemove),1);render();
      find('[data-pc="add"]')?.focus();
    }
  }
  async function submit(e){
    if(e.target.id!=='pc-editor-form')return;
    e.preventDefault();
    if(busy||!leader())return;
    const t=current(),draft=editor(t);
    if(!draft.items.some(i=>i.required)){showError('清单至少需要一项必备材料。');return;}
    const call=loadId;busy=true;error='';render();
    try{
      const saved=await ctx.api('/precheck/templates',{method:'POST',body:JSON.stringify({id:t.id,version:draft.version,items:draft.items})});
      if(call!==loadId)return;
      templates=templates.map(x=>x.id===saved.id?saved:x);edits.delete(saved.id);
      ctx.notify('已保存第 '+saved.version+' 版，代理人可以使用。');
    }catch(e){
      if(call!==loadId)return;
      if(e.status===409){busy=false;await refresh('其他会话已更新清单，已加载新版。请重新核对后编辑。');return;}
      error=e.message;
    }finally{if(call===loadId){busy=false;render();if(error)find('#pc-error')?.focus();}}
  }
  async function exportRecord(t){
    if(!confirmed||busy)return;
    const call=loadId;busy=true;error='';render();
    try{
      const {filename,text}=await ctx.api('/precheck/export',{method:'POST',body:JSON.stringify({id:t.id,version:t.version,checked:[...checked],confirmed})});
      if(call!==loadId||!root?.isConnected||root.closest('[hidden]'))return;
      const url=URL.createObjectURL(new Blob(['\ufeff',text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');
      link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      ctx.notify('已导出本次预检记录。');
    }catch(e){
      if(call!==loadId)return;
      if(e.status===409){confirmed=false;checked.clear();busy=false;await refresh(e.message);return;}
      error=e.message;
    }finally{if(call===loadId){busy=false;render();if(error)find('#pc-error')?.focus();}}
  }
  window.InsurancePrecheck={mount,reset};
})();
