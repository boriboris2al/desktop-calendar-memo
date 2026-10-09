// 편집기 마크다운 · 체크박스 동작 테스트 (헤드리스 Chromium)
//   npm i -D playwright && npx playwright install chromium   (최초 1회)
//   npm test
const path=require('path');
let chromium;
try{({chromium}=require('playwright'))}catch{console.error('playwright 가 필요합니다: npm i -D playwright && npx playwright install chromium');process.exit(1)}
const R='file://'+path.resolve(__dirname,'../renderer').replace(/\\/g,'/')+'/';
const STUB=`window.__saved=[];
window.desktopAPI={
  getData:async()=>window.__data||{items:[]},
  saveData:async d=>{window.__saved.push(JSON.parse(JSON.stringify(d)));return true},
  setMemoList:async()=>true,setCalendarPinned:async p=>p,setSidebarExpanded:async e=>e,openCalendar:async()=>{},
  closeWindow:async()=>{},minimizeWindow:async()=>{},onDataChanged:()=>{},onCalendarEdit:()=>{},
  getSettings:async()=>({}),saveSettings:async p=>p,
  getSidebarPositions:async()=>[{id:'1',side:'left',label:'기본 모니터 - 왼쪽'},{id:'1',side:'right',label:'기본 모니터 - 오른쪽'}],
  getSidebarSide:async()=>'right',onSidebarPositionChanged:()=>{},setSidebarPosition:async(id,side)=>({sidebarDisplayId:id,sidebarSide:side}),
  getWindowBounds:async()=>null,setWindowBounds:async()=>null
};
`;

