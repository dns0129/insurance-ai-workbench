(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount = value => Number(value).toLocaleString('zh-HK',{maximumFractionDigits:2});
  const yuan = value => '¥'+amount(value);
  const hkd = value => 'HK$'+amount(value);
  const monthLabel = value => String(value).replace(/^(\d{4})-(\d{2})$/,(_,year,month)=>year+' 年 '+Number(month)+' 月');
  const timeLabel = new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

  function commission(data) {
    const rows = data.rows;
    const settled = rows.filter(row=>row.status==='settled').reduce((sum,row)=>sum+row.amount,0);
    const pending = rows.filter(row=>row.status==='pending').reduce((sum,row)=>sum+row.amount,0);
    return `<section class="panel pp-card" aria-labelledby="pp-commission-title">
      <div class="pp-card-head"><div><h2 id="pp-commission-title">我的佣金</h2><p>${monthLabel(data.month)} · 港币 HKD</p></div><span class="count">虚构样例</span></div>
      ${rows.length?`<div class="pp-commission">
        <div><span>已结算</span><strong>${hkd(settled)}</strong></div>
        <div><span>待核对</span><strong>${hkd(pending)}</strong></div>
      </div>
      <details class="pp-detail"><summary>查看佣金明细</summary><div class="tablewrap"><table aria-label="我的示例佣金明细"><thead><tr><th>记录</th><th>状态</th><th class="num">金额</th></tr></thead><tbody>
        ${rows.map(row=>`<tr><td>${esc(row.id)}</td><td><span class="pp-status">${row.status==='settled'?'已结算':'待核对'}</span></td><td class="num">${hkd(row.amount)}</td></tr>`).join('')}
      </tbody></table></div></details>
      <p class="pp-note">演示金额独立于业绩；已结算不代表已到账。</p>`:'<p class="pp-empty">所选月份暂无佣金样例。可以切换到 2026 年 10 月，使用兼职或全职演示账号查看。</p>'}
    </section>`;
  }
  function events({items}) {
    return `<section class="panel pp-card" id="pp-activities" aria-labelledby="pp-activity-title">
      <div class="pp-card-head"><div><h2 id="pp-activity-title">团队与公司活动</h2><p>演示计划 · 香港时间</p></div><span class="count">虚构样例</span></div>
      <div class="pp-filter" role="group" aria-label="筛选活动">
        ${[['all','全部'],['team','团队'],['company','公司']].map(([key,label])=>`<button type="button" class="quiet" data-pp-filter="${key}" aria-pressed="${key==='all'}">${label}</button>`).join('')}
      </div>
      <div class="pp-events">${items.map(event=>`<details class="pp-detail" data-pp-event="${esc(event.scope)}">
        <summary><span class="pp-event-name"><span class="pp-status">${event.scope==='team'?'团队':'公司'}</span> <strong>${esc(event.title)}</strong></span><time datetime="${esc(event.at)}">${esc(timeLabel.format(new Date(event.at)))}</time></summary>
        <p>${esc(event.detail)}</p>
      </details>`).join('')}</div>
      <p class="pp-note">示例活动仅供查看。</p>
      <span class="sr" id="pp-event-count" role="status"></span>
    </section>`;
  }

  function render(data) {
    const agent=data.agents[0],demo=data.personal;
    const target=agent.target,actual=agent.actual;
    const progress=target>0?actual/target*100:null;
    const gap=Math.max(0,target-actual);
    const targetCaption=progress===null?'暂无月度目标':gap?'距目标还差 '+yuan(gap):'已达成月度目标';
    const next=progress!==null&&gap>0?'核对本月保单，安排一项可推进的客户跟进。':'回顾本月保单与跟进进度，安排下一项工作。';
    return `<section class="pp" aria-label="我的个人进度">
      <div class="pp-identity"><div><span>${monthLabel(data.month)} · 个人工作概览</span><strong>${esc(agent.name)}</strong></div>
      <span class="count">${demo.employment?esc(demo.employment)+'演示':'代理人演示'} · ${esc(agent.id)}</span></div>
      <div class="pp-kpis">
        <section class="pp-kpi"><h2>本月业绩</h2><strong class="pp-number">${yuan(actual)}</strong><p>人民币首年保费 · ${agent.count} 张已生效保单</p></section>
        <section class="pp-kpi"><h2>目标达成</h2><strong class="pp-number">${progress===null?'—':amount(progress)+'%'}</strong>
          <p>${target>0?'目标 '+yuan(target)+' · ':''}${targetCaption}</p>
          ${progress!==null?`<div class="pp-progress" role="progressbar" aria-label="个人目标完成度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,progress)}" aria-valuetext="实际达成 ${amount(progress)}%"><i style="width:${Math.min(100,progress)}%"></i></div>`:''}
        </section>
        <section class="pp-kpi"><h2>我的下一步</h2><p class="pp-action">${next}</p><button type="button" class="quiet" data-nav="policies">查看我的保单</button></section>
      </div>
      <div class="pp-grid">${commission(demo.commission)}${events(demo.activities)}</div>
    </section>`;
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('button[data-pp-filter]');
    if(!button)return;
    const panel=button.closest('#pp-activities'),scope=button.dataset.ppFilter;
    panel.querySelectorAll('[data-pp-filter]').forEach(control=>control.setAttribute('aria-pressed',String(control===button)));
    let shown=0;
    panel.querySelectorAll('[data-pp-event]').forEach(item=>{
      item.hidden=scope!=='all'&&item.dataset.ppEvent!==scope;
      if(!item.hidden)shown++;
    });
    panel.querySelector('#pp-event-count').textContent='显示 '+shown+' 项活动。';
  });
  window.InsurancePersonalProgress={render};
})();
