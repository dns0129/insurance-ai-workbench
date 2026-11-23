(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Render only the supported inline markers. Model text is never trusted as HTML.
  const inline = value => String(value ?? '').split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part,i) => {
    if(i%2===0)return esc(part);
    return part.startsWith('**')?`<strong>${esc(part.slice(2,-2))}</strong>`:`<code>${esc(part.slice(1,-1))}</code>`;
  }).join('');
  const plain = value => String(value ?? '').replace(/`[^`\n]+`|\*\*([^*\n]+)\*\*/g,(part,bold)=>bold??part);
  const summary = value => /\*\*[^*\n]+\*\*/.test(value)?inline(value):`<strong>${inline(value)}</strong>`;
  const heading = /^(#{1,6})\s+(.+)$/;
  const list = /^\s*(?:(\d{1,4})[.)]|[-+*])\s+(.+)$/;
  const fence = /^ {0,3}((?:`{3,}|~{3,})).*$/;
  const divider = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  const cells = line => line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(cell=>cell.trim().replace(/\\\|/g,'|'));
  const sectionIcon = (path) => `<span class="reply-section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg></span>`;

  function analysis(value){
    const lines=String(value??'').replace(/\r\n?/g,'\n').split('\n'), blocks=[];
    const isTable=i=>lines[i]?.includes('|')&&divider.test(lines[i+1]??'')&&cells(lines[i]).length===cells(lines[i+1]).length;
    for(let i=0;i<lines.length;){
      if(!lines[i].trim()){i++;continue;}
      const start=lines[i].match(fence), title=lines[i].match(heading), item=lines[i].match(list);
      if(start){
        const body=[],end=new RegExp('^ {0,3}'+start[1][0]+'{'+start[1].length+',}\\s*$');
        for(i++;i<lines.length&&!end.test(lines[i]);i++)body.push(lines[i]);
        if(i<lines.length)i++;
        blocks.push(`<pre data-reveal="block"><code>${esc(body.join('\n'))}</code></pre>`);
      }else if(isTable(i)){
        const headers=cells(lines[i]),rows=[];
        for(i+=2;i<lines.length&&lines[i].includes('|')&&cells(lines[i]).length===headers.length;i++)rows.push(cells(lines[i]));
        blocks.push(`<div class="reply-table" data-reveal="block" tabindex="0" role="region" aria-label="分析数据表格"><table><thead><tr>${headers.map(h=>`<th scope="col">${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      }else if(title){
        const tag=title[1].length===1?'h3':'h4';
        const action=/^(?:下一步|行动建议|跟进建议)/.test(plain(title[2]));
        const mark=action?sectionIcon('M5 12h14m-6-6 6 6-6 6'):'';
        blocks.push(`<${tag} ${action?'class="reply-section-title analysis-action" ':''}data-reveal="block">${mark}${inline(title[2])}</${tag}>`);i++;
      }else if(item){
        const tag=item[1]?'ol':'ul',items=[];
        while(i<lines.length){const next=lines[i].match(list);if(!next||!!next[1]!==!!item[1])break;items.push(`<li data-reveal="text">${inline(next[2])}</li>`);i++;}
        blocks.push(`<${tag}${item[1]?` start="${Number(item[1])}"`:''}>${items.join('')}</${tag}>`);
      }else{
        const body=[lines[i++]];
        while(i<lines.length&&lines[i].trim()&&!heading.test(lines[i])&&!list.test(lines[i])&&!fence.test(lines[i])&&!isTable(i))body.push(lines[i++]);
        const content=inline(body.join('\n'));
        blocks.push(blocks.length?`<p data-reveal="text">${content}</p>`:`<div data-reveal="text" class="a-reply-summary">${sectionIcon('m5 12 4 4L19 6')}<p>${content}</p></div>`);
      }
    }
    return blocks.join('');
  }

  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const nearBottom=area=>area.scrollHeight-area.clientHeight-area.scrollTop<42;
  function play(reply,area,follow=true){
    if(!reply?.isConnected||reply.closest('[hidden]'))return;
    const skip=reply.querySelector('[data-reveal-skip]');
    const scroll=()=>{if(area&&follow)area.scrollTop=area.scrollHeight;};
    const scrollToStart=()=>{if(area)area.scrollTop+=reply.getBoundingClientRect().top-area.getBoundingClientRect().top-12;};
    if(reducedMotion.matches){if(follow)scrollToStart();return;}
    const tail=[...reply.querySelectorAll('[data-reveal="tail"]')];
    const entries=[...reply.querySelectorAll('[data-reveal="text"],[data-reveal="block"]')].map(el=>{
      const runs=[];
      if(el.dataset.reveal==='text'){
        const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){
          const node=walker.currentNode;
          runs.push({node,text:node.data,chars:Array.from(node.data)});node.data='';
        }
      }
      el.hidden=true;
      return {el,runs,length:runs.reduce((n,r)=>n+r.chars.length,0)||7};
    });
    if(!entries.length)return;
    tail.forEach(el=>el.hidden=true);
    let total=0;
    for(const entry of entries){entry.start=total;total+=entry.length;}
    const duration=Math.min(5500,Math.max(600,total*13));
    let start,frame=0,index=0;
    const show=(entry,n)=>{
      entry.el.hidden=false;
      for(const run of entry.runs){
        const length=Math.min(run.chars.length,Math.max(0,n));
        if(length!==run.visible){run.node.data=length===run.chars.length?run.text:run.chars.slice(0,length).join('');run.visible=length;}
        n-=run.chars.length;
      }
    };
    const complete=(jumpToStart=false)=>{
      cancelAnimationFrame(frame);
      for(;index<entries.length;index++)show(entries[index],entries[index].length);
      tail.forEach(el=>el.hidden=false);
      reply.removeAttribute('data-playing');reply.removeAttribute('aria-busy');
      if(skip){if(document.activeElement===skip)reply.focus({preventScroll:true});skip.hidden=true;}
      if(jumpToStart)scrollToStart();
    };
    const tick=now=>{
      if(!reply.isConnected)return;
      if(reducedMotion.matches||reply.closest('[hidden]')){complete();return;}
      start??=now;
      const count=1+Math.floor((now-start)/duration*total);
      if(count>=total){complete();return;}
      follow=!area||nearBottom(area);
      while(index<entries.length&&count>entries[index].start){
        const entry=entries[index],size=count-entry.start;
        show(entry,size);
        if(size<entry.length)break;
        index++;
      }
      scroll();frame=requestAnimationFrame(tick);
    };
    reply.setAttribute('data-playing','');reply.setAttribute('aria-busy','true');
    if(skip){skip.hidden=false;skip.addEventListener('click',()=>complete(true),{once:true});}
    scroll();frame=requestAnimationFrame(tick);
  }
  window.InsuranceReply={inline,plain,summary,analysis,play,nearBottom};
})();