(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1120,height:760}});
  const p=await ctx.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(STUB);
  await p.addInitScript(()=>{window.__data={items:[{id:'old',title:'예전 메모',content:'# 캘린더 + 메모\n\n- [ ] 날짜를 넣으면 캘린더와 연결됩니다\n- [x] 완료\n**굵게** <u>밑줄</u> ~~취소~~\n<img src=x onerror="window.__xss=1">',startDate:'',endDate:'',pinned:true}]}});
  await p.goto(R+'calendar.html');await p.waitForTimeout(250);
  const k=p.keyboard,results=[];
  const md=()=>p.evaluate(()=>MD.fromEditor(document.getElementById('contentInput')));
  const check=(n,g,e)=>{const ok=g===e;results.push(ok);console.log((ok?'PASS ':'FAIL ')+n+(ok?'':`\n  got: ${JSON.stringify(g)}\n  exp: ${JSON.stringify(e)}`))};
  const fresh=async()=>{await p.evaluate(()=>{document.getElementById('modal').classList.add('hidden')});await p.click('#newEvent');await p.waitForTimeout(120);await p.click('#contentInput')};

  // legacy content round trip
  await p.evaluate(()=>edit('old'));await p.waitForTimeout(150);
  check('legacy content loads & re-serializes',await md(),'# 캘린더 + 메모\n\n- [ ] 날짜를 넣으면 캘린더와 연결됩니다\n- [x] 완료\n**굵게** <u>밑줄</u> ~~취소~~\n<img src=x onerror="window.\\__xss=1">');
  check('no script injection',await p.evaluate(()=>window.__xss),undefined);

  // toolbar: B on selection, then H1, todo, bullet toggle
  await fresh();
  await k.type('줄 하나');await k.press('Shift+Home');
  await p.click('#editorToolbar [data-action=bold]');
  await k.press('End');
  check('toolbar bold on selection',await md(),'**줄 하나**');
  await p.click('#editorToolbar [data-action=h1]');
  check('toolbar H1',await md(),'# **줄 하나**');
  await p.click('#editorToolbar [data-action=h1]');
  check('toolbar H1 toggles off',await md(),'**줄 하나**');
  await p.click('#editorToolbar [data-action=todo]');
  check('toolbar todo',await md(),'- [ ] **줄 하나**');
  await p.click('#editorToolbar [data-action=bullet]');
  check('todo → bullet',await md(),'- **줄 하나**');
  await p.click('#editorToolbar [data-action=numbered]');
  check('bullet → numbered',await md(),'1. **줄 하나**');
  await p.click('#editorToolbar [data-action=body]');
  check('→ body',await md(),'**줄 하나**');

  // Ctrl+B / Ctrl+I / Ctrl+U typing, Ctrl+Shift+X, Ctrl+Shift+C
  await fresh();
  await k.type('a ');await k.press('Control+b');await k.type('굵');await k.press('Control+b');await k.type(' ');
  await k.press('Control+i');await k.type('기');await k.press('Control+i');await k.type(' ');
  await k.press('Control+u');await k.type('밑');await k.press('Control+u');
  check('Ctrl+B/I/U',await md(),'a **굵** *기* <u>밑</u>');
  await k.press('Control+Shift+c');
  check('Ctrl+Shift+C → todo',await md(),'- [ ] a **굵** *기* <u>밑</u>');

  // multi-line selection → todo
  await fresh();
  await k.type('하나');await k.press('Enter');await k.type('둘');await k.press('Enter');await k.type('셋');
  await k.press('Control+a');await p.click('#editorToolbar [data-action=todo]');
  check('multi-line → todo',await md(),'- [ ] 하나\n- [ ] 둘\n- [ ] 셋');

  // backspace at start of todo removes checkbox only; enter on empty todo exits
  await fresh();
  await k.type('[] 할일');await k.press('Home');await k.press('Backspace');
  check('backspace at todo start → body',await md(),'할일');
  await k.press('Control+z');
  await fresh();
  await k.type('[] 첫');await k.press('Enter');await k.press('Enter');await k.type('본문');
  check('enter on empty todo exits list',await md(),'- [ ] 첫\n본문');
  await k.press('Enter');await k.type('## 제목');await k.press('Home');await k.press('Backspace');
  check('backspace at heading start → body',await md(),'- [ ] 첫\n본문\n제목');

  // paste markdown
  await fresh();
  await p.evaluate(()=>{const dt=new DataTransfer();dt.setData('text/plain','# 붙여넣기\n- [ ] 항목\n- [x] 완료\n1. 하나\n일반 **굵게**');document.getElementById('contentInput').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))});
  check('paste markdown',await md(),'# 붙여넣기\n- [ ] 항목\n- [x] 완료\n1. 하나\n일반 **굵게**');

  // Korean IME composition with shortcuts
  await fresh();
  const cdp=await ctx.newCDPSession(p);  // 한글 IME 조합 입력
  await k.type('[] ');
  await cdp.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.imeSetComposition',{text:'하',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.insertText',{text:'할'});
  await cdp.send('Input.imeSetComposition',{text:'ㅇ',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.insertText',{text:'일'});
  await k.press('Enter');
  await cdp.send('Input.imeSetComposition',{text:'두',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.insertText',{text:'둘'});
  check('Korean IME in todo',await md(),'- [ ] 할일\n- [ ] 둘');

  // Esc closes, Ctrl+Enter saves
  await p.fill('#titleInput','단축키');await p.click('#contentInput');await k.press('Control+Enter');await p.waitForTimeout(100);
  check('Ctrl+Enter saves',await p.evaluate(()=>window.__saved.at(-1).items.at(-1).title),'단축키');


  // ---- 전체 입력 → 저장 → 다시 열기
  await p.evaluate(()=>{window.__saved.length=0;data={items:[]};render()});
  // --- 새 메모: 마크다운 단축 입력
  await fresh();
  await p.fill('#titleInput','테스트');await p.click('#contentInput');
    await k.type('# 큰 제목');await k.press('Enter');
  await k.type('## 작은 제목');await k.press('Enter');
  await k.type('본문 **굵게** 그리고 *기울임* ~~취소~~ `코드` 끝');await k.press('Enter');
  await k.type('- 사과');await k.press('Enter');await k.type('바나나');await k.press('Enter');await k.press('Enter');
  await k.type('1. 하나');await k.press('Enter');await k.type('둘');await k.press('Enter');await k.press('Enter');
  await k.type('[] 할 일 1');await k.press('Enter');await k.type('할 일 2');await k.press('Enter');await k.press('Enter');
  await k.type('[x] 끝난 일');await k.press('Enter');await k.press('Enter');
  await k.type('- [ ] 대시 할 일');await k.press('Enter');await k.press('Enter');
  await k.type('> 인용문');await k.press('Enter');await k.press('Enter');
  await k.type('---');await k.press('Enter');
  await k.type('별표*그대로* 아님 2*3=6 snake_case');
  check('typed shortcuts → markdown',await md(),
`# 큰 제목
## 작은 제목
본문 **굵게** 그리고 *기울임* ~~취소~~ \`코드\` 끝
- 사과
- 바나나
1. 하나
2. 둘
- [ ] 할 일 1
- [ ] 할 일 2
- [x] 끝난 일
- [ ] 대시 할 일
> 인용문
---
별표*그대로* 아님 2\\*3=6 snake_case`);

  // 체크박스 클릭 (첫 할 일)
  const box=await p.locator('#contentInput .todo-line').first().boundingBox();
  await p.mouse.click(box.x+10,box.y+box.height/2);
  check('click checkbox toggles',await p.evaluate(()=>document.querySelector('#contentInput .todo-line').dataset.checked),'true');

  // 저장 → 다시 열기 → 동일한 마크다운
  await p.click('#saveBtn');await p.waitForTimeout(150);
  const saved=await p.evaluate(()=>window.__saved.at(-1).items.at(-1).content);
  await p.evaluate(()=>{data=window.__saved.at(-1);render()});
  await p.click('#memoListBtn');await p.waitForTimeout(100);
  await p.click('.memo-card .memo-card-title');await p.waitForTimeout(150);
  check('round trip (save → reopen)',await md(),saved);
  await p.click('#cancelBtn');

  // 메모 리스트 미리보기에서 체크박스 토글: 라벨 텍스트 클릭 시 편집창이 열리면 안 됨
  const n0=await p.evaluate(()=>window.__saved.length);
  await p.locator('.memo-preview .md-todo span').nth(1).click();await p.waitForTimeout(150);
  check('list label click does not open modal',await p.evaluate(()=>document.getElementById('modal').classList.contains('hidden')),true);
  const after=await p.evaluate(()=>window.__saved.at(-1).items.at(-1).content.split('\n').filter(l=>l.includes('할 일 2'))[0]);
  check('list checkbox toggles markdown',after,'- [x] 할 일 2');
  check('one save per toggle',await p.evaluate(()=>window.__saved.length)-n0,1);


  // sidebar
  const s=await ctx.newPage();const se=[];s.on('pageerror',e=>se.push(e.message));
  await s.setViewportSize({width:390,height:600});
  await s.addInitScript(STUB);
  await s.addInitScript(()=>{window.__data={items:[{id:'old',title:'고정 메모',color:'#FFE2DF',content:'# 오늘 할 일\n- [ ] 장보기\n- [x] 운동\n- 우유\n- 계란\n> 메모 **중요**\n<img src=x onerror="window.__xss=1">',pinned:true}]}});
  await s.goto(R+'sidebar.html');await s.waitForTimeout(200);
  await s.click('.tab');await s.waitForTimeout(100);
  await s.click('.md-todo >> nth=0');await s.waitForTimeout(100);
  check('sidebar checkbox toggles markdown',await s.evaluate(()=>window.__saved.at(-1)?.items[0].content.split('\n')[1]),'- [x] 장보기');
  check('sidebar: no script injection',await s.evaluate(()=>window.__xss),undefined);
  errs.push(...se);

  // 맥: 단축키 표시가 ⌘ 로 바뀌고, ⌘+Shift+C · ⌘+Enter 가 동작
  const mctx=await b.newContext({viewport:{width:1120,height:760},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'});
  const m=await mctx.newPage();m.on('pageerror',e=>errs.push(e.message));
  await m.addInitScript(STUB);
  await m.goto(R+'calendar.html');await m.waitForTimeout(250);
  check('mac: kbd shows ⌘',await m.evaluate(()=>[...document.querySelectorAll('kbd')].some(k=>k.textContent==='Ctrl')),false);
  check('mac: tooltip shows ⌘',await m.evaluate(()=>document.querySelector('[data-action=bold]').title),'굵게 (⌘B · **글자**)');
  await m.click('#newEvent');await m.waitForTimeout(120);await m.fill('#titleInput','맥 일정');await m.click('#contentInput');
  await m.keyboard.type('할 일');await m.keyboard.press('Meta+Shift+c');
  check('mac: ⌘+Shift+C todo',await m.evaluate(()=>MD.fromEditor(document.getElementById('contentInput'))),'- [ ] 할 일');
  await m.keyboard.press('Meta+Enter');await m.waitForTimeout(150);
  check('mac: ⌘+Enter saves',await m.evaluate(()=>window.__saved.at(-1)?.items.at(-1)?.title),'맥 일정');

  await b.close();
  if(errs.length)console.log('PAGE ERRORS:\n'+errs.join('\n'));
  const passed=results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed===results.length&&!errs.length?0:1);
})();
