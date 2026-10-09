// 메모 내용은 마크다운 텍스트로 저장됩니다.
// 이 파일은 캘린더(편집기·메모 리스트)와 사이드 메모가 함께 쓰는 변환기입니다.
//   마크다운 → 미리보기 HTML   : MD.toHtml
//   마크다운 → 편집기 HTML     : MD.toEditorHtml
//   편집기 DOM → 마크다운      : MD.fromEditor
(function(){
  const ZWSP=/\u200B/g;
  const ESCAPABLE='\\\\`*_~#>\\[\\]\\-+.)!<';
  const UNESCAPE_RE=new RegExp(`\\\\([${ESCAPABLE}])`,'g');

  function escapeHtml(s){
    return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ---------- 인라인 문법 ----------
  // `코드`, **굵게**, *기울임* / _기울임_, ***굵은 기울임***, ~~취소선~~, <u>밑줄</u>, \* 이스케이프
  function inline(src){
    const slots=[];
    const hold=html=>`\u0000${slots.push(html)-1}\u0000`;
    let s=String(src??'').replace(ZWSP,'');
    s=s.replace(UNESCAPE_RE,(_,c)=>hold(escapeHtml(c)));
    s=s.replace(/`([^`]+)`/g,(_,c)=>hold(`<code>${escapeHtml(c)}</code>`));
    s=escapeHtml(s);
    s=s.replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/g,'<u>$1</u>');
    s=s.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g,'<strong><em>$1</em></strong>');
    s=s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g,'<strong>$1</strong>');
    s=s.replace(/~~(?=\S)([\s\S]*?\S)~~/g,'<s>$1</s>');
    s=s.replace(/(^|[^*])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g,'$1<em>$2</em>');
    s=s.replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}_])/gu,'$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g,(_,i)=>slots[Number(i)]);
  }

  // 검색·탭 제목처럼 서식 없는 글자만 필요할 때
  function inlinePlain(src){
    const div=document.createElement('div');div.innerHTML=inline(src);return div.textContent;
  }

  // ---------- 블록 문법 ----------
  const RE={
    todo:/^\s*[-*+]\s+\[([ xX])\](?:\s+(.*))?$/,
    heading:/^(#{1,3})\s+(.*)$/,
    hr:/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/,
    quote:/^>\s?(.*)$/,
    ul:/^\s*[-*+]\s+(.*)$/,
    ol:/^\s*(\d{1,9})[.)]\s+(.*)$/
  };

  // 각 줄을 블록 토큰으로 바꿉니다. line 은 원본 줄 번호(체크박스 토글에 사용).
  function parse(text){
    return String(text??'').replace(/\r\n?/g,'\n').split('\n').map((raw,line)=>{
      let m;
      if(!raw.trim())return {type:'blank',line};
      if((m=raw.match(RE.todo)))return {type:'todo',checked:m[1].toLowerCase()==='x',text:m[2]||'',line};
      if((m=raw.match(RE.heading)))return {type:'heading',level:m[1].length,text:m[2],line};
      if(RE.hr.test(raw))return {type:'hr',line};
      if((m=raw.match(RE.quote)))return {type:'quote',text:m[1],line};
      if((m=raw.match(RE.ul)))return {type:'ul',text:m[1],line};
      if((m=raw.match(RE.ol)))return {type:'ol',start:Number(m[1]),text:m[2],line};
      return {type:'p',text:raw,line};
    });
  }

  // 같은 종류의 목록 항목이 이어지면 하나의 <ul>/<ol>로 묶습니다.
  function joinLists(blocks,render,emptyItem=''){
    let out='',list=null;
    const close=()=>{if(list){out+=`</${list}>`;list=null}};
    for(const b of blocks){
      if(b.type==='ul'||b.type==='ol'){
        if(list!==b.type){close();out+=b.type==='ol'&&b.start!==1?`<ol start="${b.start}">`:`<${b.type}>`;list=b.type}
        out+=`<li>${inline(b.text)||emptyItem}</li>`;continue;
      }
      close();out+=render(b);
    }
    close();return out;
  }

  // 미리보기(메모 리스트·사이드 메모). interactive=true 면 체크박스를 누를 수 있습니다.
  function toHtml(text,{interactive=false,empty='<span class="md-empty">내용 없음</span>'}={}){
    const html=joinLists(parse(text),b=>{
      switch(b.type){
        case 'blank':return '';
        case 'todo':return `<label class="md-todo${b.checked?' checked':''}"><input type="checkbox" data-line="${b.line}"${b.checked?' checked':''}${interactive?'':' disabled'}><span>${inline(b.text)}</span></label>`;
        case 'heading':return `<h${b.level}>${inline(b.text)}</h${b.level}>`;
        case 'hr':return '<hr>';
        case 'quote':return `<blockquote>${inline(b.text)}</blockquote>`;
        default:return `<p>${inline(b.text)}</p>`;
      }
    });
    return `<div class="md">${html||empty}</div>`;
  }

  function toEditorHtml(text){
    const blocks=parse(String(text??'').replace(/^\n+|\n+$/g,''));
    return joinLists(blocks,b=>{
      switch(b.type){
        case 'blank':return '<div><br></div>';
        case 'todo':return `<div class="todo-line" data-checked="${b.checked}">${inline(b.text)||'<br>'}</div>`;
        case 'heading':return `<h${b.level}>${inline(b.text)||'<br>'}</h${b.level}>`;
        case 'hr':return '<hr>';
        case 'quote':return `<blockquote>${inline(b.text)||'<br>'}</blockquote>`;
        default:return `<div>${inline(b.text)}</div>`;
      }
    },'<br>');
  }

  // 체크박스 하나를 토글한 새 마크다운을 돌려줍니다.
  function toggleTodo(text,line,checked){
    const lines=String(text??'').split('\n');
    if(lines[line]==null||!RE.todo.test(lines[line]))return text;
    lines[line]=lines[line].replace(/\[([ xX])\]/,checked?'[x]':'[ ]');
    return lines.join('\n');
  }

  // ---------- 편집기 DOM → 마크다운 ----------
  const INLINE_TAGS=new Set(['B','STRONG','I','EM','U','S','STRIKE','DEL','CODE','SPAN','FONT','A','MARK','SUB','SUP','SMALL','BR']);
  const isInline=n=>n.nodeType===Node.TEXT_NODE||(n.nodeType===Node.ELEMENT_NODE&&INLINE_TAGS.has(n.tagName));

  // 일반 글자 안의 마크다운 기호는 이스케이프해서 저장합니다(다시 열었을 때 서식으로 바뀌지 않도록).
  function escapeText(t){
    return t.replace(/[\\`*~]/g,'\\$&')
      .replace(/<(?=\/?u>)/gi,'\\<')
      .replace(/(^|[^\p{L}\p{N}_])_|_(?![\p{L}\p{N}_])/gu,(m)=>m.replace('_','\\_'));
  }
  function escapeLineStart(line){
    if(RE.hr.test(line))return line.replace(/^(\s*)/,'$1\\');
    return line
      .replace(/^(\s*)(#{1,6}\s|[-+]\s|>)/,'$1\\$2')
      .replace(/^(\s*\d{1,9})([.)]\s)/,'$1\\$2');
  }
  function wrap(mark,inner,close=mark){
    // 서식 기호는 공백 바깥에 둡니다:  "**굵게 **" → "**굵게** "
    const m=inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2]?`${m[1]}${mark}${m[2]}${close}${m[3]}`:inner;
  }
  function inlineMd(node){
    if(node.nodeType===Node.TEXT_NODE)return escapeText((node.nodeValue||'').replace(ZWSP,''));
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const tag=node.tagName;
    if(tag==='BR')return '\n';
    if(tag==='CODE')return wrap('`',(node.textContent||'').replace(ZWSP,''));
    let inner='';node.childNodes.forEach(c=>{inner+=inlineMd(c)});
    if(tag==='B'||tag==='STRONG')return wrap('**',inner);
    if(tag==='I'||tag==='EM')return wrap('*',inner);
    if(tag==='S'||tag==='STRIKE'||tag==='DEL')return wrap('~~',inner);
    if(tag==='U')return wrap('<u>',inner,'</u>');
    return inner;
  }
  // 블록 안의 인라인 내용을 줄 단위로 (Shift+Enter 줄바꿈 포함). 맨 끝의 <br>은 무시합니다.
  function inlineLines(nodes){
    let s='';nodes.forEach(n=>{s+=inlineMd(n)});
    s=s.replace(/ /g,' ').replace(/\n$/,'');
    return s.split('\n').map(l=>l.replace(/\s+$/,''));
  }

  function fromEditor(root){
    const out=[];
    const blockOf=(nodes,kind,el)=>{
      const lines=inlineLines(nodes);
      if(kind==='todo'){
        const box=el.dataset.checked==='true'?'x':' ';
        out.push(`- [${box}] ${lines.join(' ').trim()}`.trimEnd());return;
      }
      lines.forEach((line,i)=>{
        const t=line.trim();
        if(kind==='h1'||kind==='h2'||kind==='h3'){out.push(t?`${'#'.repeat(Number(kind[1]))} ${t}`:'');return}
        if(kind==='quote'){out.push(`> ${t}`.trimEnd());return}
        if(kind==='li'){out.push(i===0?`${el._marker} ${t}`.trimEnd():`  ${t}`);return}
        out.push(escapeLineStart(line));
      });
    };
    const walk=container=>{
      let run=[];
      const flush=()=>{
        if(run.length&&run.some(n=>n.nodeType!==Node.TEXT_NODE||n.nodeValue.replace(ZWSP,'').trim()||run.length>1))blockOf(run,'p');
        run=[];
      };
      container.childNodes.forEach(n=>{
        if(isInline(n)){run.push(n);if(n.nodeName==='BR'){flush()}return}
        flush();
        if(n.nodeType!==Node.ELEMENT_NODE)return;
        const tag=n.tagName;
        if(n.classList.contains('todo-line'))return blockOf([...n.childNodes],'todo',n);
        if(/^H[1-6]$/.test(tag))return blockOf([...n.childNodes],'h'+Math.min(3,Number(tag[1])));
        if(tag==='HR')return out.push('---');
        if(tag==='BLOCKQUOTE')return blockOf([...n.childNodes],'quote');
        if(tag==='UL'||tag==='OL'){
          let num=Number(n.getAttribute('start'))||1;
          n.querySelectorAll(':scope > li').forEach(li=>{
            li._marker=tag==='OL'?`${num++}.`:'-';
            const own=[...li.childNodes].filter(isInline);
            blockOf(own,'li',li);
            li.querySelectorAll(':scope > ul, :scope > ol').forEach(walkNested);
          });
          return;
        }
        // div/p 등: 안에 다른 블록이 있으면 그대로 펼쳐서 처리
        if([...n.childNodes].some(c=>!isInline(c)))return walk(n);
        const hasContent=(n.textContent||'').replace(ZWSP,'').length>0;
        if(!hasContent){out.push('');return}
        blockOf([...n.childNodes],'p');
      });
      flush();
    };
    const walkNested=list=>{const holder=document.createElement('div');holder.appendChild(list.cloneNode(true));walk(holder)};
    walk(root);
    return out.join('\n').replace(/^\n+|\n+$/g,'');
  }

  function toPlain(text){
    return parse(text).map(b=>b.text?inlinePlain(b.text):'').join('\n');
  }

  window.MD={escapeHtml,inline,parse,toHtml,toEditorHtml,fromEditor,toggleTodo,toPlain};
})();
