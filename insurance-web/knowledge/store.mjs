import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const categories = Object.freeze({product:'保险产品',team:'公司与团队',objection:'异议处理'});
export const maxPdfBytes = 15 * 1024 ** 2;
const demo = JSON.parse(readFileSync(new URL('./demo-documents.json', import.meta.url), 'utf8'));
const segmenter = new Intl.Segmenter('zh', {granularity:'word'});
const ignored = new Set('的 了 是 和 与 在 有 无 我 他 她 你 这 那 它 就 吗 呢 啊 可以 当前 团队 目前 如何 怎么 怎样 什么 哪些 一下 这个 那个 情况 相关 问题 资料 文件 示例 演示 需要 时候 是否 具体 还有 上面 刚才 多少 标准 步骤 流程'.split(' '));
const synonyms = [
  ['太贵','划算','价钱','费用太高','交这么多','保费','预算'],
  ['已有保障','已经有保险','买过保险','买了保险','已有保单','现有保障'],
  ['不赔','赔不赔','拒赔','赔付','理赔'],
  ['对比','比较','竞品','别家','其他产品'],
  ['佣金','发佣','结算','提成'],
  ['晋升','升职','职级'],
  ['入职','第一周','新人','带教'],
];
const lexicalTerms = (text) => {
  const words=[];
  const input=text.normalize('NFKC').toLowerCase();
  for(const {segment,isWordLike} of segmenter.segment(input)){
    if(!isWordLike||ignored.has(segment))continue;
    if(/[\p{Script=Han}]/u.test(segment)&&segment.length<2)continue;
    if(/^[a-z0-9\p{Script=Han}]+$/u.test(segment))words.push(segment);
  }
  return words;
};
const grams = text => (text.normalize('NFKC').match(/\p{Script=Han}{2,}/gu)||[]).flatMap(part=>
  [...part].slice(1).map((char,i)=>part[i]+char)).filter(word=>!ignored.has(word));
const joinIndex = text => [...lexicalTerms(text), ...grams(text).map(v=>'g'+v)].join(' ');
const queryWords = text => {
  const expanded=synonyms.filter(group=>group.some(word=>text.includes(word))).flat();
  const words=[...new Set(lexicalTerms(text+' '+expanded.join(' ')))].slice(0,36);
  const broad=new Set(['产品','保险','保障','客户']);
  const pairs=[...new Set(grams(text).filter(v=>!broad.has(v)))].slice(0,28);
  return {words, pairs, broad};
};
const schema = `
 CREATE TABLE IF NOT EXISTS kb_documents (
   id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('product','team','objection')),
   size INTEGER NOT NULL, pages INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
   sample INTEGER NOT NULL DEFAULT 0 CHECK(sample IN (0,1)), hash TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL,
   pdf BLOB NOT NULL
 );
 CREATE UNIQUE INDEX IF NOT EXISTS kb_document_hash ON kb_documents(hash) WHERE sample=0;
 CREATE INDEX IF NOT EXISTS kb_document_scope ON kb_documents(category,enabled,sample);
 CREATE TABLE IF NOT EXISTS kb_chunks (
   id INTEGER PRIMARY KEY, document_id TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
   page INTEGER NOT NULL, text TEXT NOT NULL, terms TEXT NOT NULL, title_terms TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS kb_chunks_document ON kb_chunks(document_id,page);
 CREATE VIRTUAL TABLE IF NOT EXISTS kb_search USING fts5(terms,title_terms,content='kb_chunks',content_rowid='id',tokenize='unicode61');
 CREATE TRIGGER IF NOT EXISTS kb_chunk_insert AFTER INSERT ON kb_chunks BEGIN
   INSERT INTO kb_search(rowid,terms,title_terms) VALUES(new.id,new.terms,new.title_terms);
 END;
 CREATE TRIGGER IF NOT EXISTS kb_chunk_delete AFTER DELETE ON kb_chunks BEGIN
   INSERT INTO kb_search(kb_search,rowid,terms,title_terms) VALUES('delete',old.id,old.terms,old.title_terms);
 END;
`;

