let data={items:[]},cursor=new Date(),editingId=null,memoOpen=false,memoFilter='all',memoFolder='__all',calendarPinned=false,settings={};
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const key=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const escapeHtml=MD.escapeHtml;
function today(){return key(new Date())}
function dateObj(k){const [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d)}
function addDays(k,n){const d=dateObj(k);d.setDate(d.getDate()+n);return key(d)}

/* =====================================================================
   메모 편집기 (contenteditable)
   - 저장 형식은 마크다운 텍스트(MD.fromEditor / MD.toEditorHtml)
   - 블록: div(본문) · h1~h3 · ul/ol > li · blockquote · div.todo-line · hr
   - 할 일 체크박스는 .todo-line::before 로 그리고, data-checked 로 상태를 저장
   ===================================================================== */
const editor=$('contentInput');
const ZWSP='\u200B';
const BLOCK_TAGS=new Set(['DIV','P','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','UL','OL','HR']);

function setEditorHtml(html){
  editor.innerHTML=html||'<div><br></div>';
  updateEditorEmpty();
}
function editorMarkdown(){return MD.fromEditor(editor)}
function updateEditorEmpty(){
  const text=editor.textContent.replace(/\u200B/g,'');
  const first=editor.firstElementChild;
  const plain=!first||(editor.children.length===1&&first.tagName==='DIV'&&!first.classList.contains('todo-line'));
  editor.classList.toggle('is-empty',!text&&plain&&!editor.querySelector('hr,li'));
}
function placeCaret(node,atStart=false){
  const r=document.createRange();r.selectNodeContents(node);r.collapse(atStart);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);
}
function focusEditorEnd(){
  editor.focus();
  const last=editor.lastElementChild;
  if(last)placeCaret(last.tagName==='UL'||last.tagName==='OL'?last.lastElementChild||last:last);
}
function editorRange(){
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount)return null;
  const r=sel.getRangeAt(0);
  return editor.contains(r.commonAncestorContainer)?r:null;
}
function saveSelection(){
  const r=editorRange();
  return r&&{sc:r.startContainer,so:r.startOffset,ec:r.endContainer,eo:r.endOffset};
}
function restoreSelection(s){
  if(!s||!editor.contains(s.sc)||!editor.contains(s.ec))return;
  try{
    const r=document.createRange();r.setStart(s.sc,s.so);r.setEnd(s.ec,s.eo);
    const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);
  }catch{}
}

// 편집기 바로 아래에 맨 글자(텍스트·<b> 등)가 있으면 <div>로 감쌉니다.
function normalizeEditor(){
  const saved=saveSelection();
  let run=[];
  const wrapRun=()=>{
    if(!run.length)return;
    const div=document.createElement('div');
    run[0].before(div);run.forEach(n=>div.appendChild(n));
    if(div.lastChild?.nodeName==='BR'&&div.childNodes.length>1&&div.textContent==='')div.lastChild.remove();
    run=[];
  };
  [...editor.childNodes].forEach(n=>{
    const inline=n.nodeType===Node.TEXT_NODE||(n.nodeType===Node.ELEMENT_NODE&&!BLOCK_TAGS.has(n.tagName));
    if(inline){run.push(n);if(n.nodeName==='BR')wrapRun();}
    else wrapRun();
  });
  wrapRun();
  if(!editor.firstChild)editor.innerHTML='<div><br></div>';
  // 할 일 줄 속성 정리
  editor.querySelectorAll('.todo-line').forEach(line=>{
    if(line.dataset.checked!=='true')line.dataset.checked='false';
    ensureFiller(line);
  });
  restoreSelection(saved);
  updateEditorEmpty();
}

// 캐럿이 있는 블록(편집기의 자식 블록 또는 <li>)
function blockOf(node){
  let n=node?.nodeType===Node.TEXT_NODE?node.parentNode:node;
  while(n&&n!==editor){
    if(n.tagName==='LI'||n.parentNode===editor)return n;
    n=n.parentNode;
  }
  return null;
}
function caretBlock(){
  const r=editorRange();if(!r)return null;
  let b=blockOf(r.startContainer);
  if(!b){normalizeEditor();b=blockOf(editorRange()?.startContainer)}
  return b&&b.tagName!=='UL'&&b.tagName!=='OL'?b:null;
}
// 선택 영역에 걸친 블록 목록
function selectedBlocks(){
  const r=editorRange();if(!r)return [];
  normalizeEditor();
  const range=editorRange();if(!range)return [];
  const out=[];
  [...editor.children].forEach(el=>{
    if(!range.intersectsNode(el))return;
    if(el.tagName==='UL'||el.tagName==='OL')el.querySelectorAll(':scope > li').forEach(li=>{if(range.intersectsNode(li))out.push(li)});
    else if(el.tagName!=='HR')out.push(el);
  });
  return out;
}
function blockType(el){
  if(!el)return 'div';
  if(el.tagName==='LI')return el.parentNode.tagName.toLowerCase();
  if(el.classList.contains('todo-line'))return 'todo';
  if(/^H[1-6]$/.test(el.tagName))return el.tagName.toLowerCase();
  if(el.tagName==='BLOCKQUOTE')return 'quote';
  return 'div';
}
function textBeforeCaret(block){
  const r=editorRange();if(!r)return '';
  const pre=document.createRange();pre.selectNodeContents(block);pre.setEnd(r.startContainer,r.startOffset);
  return pre.toString().replace(/ /g,' ').replace(/\u200B/g,'');
}
function isBlockEmpty(block){return !block.textContent.replace(/\u200B/g,'').trim()}
// 비어 있는 블록에는 <br>을 넣어야 높이가 생기고 캐럿이 들어갑니다.
function ensureFiller(el){
  if(el.textContent===''&&!el.querySelector('br,hr')){el.textContent='';el.appendChild(document.createElement('br'))}
}

