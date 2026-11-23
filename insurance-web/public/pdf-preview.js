const pdfAssets='/pdfjs/';

export function mountPdf(viewer, {url, page}) {
  const scroller=viewer.querySelector('.a-pdf-scroll');
  const paper=viewer.querySelector('.a-pdf-paper');
  const status=viewer.querySelector('.a-pdf-status');
  const pageNumber=viewer.querySelector('.a-pdf-page-number');
  const openExternal=viewer.parentElement.querySelector('.a-pdf-footer a');
  const prev=viewer.querySelector('[data-pdf-step="-1"]');
  const next=viewer.querySelector('[data-pdf-step="1"]');
  const smaller=viewer.querySelector('[data-pdf-zoom="-1"]');
  const larger=viewer.querySelector('[data-pdf-zoom="1"]');
  const zoomLevels=[0.75,1,1.25,1.5,2,2.5];
  let zoom=1, pdf, loading, rendering, disposed=false, revision=0, lastRender, displayedPage;

  function updateControls() {
    const pages=pdf?.numPages;
    if(pages){
      pageNumber.textContent=`${page} / ${pages}`;
      openExternal.href=`${url}#page=${page}`;
    }
    prev.disabled=!pages||page<=1;
    next.disabled=!pages||page>=pages;
    smaller.disabled=!pages||zoom===0;
    larger.disabled=!pages||zoom===zoomLevels.length-1;
  }

  function showError() {
    if(disposed)return;
    paper.replaceChildren();
    status.textContent='PDF 无法预览。可以在新标签打开或下载原文件。';
    status.hidden=false;
  }

  async function renderPage() {
    const width=scroller.clientWidth-24;
    if(disposed||!pdf||width<=0)return;
    const key=`${page}:${width}:${zoom}`;
    if(lastRender===key)return;
    lastRender=key;
    const current=++revision;
    const requestedPage=page;
    rendering?.cancel();
    try {
      const source=await pdf.getPage(requestedPage);
      if(disposed||current!==revision)return;
      const original=source.getViewport({scale:1});
      const viewport=source.getViewport({scale:width/original.width*zoomLevels[zoom]});
      const resolution=Math.min(devicePixelRatio||1,2,Math.sqrt(8_000_000/(viewport.width*viewport.height)),8192/Math.max(viewport.width,viewport.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.floor(viewport.width*resolution));
      canvas.height=Math.max(1,Math.floor(viewport.height*resolution));
      canvas.style.width=`${viewport.width}px`;
      canvas.style.height=`${viewport.height}px`;
      canvas.setAttribute('aria-label',`PDF 第 ${requestedPage} 页`);
      rendering=source.render({canvas,viewport,transform:[resolution,0,0,resolution,0,0]});
      await rendering.promise;
      if(disposed||current!==revision)return;
      paper.replaceChildren(canvas);
      paper.dataset.page=String(requestedPage);
      status.hidden=true;
      if(displayedPage!==requestedPage)scroller.scrollTo(0,0);
      displayedPage=requestedPage;
    } catch {
      if(current===revision){lastRender=null;showError();}
    }
  }

  function changePage(step) {
    if(!pdf)return;
    page=Math.max(1,Math.min(pdf.numPages,page+step));
    updateControls();
    renderPage();
  }
  function changeZoom(step) {
    zoom=Math.max(0,Math.min(zoomLevels.length-1,zoom+step));
    updateControls();
    renderPage();
  }
  prev.addEventListener('click',()=>changePage(-1));
  next.addEventListener('click',()=>changePage(1));
  smaller.addEventListener('click',()=>changeZoom(-1));
  larger.addEventListener('click',()=>changeZoom(1));
  const resize=new ResizeObserver(()=>renderPage());
  resize.observe(scroller);

  (async()=>{
    try {
      const engine=await import(`${pdfAssets}pdf.min.mjs`);
      if(disposed)return;
      engine.GlobalWorkerOptions.workerSrc=`${pdfAssets}pdf.worker.min.mjs`;
      loading=engine.getDocument({url,cMapUrl:`${pdfAssets}cmaps/`,standardFontDataUrl:`${pdfAssets}standard_fonts/`,
        wasmUrl:`${pdfAssets}wasm/`,iccUrl:`${pdfAssets}iccs/`,isEvalSupported:false});
      pdf=await loading.promise;
      if(disposed)return;
      page=Math.min(page,pdf.numPages);
      updateControls();
      renderPage();
    } catch {showError();}
  })();

  return ()=>{
    disposed=true;
    resize.disconnect();
    rendering?.cancel();
    loading?.destroy().catch(()=>{});
  };
}