export function problem(status,message){return Object.assign(new Error(message),{status});}
export function isCategory(value){return Object.hasOwn(categories,value);}
function metadata(d) {
  const url='/api/knowledge/documents/'+d.id+'/file';
  return {id:d.id,name:d.name,category:d.category,size:d.size,pages:d.pages,chunks:d.chunks,
    enabled:Boolean(d.enabled),sample:Boolean(d.sample),created:d.created,updated:d.updated,
    url,downloadUrl:url+'?download=1'};
}
const projection='d.id,d.name,d.category,d.size,d.pages,d.enabled,d.sample,d.created,d.updated';
const withChunks=projection+', (SELECT COUNT(*) FROM kb_chunks c WHERE c.document_id=d.id) AS chunks';
const hashPdf=pdf=>createHash('sha256').update(pdf).digest('hex');
function splitPage(raw) {
  const text=raw.normalize('NFKC').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,' ').replace(/[ \t]+/g,' ').trim();
  const chars=[...text], pieces=[];
  for(let from=0;from<chars.length;){
    let to=Math.min(chars.length,from+650);
    if(to<chars.length){
      for(let j=to-1;j>from+430;j--){if(/[。！？；\n]/.test(chars[j])){to=j+1;break;}}
    }
    const piece=chars.slice(from,to).join('').trim();
    if(/[\p{L}\p{N}]/u.test(piece))pieces.push(piece);
    if(to===chars.length)break;
    from=to-85;
  }
  return pieces;
}
function insertDocument(db,{id=randomUUID(),name,category,pdf,pages,sample=false,hash=hashPdf(pdf)}) {
  const now=new Date().toISOString();
  const add=db.prepare('INSERT INTO kb_chunks(document_id,page,text,terms,title_terms) VALUES(?,?,?,?,?)');
  const titleTerms=joinIndex(name.replace(/\.pdf$/i,''));
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('INSERT INTO kb_documents VALUES(?,?,?,?,?,1,?,?,?,?,?)')
      .run(id,name,category,pdf.byteLength,pages.length,Number(sample),hash,now,now,pdf);
    let count=0;
    pages.forEach((text,index)=>{
      for(const piece of splitPage(text)){
        add.run(id,index+1,piece,joinIndex(piece),titleTerms);
        count++;
      }
    });
    if(!count)throw problem(422,'这份 PDF 没有可检索的文字。请上传带文字层的 PDF。');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return metadata(db.prepare('SELECT '+withChunks+' FROM kb_documents d WHERE id=?').get(id));
}
export function initKnowledge(db,{includeSamples}) {
  db.exec(schema);
  if(!includeSamples)return;
  const existing=db.prepare('SELECT 1 FROM kb_documents WHERE id=?');
  for(const file of demo){
    if(!existing.get(file.id))insertDocument(db,{...file,pdf:readFileSync(new URL('../public/demo/'+file.file,import.meta.url)),sample:true});
  }
}
export function listKnowledge(db,{leader=false,includeSamples=false}={}) {
  return db.prepare(`SELECT ${withChunks} FROM kb_documents d WHERE (d.sample=0 OR ?) AND (d.enabled=1 OR ?)
    ORDER BY d.sample,d.updated DESC,d.name`).all(Number(includeSamples),Number(leader)).map(metadata);
}
export function validateUpload(name,category) {
  if(!isCategory(category))throw problem(400,'请选择正确的资料分类。');
  if(typeof name!=='string')throw problem(400,'请提供 PDF 文件名。');
  name=name.normalize('NFC').trim();
  if(!/^[^/\\\u0000-\u001f\u007f]{1,140}\.pdf$/iu.test(name))throw problem(400,'请输入 1–140 字的有效 PDF 文件名。');
  return {name,category};
}
export function uploadLimits(db,pdf) {
  const hash=hashPdf(pdf);
  if(db.prepare('SELECT 1 FROM kb_documents WHERE hash=? AND sample=0').get(hash))throw problem(409,'这份 PDF 已入库，可在资料列表中调整分类或状态。');
  const row=db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM kb_documents WHERE sample=0').get();
  if(row.count>=200 || row.bytes+pdf.length>750*1024**2)throw problem(409,'知识库容量已满，请先移除不再使用的资料。');
  return hash;
}
export function saveKnowledge(db,file) {return insertDocument(db,{...file,hash:uploadLimits(db,file.pdf)});}
export function changeKnowledge(db,id,change,{includeSamples}) {
  const d=db.prepare('SELECT '+projection+' FROM kb_documents d WHERE id=? AND (sample=0 OR ?)').get(id,Number(includeSamples));
  if(!d)throw problem(404,'找不到这份资料。');
  if(typeof change.enabled!=='undefined'&&typeof change.enabled!=='boolean')throw problem(400,'请选择正确的资料状态。');
  if(typeof change.category!=='undefined'&&!isCategory(change.category))throw problem(400,'请选择正确的资料分类。');
  if(d.sample&&change.category&&change.category!==d.category)throw problem(400,'示例资料只可启用或停用。');
  db.prepare('UPDATE kb_documents SET enabled=?,category=?,updated=? WHERE id=?')
    .run(change.enabled===undefined?d.enabled:Number(change.enabled),change.category??d.category,new Date().toISOString(),id);
  return metadata(db.prepare('SELECT '+withChunks+' FROM kb_documents d WHERE id=?').get(id));
}
export function deleteKnowledge(db,id) {
  if(!db.prepare('DELETE FROM kb_documents WHERE id=? AND sample=0').run(id).changes)throw problem(404,'找不到可移除的资料。示例资料可以停用。');
}
export function getKnowledgeFile(db,id,{includeSamples,leader}) {
  const row=db.prepare('SELECT name,pdf FROM kb_documents WHERE id=? AND (sample=0 OR ?) AND (enabled=1 OR ?)').get(id,Number(includeSamples),Number(leader));
  if(!row)throw problem(404,'找不到可下载的资料。');
  return row;
}