// <li>를 목록 밖의 <div>로 꺼냅니다. 목록은 앞/뒤로 나뉩니다.
function liftListItem(li){
  const list=li.parentNode,div=document.createElement('div');
  const rest=[];let n=li.nextElementSibling;while(n){rest.push(n);n=n.nextElementSibling}
  [...li.childNodes].forEach(c=>{if(c.nodeType===Node.ELEMENT_NODE&&(c.tagName==='UL'||c.tagName==='OL'))rest.unshift(...c.children);else div.appendChild(c)});
  list.after(div);
  if(rest.length){const tail=document.createElement(list.tagName);rest.forEach(x=>tail.appendChild(x));div.after(tail)}
  li.remove();
  if(!list.children.length)list.remove();
  return div;
}
function mergeAdjacentLists(list){
  const prev=list.previousElementSibling,next=list.nextElementSibling;
  if(next&&next.tagName===list.tagName){[...next.children].forEach(x=>list.appendChild(x));next.remove()}
  if(prev&&prev.tagName===list.tagName){[...list.children].forEach(x=>prev.appendChild(x));list.remove();return prev}
  return list;
}
// 블록 종류 변경: div · h1 · h2 · h3 · quote · todo · ul · ol
function setBlockType(block,type){
  if(blockType(block)===type)return block;
  if(block.tagName==='LI')block=liftListItem(block);
  let el;
  if(type==='ul'||type==='ol'){
    el=document.createElement('li');
    const list=document.createElement(type);list.appendChild(el);
    block.replaceWith(list);
    [...block.childNodes].forEach(c=>el.appendChild(c));
    mergeAdjacentLists(list);
  }else{
    el=document.createElement(type==='quote'?'blockquote':type==='todo'?'div':type);
    if(type==='todo'){el.className='todo-line';el.dataset.checked='false'}
    [...block.childNodes].forEach(c=>el.appendChild(c));
    block.replaceWith(el);
  }
  ensureFiller(el);
  return el;
}
// 툴바 버튼: 선택된 블록이 모두 그 종류면 본문으로 되돌리고, 아니면 그 종류로 바꿉니다.
function toggleBlocks(type){
  editor.focus();
  const blocks=selectedBlocks();
  if(!blocks.length)return;
  const saved=saveSelection();
  const target=blocks.every(b=>blockType(b)===type)?'div':type;
  blocks.forEach(b=>setBlockType(b,target));
  restoreSelection(saved);
  if(!editorRange())placeCaret(editor.lastElementChild);
  updateEditorEmpty();
}
function execInline(cmd){editor.focus();try{document.execCommand(cmd,false,null)}catch(e){console.warn('editor command',cmd,e)}}
function clearFormatting(){
  execInline('removeFormat');
  const saved=saveSelection();
  selectedBlocks().forEach(b=>setBlockType(b,'div'));
  restoreSelection(saved);
}

// 줄 맨 앞 마크다운 입력 → 블록 서식 ("# ", "- ", "1. ", "[] ", "> " …)
const BLOCK_SHORTCUTS=[
  [/^#\s$/,'h1'],[/^##\s$/,'h2'],[/^###\s$/,'h3'],
  [/^[-*+]\s\[([ xX]?)\]\s$/,'todo'],[/^\[([ xX]?)\]\s$/,'todo'],
  [/^[-*+]\s$/,'ul'],[/^1[.)]\s$/,'ol'],[/^>\s$/,'quote']
];
function applyBlockShortcut(){
  const r=editorRange();if(!r||!r.collapsed)return false;
  const block=caretBlock();if(!block||block.tagName==='HR')return false;
  const before=textBeforeCaret(block);
  for(const [re,type] of BLOCK_SHORTCUTS){
    const m=before.match(re);if(!m)continue;
    const current=blockType(block);
    if(current===type)return false;
    if(type!=='todo'&&current!=='div')return false; // 목록 안에서 "- " 같은 건 글자 그대로
    // 입력한 기호 지우기
    const del=document.createRange();del.selectNodeContents(block);del.setEnd(r.startContainer,r.startOffset);del.deleteContents();
    const el=setBlockType(block,type);
    if(type==='todo'&&m[1]&&m[1].toLowerCase()==='x')el.dataset.checked='true';
    placeCaret(el,true);
    updateEditorEmpty();
    return true;
  }
  return false;
}

// 인라인 마크다운 입력 → 서식 ("**굵게**", "*기울임*", "~~취소~~", "`코드`")
const INLINE_SHORTCUTS=[
  [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/,'b',0],
  [/~~([^~\s](?:[^~]*[^~\s])?)~~$/,'s',0],
  [/`([^`]+)`$/,'code',0],
  [/(^|[^*\\])\*([^*\s](?:[^*]*[^*\s])?)\*$/,'i',1],
  [/(^|[^\p{L}\p{N}_\\])_([^_\s](?:[^_]*[^_\s])?)_$/u,'i',1]
];
function applyInlineShortcut(){
  const r=editorRange();if(!r||!r.collapsed||r.startContainer.nodeType!==Node.TEXT_NODE)return false;
  const node=r.startContainer,offset=r.startOffset,before=node.data.slice(0,offset);
  if(node.parentNode.closest('code'))return false;
  for(const [re,tag,hasPrefix] of INLINE_SHORTCUTS){
    const m=before.match(re);if(!m)continue;
    const start=m.index+(hasPrefix?m[1].length:0);
    const inner=hasPrefix?m[2]:m[1];
    const range=document.createRange();range.setStart(node,start);range.setEnd(node,offset);range.deleteContents();
    const el=document.createElement(tag);el.textContent=inner;
    range.insertNode(el);
    // 서식 요소 뒤에 빈 글자(ZWSP)를 두어 이어서 치는 글자는 일반 서식이 되도록 합니다.
    const after=document.createTextNode(ZWSP);el.after(after);
    const c=document.createRange();c.setStart(after,1);c.collapse(true);
    const sel=window.getSelection();sel.removeAllRanges();sel.addRange(c);
    return true;
  }
  return false;
}

// Enter: 할 일 / 인용은 같은 종류의 새 줄을 만들고, 빈 줄이면 본문으로 빠져나옵니다.
function handleEnter(e){
  const block=caretBlock();if(!block)return;
  const type=blockType(block);
  if(type==='div'&&textBeforeCaret(block).trim()==='---'&&block.textContent.trim()==='---'){
    e.preventDefault();
    const hr=document.createElement('hr'),next=document.createElement('div');next.innerHTML='<br>';
    block.replaceWith(hr);hr.after(next);placeCaret(next,true);return;
  }
  if(type!=='todo'&&type!=='quote')return; // 나머지는 브라우저 기본 동작(목록은 빈 항목에서 Enter 시 자동으로 빠져나옴)
  e.preventDefault();
  if(isBlockEmpty(block)){const div=setBlockType(block,'div');placeCaret(div,true);updateEditorEmpty();return}
  const r=editorRange();r.deleteContents();
  const tail=document.createRange();tail.setStart(r.startContainer,r.startOffset);tail.setEnd(block,block.childNodes.length);
  const frag=tail.extractContents();
  const next=block.cloneNode(false);
  if(type==='todo')next.dataset.checked='false';
  next.appendChild(frag);
  [block,next].forEach(ensureFiller);
  block.after(next);
  placeCaret(next,true);
}
// Backspace: 할 일·제목·인용 맨 앞에서 누르면 먼저 서식만 해제합니다.
function handleBackspace(e){
  const r=editorRange();if(!r||!r.collapsed)return;
  const block=caretBlock();if(!block)return;
  const type=blockType(block);
  if(type==='div'||type==='ul'||type==='ol')return;
  if(textBeforeCaret(block)!=='')return;
  e.preventDefault();
  const div=setBlockType(block,'div');placeCaret(div,true);
}

function pasteAsMarkdown(e){
  const text=e.clipboardData?.getData('text/plain');
  if(text==null)return;
  e.preventDefault();
  const html=/\n/.test(text.trim())?MD.toEditorHtml(text):MD.inline(text);
  document.execCommand('insertHTML',false,html);
  normalizeEditor();
}

function syncToolbarState(){
  const map={bold:'bold',italic:'italic',underline:'underline',strike:'strikeThrough'};
  for(const [action,cmd] of Object.entries(map)){
    let on=false;try{on=document.queryCommandState(cmd)}catch{}
    document.querySelector(`#editorToolbar button[data-action="${action}"]`)?.classList.toggle('active',on);
  }
  const t=blockType(caretBlockQuiet());
  [['h1','h1'],['h2','h2'],['bullet','ul'],['numbered','ol'],['todo','todo'],['quote','quote']].forEach(([action,type])=>{
    document.querySelector(`#editorToolbar button[data-action="${action}"]`)?.classList.toggle('active',t===type);
  });
}
function caretBlockQuiet(){const r=editorRange();const b=r&&blockOf(r.startContainer);return b&&b.tagName!=='UL'&&b.tagName!=='OL'?b:null}

