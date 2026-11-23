// Synthetic provider. It echoes a retrieved page so UI/integration tests verify real retrieval.
export function quoteProvider(){
  return {status:{provider:'fixture',configured:true},calls:[],async complete(request){
    this.calls.push(request);
    const {evidence}=JSON.parse(request.user);
    return JSON.stringify({status:'grounded',title:'团队资料核对',intro:'以下引用团队原文。',
      blocks:evidence.slice(0,2).map(s=>({title:'原文与参考话术',text:s.text,items:[],sourceIds:[s.id]})),
      followup:'还想核对哪一项？'});
  }};
}

export function makePdf(pages) {
  const ids=pages.map((_,i)=>String(4+i*2));
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count '+pages.length+' /Kids ['+ids.map(id=>id+' 0 R').join(' ')+'] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((line,i)=>{
    const stream=line?'BT /F1 12 Tf 50 700 Td ('+line.replace(/[()\\]/g,'\\$&')+') Tj ET':'';
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(5+i*2)+' 0 R >>');
    objects.push('<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream');
  });
  let pdf='%PDF-1.4\n';
  const offsets=objects.map((body,i)=>{const offset=Buffer.byteLength(pdf);pdf+=(i+1)+' 0 obj\n'+body+'\nendobj\n';return offset;});
  return Buffer.from(pdf+'xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(v=>String(v).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+Buffer.byteLength(pdf)+'\n%%EOF\n');
}