export function searchKnowledge(db,category,question,{includeSamples=false,limit=6}={}) {
  if(!isCategory(category))throw problem(400,'请选择要检索的分类。');
  const {words,pairs,broad}=queryWords(question);
  const query=[...words,...pairs.map(v=>'g'+v)].map(v=>'"'+v+'"').join(' OR ');
  if(!query)return [];
  const rows=db.prepare(`SELECT ${projection}, c.text,c.terms,c.title_terms,c.page, bm25(kb_search,1.0,2.2) AS rank
    FROM kb_search JOIN kb_chunks c ON c.id=kb_search.rowid JOIN kb_documents d ON d.id=c.document_id
    WHERE kb_search MATCH ? AND d.category=? AND d.enabled=1 AND (d.sample=0 OR ?)
    ORDER BY rank, d.updated DESC, c.id LIMIT 60`).all(query,category,Number(includeSamples));
  const scoreRows=rows.map(r=>{
    const terms=new Set((r.terms+' '+r.title_terms).split(' '));
    const strong=words.filter(w=>terms.has(w)&&!broad.has(w)).length;
    const adjacent=pairs.filter(w=>terms.has('g'+w)).length;
    const general=category==='product'&&words.includes('产品')&&/哪些产品|什么产品|产品列表|产品目录|产品有哪些/.test(question);
    return {...r,score:strong*3+adjacent+(general?1:0),match:strong>0||adjacent>=2||general};
  }).filter(r=>r.match);
  const hasFormal=scoreRows.some(r=>!r.sample);
  const ranked=scoreRows.filter(r=>!hasFormal||!r.sample).sort((a,b)=>b.score-a.score||a.rank-b.rank);
  const seen=new Set(), perDoc=new Map(), results=[];
  for(const r of ranked){
    const pageKey=r.id+':'+r.page;
    if(seen.has(pageKey)||(perDoc.get(r.id)||0)>=3)continue;
    seen.add(pageKey);perDoc.set(r.id,(perDoc.get(r.id)||0)+1);
    results.push({...metadata(r),page:r.page,excerpt:r.text});
    if(results.length>=limit)break;
  }
  return results;
}