document.querySelectorAll('#editorToolbar button').forEach(b=>{
  b.addEventListener('mousedown',e=>e.preventDefault());
  b.addEventListener('click',()=>{
    const a=b.dataset.action;
    if(a==='bold')execInline('bold');
    else if(a==='italic')execInline('italic');
    else if(a==='underline')execInline('underline');
    else if(a==='strike')execInline('strikeThrough');
    else if(a==='h1'||a==='h2')toggleBlocks(a);
    else if(a==='body')toggleBlocks('div');
    else if(a==='bullet')toggleBlocks('ul');
    else if(a==='numbered')toggleBlocks('ol');
    else if(a==='todo')toggleBlocks('todo');
    else if(a==='quote')toggleBlocks('quote');
    else if(a==='clear')clearFormatting();
    syncToolbarState();
  });
});

let composing=false;
editor.addEventListener('compositionstart',()=>{composing=true});
editor.addEventListener('compositionend',()=>{composing=false;normalizeEditor()});
editor.addEventListener('input',e=>{
  if(composing||e.isComposing){updateEditorEmpty();return}
  if(e.inputType==='insertText'&&e.data){
    if(/\s$/.test(e.data))applyBlockShortcut();
    else if(/[*~`_]$/.test(e.data))applyInlineShortcut();
  }
  normalizeEditor();
  syncToolbarState();
});
editor.addEventListener('keyup',syncToolbarState);
editor.addEventListener('mouseup',syncToolbarState);
editor.addEventListener('paste',pasteAsMarkdown);
editor.addEventListener('drop',e=>e.preventDefault());
// 체크박스(.todo-line::before 영역) 클릭
editor.addEventListener('mousedown',e=>{
  const line=e.target.closest?.('.todo-line');
  if(!line||e.target!==line)return;
  const rect=line.getBoundingClientRect();
  if(e.clientX-rect.left>24)return;
  e.preventDefault();
  line.dataset.checked=line.dataset.checked==='true'?'false':'true';
});
editor.addEventListener('keydown',e=>{
  if(e.isComposing||e.keyCode===229)return;
  const k=e.key.toLowerCase();
  if(e.ctrlKey&&e.shiftKey&&k==='x'){e.preventDefault();execInline('strikeThrough');syncToolbarState();return}
  if(e.ctrlKey&&e.shiftKey&&k==='c'){e.preventDefault();toggleBlocks('todo');syncToolbarState();return}
  if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey){handleEnter(e);return}
  if(e.key==='Backspace'){handleBackspace(e)}
});

/* =====================================================================
   캘린더
   ===================================================================== */
function hasDate(x,k){
  if(!x.startDate)return false;const s=dateObj(x.startDate),d=dateObj(k);if(d<s)return false;
  if(x.repeat&&x.repeat!=='none'){if(x.repeat==='daily')return true;if(x.repeat==='weekly')return Math.round((d-s)/86400000)%7===0;if(x.repeat==='monthly')return d.getDate()===s.getDate();if(x.repeat==='yearly')return d.getMonth()===s.getMonth()&&d.getDate()===s.getDate();}
  if(!x.endDate||x.endDate===x.startDate)return x.startDate===k;return k>=x.startDate&&k<=x.endDate;
}
function rangeForMonth(x,monthStart,monthEnd){if(!x.startDate)return null;if(x.repeat&&x.repeat!=='none')return null;const s=x.startDate,e=x.endDate||s;if(e<monthStart||s>monthEnd)return null;return {start:s<monthStart?monthStart:s,end:e>monthEnd?monthEnd:e}}
function render(){renderCalendar();renderList();$('monthTitle').textContent=`${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`}
const LANE_HEIGHT=21;
function renderCalendar(){
  const g=$('calendarGrid');g.innerHTML='';const y=cursor.getFullYear(),m=cursor.getMonth(),first=new Date(y,m,1),start=new Date(y,m,1-first.getDay()),monthStart=key(new Date(y,m,1)),monthEnd=key(new Date(y,m+1,0)),weeks=[];
  for(let w=0;w<6;w++){const week=document.createElement('div');week.className='week-row';for(let j=0;j<7;j++){const d=new Date(start);d.setDate(start.getDate()+w*7+j);const k=key(d),c=document.createElement('div');c.className='day'+(d.getMonth()!==m?' other':'')+(k===today()?' today':'')+(j===0?' sun':j===6?' sat':'');c.innerHTML=`<div class="day-number">${d.getDate()}</div>`;c.onclick=()=>edit(null,k);week.appendChild(c)}const layer=document.createElement('div');layer.className='week-event-layer';week.appendChild(layer);weeks.push({layer,weekStart:key(new Date(start.getFullYear(),start.getMonth(),start.getDate()+w*7))});g.appendChild(week)}
  const items=data.items.filter(x=>x.startDate);
  weeks.forEach(({layer,weekStart})=>{const weekEnd=addDays(weekStart,6),used=[];items.forEach(x=>{let segs=[];
    if(x.repeat&&x.repeat!=='none'){for(let i=0;i<7;i++){const k=addDays(weekStart,i);if(k>=monthStart&&k<=monthEnd&&hasDate(x,k))segs.push({start:k,end:k})}}
    else{const r=rangeForMonth(x,monthStart,monthEnd);if(r&&!(r.end<weekStart||r.start>weekEnd))segs.push({start:r.start<weekStart?weekStart:r.start,end:r.end>weekEnd?weekEnd:r.end})}
    segs.forEach(seg=>{const si=Math.max(0,Math.round((dateObj(seg.start)-dateObj(weekStart))/86400000)),ei=Math.min(6,Math.round((dateObj(seg.end)-dateObj(weekStart))/86400000));let lane=0;while(used[lane]?.some(v=>!(ei<v.start||si>v.end)))lane++;used[lane]??=[];used[lane].push({start:si,end:ei});const bar=document.createElement('div');bar.className='event-segment';bar.style.left=`calc(${si*100/7}% + 3px)`;bar.style.width=`calc(${(ei-si+1)*100/7}% - 6px)`;bar.style.top=`${lane*LANE_HEIGHT}px`;bar.style.setProperty('--ev',x.color||'#DCEBFF');if(x.startTime){const t=document.createElement('span');t.className='event-time';t.textContent=x.startTime;bar.appendChild(t)}bar.appendChild(document.createTextNode(x.title||'제목 없음'));const st=ItemStatus.find(x.status);if(st){bar.classList.add('has-status');const dot=document.createElement('i');dot.className=`ev-status ${st.id}`;dot.title=st.label;bar.appendChild(dot)}bar.title=(x.startTime?x.startTime+' ':'')+(x.title||'제목 없음')+(st?` · ${st.label}`:'');bar.onclick=e=>{e.stopPropagation();edit(x.id)};bar.dataset.lane=lane;bar.dataset.si=si;bar.dataset.ei=ei;layer.appendChild(bar)})
  })})
  markOverflow();
}
// 칸 높이가 모자라 가려지는 일정은 날짜 옆에 "+N" 으로 표시합니다.
function markOverflow(){
  document.querySelectorAll('#calendarGrid .week-row').forEach(week=>{
    const layer=week.querySelector('.week-event-layer'),days=[...week.querySelectorAll('.day')];
    const lanes=Math.max(0,Math.floor((layer.clientHeight+2)/LANE_HEIGHT));
    const hidden=days.map(()=>[]);
    layer.querySelectorAll('.event-segment').forEach(bar=>{
      const over=Number(bar.dataset.lane)>=lanes;bar.hidden=over;
      if(over)for(let i=Number(bar.dataset.si);i<=Number(bar.dataset.ei);i++)hidden[i].push(bar.title);
    });
    days.forEach((d,i)=>{
      d.querySelector('.day-more')?.remove();
      if(!hidden[i].length)return;
      const more=document.createElement('span');more.className='day-more';more.textContent=`+${hidden[i].length}`;more.title=hidden[i].join('\n');
      d.querySelector('.day-number').after(more);
    });
  });
}
let overflowTimer=null;
window.addEventListener('resize',()=>{clearTimeout(overflowTimer);overflowTimer=setTimeout(markOverflow,60)});
function memoTags(x){
  const folder=x.folder&&memoFolder==='__all'?`<span class="folder-tag"><svg class="icon"><use href="#i-folder"/></svg>${escapeHtml(x.folder)}</span>`:'';
  const st=ItemStatus.tag(x.status);
  return st||folder?`<div class="memo-tags">${st}${folder}</div>`:'';
}
// ===== 폴더 =====
// data.folders 에 폴더 이름 목록을 저장하고, 각 항목은 item.folder 에 폴더 이름을 가집니다('' = 폴더 없음).
function folderList(){
  const set=new Set((data.folders||[]).filter(Boolean));
  data.items.forEach(x=>{if(x.folder)set.add(x.folder)});
  return [...set];
}
function inFolder(x){
  if(memoFolder==='__all')return true;
  if(memoFolder==='__none')return !x.folder;
  return x.folder===memoFolder;
}
function filtered(){const q=$('searchInput').value.trim().toLowerCase();let a=data.items.filter(inFolder);if(memoFilter==='favorite')a=a.filter(x=>x.favorite);if(memoFilter==='today')a=a.filter(x=>hasDate(x,today()));if(memoFilter==='dated')a=a.filter(x=>x.startDate);if(q)a=a.filter(x=>`${x.title} ${x.content} ${MD.toPlain(x.content)} ${x.folder||''}`.toLowerCase().includes(q));return a.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))}
let folderEdit=null; // {mode:'new'|'rename', name}
let folderDeleteArmed=null;
function renderFolders(){
  const bar=$('folderBar'),folders=folderList();
  if(!folders.includes(memoFolder)&&memoFolder!=='__all'&&memoFolder!=='__none')memoFolder='__all';
  const count=f=>data.items.filter(x=>f==='__all'?true:f==='__none'?!x.folder:x.folder===f).length;
  const chip=(id,label,icon=true)=>`<button type="button" class="folder-chip${memoFolder===id?' active':''}" data-folder="${escapeHtml(id)}">${icon?'<svg class="icon"><use href="#i-folder"/></svg>':''}${escapeHtml(label)} <b>${count(id)}</b></button>`;
  let html=chip('__all','모든 폴더',false);
  folders.forEach(f=>{html+=chip(f,f)});
  if(folders.length&&data.items.some(x=>!x.folder))html+=chip('__none','폴더 없음');
  html+=folderEdit?.mode==='new'
    ?'<input class="folder-input" id="folderNameInput" placeholder="새 폴더 이름" maxlength="30" autocomplete="off">'
    :'<button type="button" class="folder-chip add" id="addFolderBtn" title="새 폴더"><svg class="icon"><use href="#i-plus"/></svg>폴더</button>';
  bar.innerHTML=html;
  bar.querySelectorAll('[data-folder]').forEach(b=>b.onclick=()=>{memoFolder=b.dataset.folder;folderEdit=null;renderList()});
  $('addFolderBtn')?.addEventListener('click',()=>{folderEdit={mode:'new'};renderList()});
  bindFolderInput($('folderNameInput'),'');
  // 선택한 폴더의 이름 바꾸기 · 삭제
  const act=$('folderActions'),real=folders.includes(memoFolder);
  act.classList.toggle('hidden',!real);
  if(real){
    act.innerHTML=folderEdit?.mode==='rename'
      ?'<input class="folder-input" id="folderRenameInput" maxlength="30" autocomplete="off">'
      :`<span class="folder-name"><svg class="icon"><use href="#i-folder"/></svg>${escapeHtml(memoFolder)}</span><button type="button" id="renameFolderBtn">이름 바꾸기</button><button type="button" id="deleteFolderBtn" class="danger">${folderDeleteArmed?'한 번 더 누르면 삭제':'폴더 삭제'}</button>`;
    $('renameFolderBtn')?.addEventListener('click',()=>{folderEdit={mode:'rename'};renderList()});
    $('deleteFolderBtn')?.addEventListener('click',()=>deleteFolder(memoFolder));
    const ri=$('folderRenameInput');if(ri){ri.value=memoFolder;bindFolderInput(ri,memoFolder)}
  }
}
function bindFolderInput(input,oldName){
  if(!input)return;
  setTimeout(()=>{input.focus();input.select()},0);
  let done=false;
  const finish=async ok=>{
    if(done)return;done=true;
    const name=input.value.trim();
    folderEdit=null;
    if(ok&&name&&name!==oldName&&!folderList().includes(name)){
      if(oldName){renameFolder(oldName,name)}else{data.folders=[...folderList(),name]}
      memoFolder=name;await persist();return;
    }
    renderList();
  };
  input.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();finish(true)}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false)}});
  input.addEventListener('blur',()=>finish(true));
}
function renameFolder(from,to){
  data.folders=folderList().map(f=>f===from?to:f);
  data.items.forEach(x=>{if(x.folder===from)x.folder=to});
}
async function deleteFolder(name){
  // 폴더만 지우고 메모는 '폴더 없음'으로 옮깁니다. 실수 방지를 위해 한 번 더 눌러야 지워집니다.
  if(!folderDeleteArmed){folderDeleteArmed=setTimeout(()=>{folderDeleteArmed=null;renderList()},3000);renderList();return}
  clearTimeout(folderDeleteArmed);folderDeleteArmed=null;
  data.folders=folderList().filter(f=>f!==name);
  data.items.forEach(x=>{if(x.folder===name)x.folder=''});
  memoFolder='__all';await persist();
}
function renderList(){
  renderFolders();
  const all=data.items.filter(inFolder),fav=all.filter(x=>x.favorite),td=all.filter(x=>hasDate(x,today())),dated=all.filter(x=>x.startDate);
  $('allCount').textContent=all.length;$('favCount').textContent=fav.length;$('todayCount').textContent=td.length;$('datedCount').textContent=dated.length;$('memoCount').textContent=`${all.length}개`;
  const list=$('memoList');list.innerHTML='';
  const items=filtered();
  if(!items.length){list.innerHTML='<div class="memo-empty">표시할 메모가 없습니다.</div>';return}
  items.forEach(x=>{
    const c=document.createElement('div');c.className='memo-card';
    const date=x.startDate?(x.endDate&&x.endDate!==x.startDate?`${x.startDate.slice(5)} ~ ${x.endDate.slice(5)}`:x.startDate.slice(5)):'날짜 없음';
    c.style.setProperty('--c',x.color||'#DCEBFF');
    c.innerHTML=`<div class="memo-card-head"><span class="memo-icon">${x.favorite?'★':'♥'}</span><span class="memo-date">${escapeHtml(date)}</span></div><div class="memo-card-title">${escapeHtml(x.title||'제목 없음')}</div>${memoTags(x)}${x.content?`<div class="memo-preview">${MD.toHtml(x.content,{interactive:true})}</div>`:''}`;
    // 체크박스(와 그 라벨)를 누를 때는 편집창을 열지 않습니다.
    c.addEventListener('click',e=>{if(e.target.closest('.md-todo'))return;edit(x.id)});
    c.addEventListener('change',async e=>{
      if(!e.target.matches('input[data-line]'))return;
      x.content=MD.toggleTodo(x.content,Number(e.target.dataset.line),e.target.checked);
      x.updatedAt=Date.now();await persist();
    });
    list.appendChild(c);
  });
}
const PALETTE=['#DCEBFF','#E4F0FF','#DDF7F1','#FFF0D6','#FFE2DF','#FDE3EE','#EEE4FF','#DDF2FF','#E8EDF2','#EFE5D9','#E3F2E4','#E7E7EA'];
let pickerHSV={h:220,s:.12,v:1};
function hexToRgb(hex){const h=hex.replace('#','');return {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)}}
function rgbToHex(r,g,b){return '#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase()}
function rgbToHsv(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0,s=max===0?0:d/max,v=max;if(d){switch(max){case r:h=((g-b)/d)%6;break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4}h*=60;if(h<0)h+=360}return {h,s,v}}
function hsvToHex(h,s,v){const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let r=0,g=0,b=0;if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}return rgbToHex((r+m)*255,(g+m)*255,(b+m)*255)}
function drawColorWheel(){
  const c=$('colorWheel');if(!c)return;const ctx=c.getContext('2d'),w=c.width,h=c.height,cx=w/2,cy=h/2,outer=101,inner=77;
  ctx.clearRect(0,0,w,h);
  for(let i=0;i<360;i++){const a=(i-90)*Math.PI/180,a2=(i+1-90)*Math.PI/180;ctx.beginPath();ctx.arc(cx,cy,outer,a,a2);ctx.arc(cx,cy,inner,a2,a,true);ctx.closePath();ctx.fillStyle=`hsl(${i},100%,50%)`;ctx.fill()}
  const left=55,top=55,size=110,hue=hsvToHex(pickerHSV.h,1,1);ctx.fillStyle=hue;ctx.fillRect(left,top,size,size);
  const white=ctx.createLinearGradient(left,0,left+size,0);white.addColorStop(0,'rgba(255,255,255,1)');white.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=white;ctx.fillRect(left,top,size,size);
  const black=ctx.createLinearGradient(0,top,0,top+size);black.addColorStop(0,'rgba(0,0,0,0)');black.addColorStop(1,'rgba(0,0,0,1)');ctx.fillStyle=black;ctx.fillRect(left,top,size,size);
  const angle=(pickerHSV.h-90)*Math.PI/180;const hx=cx+Math.cos(angle)*((outer+inner)/2),hy=cy+Math.sin(angle)*((outer+inner)/2);ctx.beginPath();ctx.arc(hx,hy,6,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='rgba(0,0,0,.35)';ctx.lineWidth=1;ctx.stroke();
  const sx=left+pickerHSV.s*size,sy=top+(1-pickerHSV.v)*size;ctx.beginPath();ctx.arc(sx,sy,6,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='rgba(0,0,0,.4)';ctx.lineWidth=1;ctx.stroke();
  $('colorWheelValue').textContent=hsvToHex(pickerHSV.h,pickerHSV.s,pickerHSV.v);
}
function setColor(v){
  if(!/^#[0-9a-fA-F]{6}$/.test(v))return;
  const rgb=hexToRgb(v);pickerHSV=rgbToHsv(rgb.r,rgb.g,rgb.b);
  $('colorInput').value=v;$('colorHexInput').value=v.toUpperCase();$('colorPreview').style.background=v;drawColorWheel();
  document.querySelectorAll('.color-swatch').forEach(x=>x.classList.toggle('active',x.dataset.color.toLowerCase()===v.toLowerCase()));
}
function initColors(){
  const box=$('colorSwatches');box.innerHTML='';
  PALETTE.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='color-swatch';b.dataset.color=c;b.style.background=c;b.title=c;b.onmousedown=e=>e.preventDefault();b.onclick=()=>setColor(c);box.appendChild(b)});
  $('colorHexInput').addEventListener('input',e=>{let v=e.target.value.trim();if(!v.startsWith('#'))v='#'+v;if(/^#[0-9a-fA-F]{6}$/.test(v))setColor(v)});
  $('colorInput').addEventListener('input',e=>setColor(e.target.value));
  const popup=$('colorWheelPopup'),canvas=$('colorWheel');
  $('colorPreview').onclick=e=>{e.stopPropagation();popup.classList.toggle('hidden');drawColorWheel()};
  $('colorWheelDone').onclick=()=>popup.classList.add('hidden');
  document.addEventListener('click',e=>{if(!popup.contains(e.target)&&e.target!==$('colorPreview'))popup.classList.add('hidden')});
  canvas.addEventListener('mousedown',e=>{
    const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,cx=110,cy=110,dx=x-cx,dy=y-cy,dist=Math.hypot(dx,dy),outer=101,inner=77;
    if(dist>=inner&&dist<=outer){let h=Math.atan2(dy,dx)*180/Math.PI+90;if(h<0)h+=360;pickerHSV.h=h;setColor(hsvToHex(pickerHSV.h,pickerHSV.s,pickerHSV.v));return}
    if(x>=55&&x<=165&&y>=55&&y<=165){pickerHSV.s=Math.max(0,Math.min(1,(x-55)/110));pickerHSV.v=Math.max(0,Math.min(1,1-(y-55)/110));setColor(hsvToHex(pickerHSV.h,pickerHSV.s,pickerHSV.v));}
  });
  drawColorWheel();
}
let editStatus='';
function setEditStatus(v){editStatus=v||'';document.querySelectorAll('#statusInput [data-status]').forEach(b=>{const on=b.dataset.status===editStatus;b.classList.toggle('active',on);b.setAttribute('aria-checked',on)})}
document.querySelectorAll('#statusInput [data-status]').forEach(b=>b.onclick=()=>setEditStatus(b.dataset.status));
function fillFolderSelect(value){
  const sel=$('folderInput'),folders=folderList();
  sel.innerHTML='<option value="">폴더 없음</option>'+folders.map(f=>`<option>${escapeHtml(f)}</option>`).join('')+'<option value="__new">+ 새 폴더 만들기</option>';
  sel.value=folders.includes(value)?value:'';
  $('newFolderInput').classList.add('hidden');$('newFolderInput').value='';
}
$('folderInput').addEventListener('change',()=>{const nw=$('folderInput').value==='__new';$('newFolderInput').classList.toggle('hidden',!nw);if(nw)$('newFolderInput').focus()});
function chosenFolder(){
  const v=$('folderInput').value;
  if(v!=='__new')return v;
  const name=$('newFolderInput').value.trim();
  if(name&&!folderList().includes(name))data.folders=[...folderList(),name];
  return name;
}
function reset(){['titleInput','startDateInput','endDateInput','startTimeInput','endTimeInput'].forEach(id=>$(id).value='');setEditorHtml('');setColor('#DCEBFF');$('reminderInput').value='';$('repeatInput').value='none';$('pinInput').checked=false;$('favoriteInput').checked=false;$('colorWheelPopup').classList.add('hidden');$('formError').textContent='';resetDeleteBtn();setEditStatus('');fillFolderSelect('')}
function edit(id,selected='',folder=''){
  editingId=id;reset();
  $('modalTitle').textContent=id?'항목 수정':'새 일정 / 메모';$('deleteBtn').classList.toggle('hidden',!id);
  if(id){const x=data.items.find(a=>a.id===id);if(!x)return;$('titleInput').value=x.title||'';setEditorHtml(MD.toEditorHtml(x.content||''));$('startDateInput').value=x.startDate||'';$('endDateInput').value=x.endDate||'';$('startTimeInput').value=x.startTime||'';$('endTimeInput').value=x.endTime||'';$('reminderInput').value=x.reminderMinutes==null?'':x.reminderMinutes;$('repeatInput').value=x.repeat||'none';$('pinInput').checked=!!x.pinned;$('favoriteInput').checked=!!x.favorite;setColor(x.color||'#DCEBFF');setEditStatus(x.status);fillFolderSelect(x.folder||'')}
  else if(folder)fillFolderSelect(folder);
  if(!id&&selected){$('startDateInput').value=selected;$('endDateInput').value=selected}
  $('modal').classList.remove('hidden');
  setTimeout(()=>{if(id)focusEditorEnd();else $('titleInput').focus()},60);
}
function closeModal(){$('modal').classList.add('hidden')}
function showFormError(msg){$('formError').textContent=msg;clearTimeout(showFormError.t);showFormError.t=setTimeout(()=>{$('formError').textContent=''},4000)}
async function persist(){await window.desktopAPI.saveData(data);render()}
$('saveBtn').onclick=async()=>{const title=$('titleInput').value.trim(),content=editorMarkdown(),start=$('startDateInput').value,end=$('endDateInput').value||start;if(!title&&!content)return showFormError('제목이나 내용을 하나는 입력해주세요.');if(start&&end&&end<start)return showFormError('종료 날짜가 시작 날짜보다 빠릅니다.');const old=editingId?data.items.find(x=>x.id===editingId):null,now=Date.now();const item={id:editingId||crypto.randomUUID(),title:title||'제목 없음',content,startDate:start,endDate:start?end:'',startTime:$('startTimeInput').value,endTime:$('endTimeInput').value,reminderMinutes:$('reminderInput').value===''?null:Number($('reminderInput').value),repeat:$('repeatInput').value,pinned:$('pinInput').checked,favorite:$('favoriteInput').checked,color:$('colorInput').value||'#DCEBFF',status:editStatus,folder:chosenFolder(),createdAt:old?.createdAt||now,updatedAt:now};if(editingId)data.items[data.items.findIndex(x=>x.id===editingId)]=item;else data.items.push(item);await persist();closeModal()}
$('titleInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&!e.ctrlKey){e.preventDefault();focusEditorEnd()}});
// 삭제는 한 번 더 눌러 확인합니다(창 안에서 확인 — 시스템 대화상자를 쓰지 않음).
let deleteArmed=null;
function resetDeleteBtn(){clearTimeout(deleteArmed);deleteArmed=null;$('deleteBtn').textContent='삭제';$('deleteBtn').classList.remove('armed')}
$('deleteBtn').onclick=async()=>{if(!editingId)return;if(!deleteArmed){$('deleteBtn').textContent='한 번 더 누르면 삭제';$('deleteBtn').classList.add('armed');deleteArmed=setTimeout(resetDeleteBtn,3000);return}resetDeleteBtn();data.items=data.items.filter(x=>x.id!==editingId);await persist();closeModal()};$('cancelBtn').onclick=closeModal;$('modalClose').onclick=closeModal;$('modal').onclick=e=>{e.stopPropagation()};$('modal').addEventListener('mousedown',e=>e.stopPropagation());$('prevMonth').onclick=()=>{cursor.setDate(1);cursor.setMonth(cursor.getMonth()-1);render()};$('nextMonth').onclick=()=>{cursor.setDate(1);cursor.setMonth(cursor.getMonth()+1);render()};$('todayBtn').onclick=()=>{cursor=new Date();render()};$('newEvent').onclick=()=>edit(null,today());$('newMemo').onclick=()=>edit(null,'',folderList().includes(memoFolder)?memoFolder:'');
document.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  const open=['modal','settingsModal','helpModal'].find(id=>!$(id).classList.contains('hidden'));
  if(e.key==='Escape'&&open){e.preventDefault();if(open==='modal'&&!$('colorWheelPopup').classList.contains('hidden'))$('colorWheelPopup').classList.add('hidden');else $(open).classList.add('hidden');return}
  if(open==='modal'&&e.ctrlKey&&(e.key==='Enter'||e.key.toLowerCase()==='s')){e.preventDefault();$('saveBtn').click()}
});
$('memoListBtn').onclick=async()=>{memoOpen=!memoOpen;$('mainLayout').classList.toggle('memo-open',memoOpen);$('memoListBtn').classList.toggle('active',memoOpen);$('memoListBtn').querySelector('span').textContent=memoOpen?'닫기':'열기';await window.desktopAPI.setMemoList(memoOpen)};
$('searchInput').oninput=renderList;document.querySelectorAll('.memo-filters button').forEach(b=>b.onclick=()=>{memoFilter=b.dataset.filter;document.querySelectorAll('.memo-filters button').forEach(x=>x.classList.toggle('active',x===b));renderList()});

let resizeSession=null;
document.querySelectorAll('.resize-handle').forEach(handle=>{
  handle.addEventListener('mousedown',async e=>{
    e.preventDefault();e.stopPropagation();
    const bounds=await window.desktopAPI.getWindowBounds();
    if(!bounds)return;
    resizeSession={dir:handle.dataset.dir,startX:e.screenX,startY:e.screenY,bounds};
    const move=async ev=>{
      if(!resizeSession)return;
      const s=resizeSession,b=s.bounds,dx=ev.screenX-s.startX,dy=ev.screenY-s.startY;
      let {x,y,width,height}=b;
      if(s.dir.includes('e')) width=b.width+dx;
      if(s.dir.includes('s')) height=b.height+dy;
      if(s.dir.includes('w')){width=b.width-dx;x=b.x+dx}
      if(s.dir.includes('n')){height=b.height-dy;y=b.y+dy}
      await window.desktopAPI.setWindowBounds({x,y,width,height});
    };
    const up=()=>{resizeSession=null;window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up)};
    window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
  });
});
function setPinnedUi(){$('pinBtn').classList.toggle('active',calendarPinned);$('pinBtn').title=calendarPinned?'캘린더 위치 고정 해제':'캘린더 위치 고정'}
$('pinBtn').onclick=async()=>{calendarPinned=!calendarPinned;await window.desktopAPI.setCalendarPinned(calendarPinned);setPinnedUi()};$('minBtn').onclick=()=>window.desktopAPI.minimizeWindow();$('closeBtn').onclick=()=>window.desktopAPI.closeWindow('calendar');
function applyOpacity(v){const n=Math.max(25,Math.min(100,Number(v)));document.documentElement.style.setProperty('--surface-alpha',(n/100).toFixed(2));$('opacityValue').textContent=`${n}%`;settings.backgroundOpacity=n;$('topOpacityInput').value=n;$('opacityInput').value=n;$('topOpacityValue').textContent=`${n}%`;const pct=`${((n-25)/75)*100}%`;$('topOpacityInput').style.setProperty('--slider-pct',pct);$('opacityInput').style.setProperty('--slider-pct',pct)}
function positionButton(p,onPick){
  const b=document.createElement('button');
  b.type='button';b.className='position-choice';
  const selected=String(settings.sidebarDisplayId||'')===String(p.id)&&(settings.sidebarSide||'right')===p.side;
  b.classList.toggle('active',selected);
  b.innerHTML=`<span class="position-thumb ${p.side}"></span><span>${escapeHtml(p.label)}</span>`;
  b.onclick=async()=>{settings=await window.desktopAPI.setSidebarPosition(p.id,p.side);await onPick()};
  return b;
}
async function renderSidebarPositionOptions(){
  const box=$('sidebarPositionOptions');if(!box)return;
  const positions=await window.desktopAPI.getSidebarPositions();
  box.innerHTML='';
  positions.forEach(p=>box.appendChild(positionButton(p,async()=>{await renderSidebarPositionOptions();await renderQuickSidebarPositions()})));
}
async function renderQuickSidebarPositions(){
  const box=$('quickSidebarPositions');if(!box)return;
  const positions=await window.desktopAPI.getSidebarPositions();
  box.innerHTML='';
  positions.slice(0,4).forEach(p=>box.appendChild(positionButton(p,async()=>{await renderQuickSidebarPositions();await renderSidebarPositionOptions()})));
}
$('sidebarPosBtn').onclick=async e=>{e.stopPropagation();const p=$('sidebarPositionPopover');p.classList.toggle('hidden');$('sidebarPosBtn').classList.toggle('active',!p.classList.contains('hidden'));if(!p.classList.contains('hidden'))await renderQuickSidebarPositions()};
document.addEventListener('click',e=>{const p=$('sidebarPositionPopover');if(p&&!p.classList.contains('hidden')&&!p.contains(e.target)&&!$('sidebarPosBtn').contains(e.target)){p.classList.add('hidden');$('sidebarPosBtn').classList.remove('active')}});
// ===== 테마 =====
function renderThemeOptions(){
  const box=$('themeOptions');if(!box)return;
  const current=Theme.themeId(settings),c=Theme.gradientColors(settings);
  box.innerHTML='';
  Theme.THEMES.forEach(t=>{
    const b=document.createElement('button');
    b.type='button';b.className='theme-option'+(t.id===current?' active':'');
    const keys=t.id==='mint'?[0,1,2].flatMap(o=>[1,2,4,5,6].map(k=>`<i style="left:${(o*7+k)*8-2}px"></i>`)).join(''):'';
    b.innerHTML=`<span class="theme-thumb ${t.id}">${keys}</span><b>${escapeHtml(t.name)}</b><small>${escapeHtml(t.desc)}</small>`;
    if(t.id==='gradient'){const th=b.querySelector('.theme-thumb');th.style.setProperty('--g1',c.bg1);th.style.setProperty('--g2',c.bg2);th.style.setProperty('--g3',c.bg3);th.style.setProperty('--ga',c.accent)}
    b.onclick=()=>saveTheme({theme:t.id});
    box.appendChild(b);
  });
  $('gradientColors').classList.toggle('hidden',current!=='gradient');
  $('themeBg1').value=c.bg1;$('themeBg2').value=c.bg2;$('themeBg3').value=c.bg3;$('themeAccent').value=c.accent;
}
async function saveTheme(patch){
  settings=await window.desktopAPI.saveSettings(patch);
  Theme.apply(settings);renderThemeOptions();
}
function themeColorsFromInputs(){return {bg1:$('themeBg1').value,bg2:$('themeBg2').value,bg3:$('themeBg3').value,accent:$('themeAccent').value}}
['themeBg1','themeBg2','themeBg3','themeAccent'].forEach(id=>{
  // 고르는 동안은 바로 미리 보여 주고, 손을 떼면 저장합니다.
  $(id).addEventListener('input',()=>{settings={...settings,themeColors:themeColorsFromInputs()};Theme.apply(settings)});
  $(id).addEventListener('change',()=>saveTheme({themeColors:themeColorsFromInputs()}));
});
$('themeColorsReset').onclick=()=>saveTheme({themeColors:{...Theme.GRADIENT_DEFAULT}});
$('settingsBtn').onclick=async()=>{$('settingsModal').classList.remove('hidden');renderThemeOptions();applyOpacity(settings.backgroundOpacity||82);await renderSidebarPositionOptions()};$('settingsClose').onclick=()=>$('settingsModal').classList.add('hidden');$('settingsModal').onclick=e=>{if(e.target===$('settingsModal'))$('settingsModal').classList.add('hidden')};$('opacityInput').oninput=e=>applyOpacity(e.target.value);$('topOpacityInput').oninput=e=>applyOpacity(e.target.value);$('opacityInput').onchange=async()=>{settings=await window.desktopAPI.saveSettings({backgroundOpacity:Number($('opacityInput').value)})};$('topOpacityInput').onchange=async()=>{settings=await window.desktopAPI.saveSettings({backgroundOpacity:Number($('topOpacityInput').value)})};
function showHelpTab(tab){
  document.querySelectorAll('[data-help-tab]').forEach(b=>{if(b.closest('.help-tabs')){b.classList.toggle('active',b.dataset.helpTab===tab);b.setAttribute('aria-selected',b.dataset.helpTab===tab)}});
  document.querySelectorAll('[data-help-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.helpPanel!==tab));
  $('helpModal').querySelector('.modal-body').scrollTop=0;
}
document.querySelectorAll('[data-help-tab]').forEach(b=>b.addEventListener('click',()=>showHelpTab(b.dataset.helpTab)));
$('helpBtn').onclick=()=>{showHelpTab('guide');$('helpModal').classList.remove('hidden')};$('helpClose').onclick=()=>$('helpModal').classList.add('hidden');$('helpModal').onclick=e=>{if(e.target===$('helpModal'))$('helpModal').classList.add('hidden')};
// ===== 업데이트 알림 =====
let updateStatus={state:'idle'};
function notesToText(notes){
  // GitHub 릴리스 노트는 HTML 로 올 수 있어 글자만 꺼내 씁니다(태그는 실행하지 않음).
  const doc=new DOMParser().parseFromString(String(notes||''),'text/html');
  doc.querySelectorAll('li').forEach(li=>li.prepend('• '));
  doc.querySelectorAll('br,p,li,h1,h2,h3,div').forEach(el=>el.append('\n'));
  return doc.body.textContent.replace(/\n{3,}/g,'\n\n').trim();
}
function renderUpdateStatus(st){
  updateStatus=st||{state:'idle'};
  const btn=$('updateBtn'),s=updateStatus.state;
  btn.classList.toggle('hidden',!(s==='downloading'||s==='ready'));
  btn.classList.toggle('ready',s==='ready');
  if(s==='downloading')btn.textContent=`새 버전 받는 중 ${updateStatus.percent||0}%`;
  if(s==='ready')btn.innerHTML=`<svg class="icon"><use href="#i-spark"/></svg>v${escapeHtml(updateStatus.newVersion||'')} 업데이트`;
  const text={idle:'새 버전이 나오면 자동으로 받아서 알려 드려요.',checking:'새 버전을 확인하는 중…',latest:'최신 버전을 쓰고 있어요.',
    downloading:`새 버전 v${updateStatus.newVersion||''} 을 받는 중이에요 (${updateStatus.percent||0}%).`,
    ready:`새 버전 v${updateStatus.newVersion||''} 이 준비됐어요. 다시 시작하면 적용돼요.`,
    error:'업데이트를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.',dev:'개발용 실행·미리보기에서는 업데이트를 확인하지 않아요.'}[s]||'';
  $('updateStatusText').textContent=text;
  $('checkUpdateBtn').textContent=s==='ready'?'지금 다시 시작':'업데이트 확인';
}
function openUpdateModal(){
  $('updateTitle').textContent=`새 버전 v${updateStatus.newVersion||''} 이 준비됐어요`;
  $('updateNotes').textContent=notesToText(updateStatus.notes)||'자세한 내용은 다운로드 페이지에서 볼 수 있어요.';
  $('updateModal').classList.remove('hidden');
}
$('updateBtn').onclick=()=>{if(updateStatus.state==='ready')openUpdateModal()};
$('updateClose').onclick=$('updateLater').onclick=()=>$('updateModal').classList.add('hidden');
$('updateInstall').onclick=()=>window.desktopAPI.installUpdate?.();
$('checkUpdateBtn').onclick=async()=>{
  if(updateStatus.state==='ready'){openUpdateModal();return}
  renderUpdateStatus({...updateStatus,state:'checking'});
  renderUpdateStatus(await window.desktopAPI.checkForUpdates?.()||{state:'dev'});
};
let readyShown=false;
window.desktopAPI.onUpdateStatus?.(st=>{
  renderUpdateStatus(st);
  // 새 버전을 다 받으면 한 번 안내 창을 띄웁니다.
  if(st.state==='ready'&&!readyShown){readyShown=true;openUpdateModal()}
});
// 피드백 보내기: 피드백 폼 주소가 설정된 빌드에서만 버튼이 보입니다.
async function initFeedback(){
  const ok=await window.desktopAPI.isFeedbackAvailable?.();
  $('feedbackBtn').classList.toggle('hidden',!ok);
}
$('feedbackBtn').onclick=()=>window.desktopAPI.openFeedback?.();
async function initUpdates(){
  const v=await window.desktopAPI.getAppVersion?.();
  if(v){$('appVersion').textContent=`v${v}`;$('settingsVersion').textContent=`현재 버전 v${v}`}
  renderUpdateStatus(await window.desktopAPI.getUpdateStatus?.()||{state:'idle'});
}
window.desktopAPI.onDataChanged(d=>{data=d;render()});window.desktopAPI.onCalendarEdit(id=>edit(id));
async function init(){initColors();initUpdates();initFeedback();data=await window.desktopAPI.getData();settings=await window.desktopAPI.getSettings();Theme.apply(settings);applyOpacity(settings.backgroundOpacity||82);render();renderQuickSidebarPositions();calendarPinned=!!settings.calendarPinned;setPinnedUi()}init();
