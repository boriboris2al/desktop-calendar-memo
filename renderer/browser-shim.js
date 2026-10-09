// 브라우저 미리보기용 desktopAPI.
// Electron 에서는 preload.js 가 window.desktopAPI 를 만들어 두므로 이 파일은 아무 일도 하지 않습니다.
// 일반 브라우저에서 열면 localStorage 에 저장하는 가짜 desktopAPI 를 만들고,
// 미리보기 페이지(index.html) 안의 iframe 이면 부모 페이지와 postMessage 로 창 크기·데이터를 주고받습니다.
(function(){
  if(window.desktopAPI)return;

  const DATA_KEY='dcm-preview-data-v1',SETTINGS_KEY='dcm-preview-settings-v1';
  const inFrame=window.parent!==window;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const load=(k,fallback)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):fallback()}catch{return fallback()}};
  const store=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
  const post=(type,payload)=>{if(inFrame)window.parent.postMessage({dcm:true,type,payload},'*')};

  function sampleData(){
    const now=new Date(),day=n=>{const d=new Date(now);d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
    const t=Date.now(),base={endTime:'',reminderMinutes:null,repeat:'none',pinned:false,favorite:false,createdAt:t,updatedAt:t};
    return {folders:['업무','개인'],items:[
      {...base,id:'sample-today',title:'오늘 할 일',color:'#FFE2DF',pinned:true,status:'doing',folder:'개인',startDate:day(0),endDate:day(0),startTime:'09:30',endTime:'11:00',
        content:'# 오전\n- [x] 메일 확인\n- [ ] 장보기\n- [ ] 운동 30분\n\n## 장볼 것\n- 우유\n- 계란\n> 마트는 **8시**에 닫음'},
      {...base,id:'sample-meeting',title:'팀 회의',color:'#DCEBFF',status:'todo',folder:'업무',startDate:day(1),endDate:day(1),startTime:'14:00',endTime:'15:00',reminderMinutes:10,
        content:'1. 지난주 진행 상황\n2. 다음 스프린트 계획\n- [ ] 회의록 공유'},
      {...base,id:'sample-trip',title:'제주 여행',color:'#DDF7F1',favorite:true,status:'done',folder:'개인',startDate:day(4),endDate:day(7),
        content:'## 준비물\n- [ ] 신분증\n- [ ] 충전기\n- [x] 숙소 예약'},
      {...base,id:'sample-gym',title:'수영',color:'#EEE4FF',startDate:day(-2),endDate:day(-2),startTime:'07:00',repeat:'weekly',content:''},
      {...base,id:'sample-md',title:'마크다운 예시',color:'#FFF0D6',pinned:true,
        content:'# 제목 1\n## 제목 2\n**굵게**, *기울임*, ~~취소선~~, <u>밑줄</u>, `코드`\n- 글머리 목록\n1. 번호 목록\n- [ ] 할 일\n- [x] 끝난 일\n> 인용문\n---\n줄 맨 앞에 # - [] > 를 치고 스페이스를 눌러 보세요.'}
    ]};
  }

  let data=load(DATA_KEY,sampleData);
  let settings=load(SETTINGS_KEY,()=>({}));
  const listeners={};
  const on=(ch,cb)=>{(listeners[ch]||=[]).push(cb)};
  const emit=(ch,payload)=>(listeners[ch]||[]).forEach(cb=>{try{cb(clone(payload))}catch(e){console.error(e)}});
  const setData=d=>{data=clone(d);store(DATA_KEY,data)};

  // 부모(미리보기 페이지)가 다른 창의 변경 사항을 전달해 줍니다.
  window.addEventListener('message',e=>{
    const m=e.data;if(!m||!m.dcm||e.source!==window.parent)return;
    if(m.type==='data'){setData(m.payload);emit('data:changed',data)}
    else if(m.type==='edit')emit('calendar:edit',m.payload);
    else if(m.type==='update-demo')emit('update:status',{state:'ready',version:'1.4.0',newVersion:'1.5.0',notes:'<ul><li>새 테마 추가</li><li>사이드 메모에서 바로 체크</li><li>자잘한 버그 수정</li></ul>'});
    else if(m.type==='settings'){settings={...m.payload};store(SETTINGS_KEY,settings);emit('settings:changed',settings)}
    else if(m.type==='side'){settings={...settings,sidebarSide:m.payload};store(SETTINGS_KEY,settings);emit('sidebar:position',m.payload)}
    else if(m.type==='reset'){try{localStorage.removeItem(DATA_KEY);localStorage.removeItem(SETTINGS_KEY)}catch{}location.reload()}
  });

  const positions=[{id:'preview',side:'left',label:'기본 모니터 - 왼쪽',bounds:null},{id:'preview',side:'right',label:'기본 모니터 - 오른쪽',bounds:null}];

  window.desktopAPI={
    isPreview:true,
    getData:async()=>clone(data),
    saveData:async d=>{setData(d);emit('data:changed',data);post('data',data);return true},
    setMemoList:async open=>{post('memoList',!!open);return true},
    setCalendarPinned:async p=>{settings={...settings,calendarPinned:!!p};store(SETTINGS_KEY,settings);return !!p},
    setSidebarExpanded:async e=>{post('sidebarExpanded',!!e);return !!e},
    openCalendar:async id=>{post('edit',id)},
    closeWindow:async which=>{post('close',which||'calendar')},
    minimizeWindow:async()=>{post('minimize')},
    onDataChanged:cb=>on('data:changed',cb),
    onCalendarEdit:cb=>on('calendar:edit',cb),
    getSettings:async()=>clone(settings),
    saveSettings:async patch=>{settings={...settings,...patch};store(SETTINGS_KEY,settings);emit('settings:changed',settings);post('settings',settings);return clone(settings)},
    onSettingsChanged:cb=>on('settings:changed',cb),
    getSidebarPositions:async()=>clone(positions),
    getSidebarSide:async()=>settings.sidebarSide==='left'?'left':'right',
    onSidebarPositionChanged:cb=>on('sidebar:position',cb),
    setSidebarPosition:async(id,side)=>{settings={...settings,sidebarDisplayId:String(id),sidebarSide:side};store(SETTINGS_KEY,settings);post('side',side);emit('sidebar:position',side);return clone(settings)},
    getAppVersion:async()=>'1.4.0',
    isFeedbackAvailable:async()=>true,
    openFeedback:async()=>{post('toast','실제 앱에서는 여기서 피드백 창이 열려요.')},
    getUpdateStatus:async()=>({state:'dev'}),
    checkForUpdates:async()=>({state:'dev'}),
    installUpdate:async()=>{post('toast','미리보기에서는 다시 시작할 수 없어요. 실제 앱에서는 여기서 새 버전이 설치돼요.')},
    onUpdateStatus:cb=>on('update:status',cb),
    getWindowBounds:async()=>null,
    setWindowBounds:async()=>null
  };
  post('ready',{page:location.pathname.split('/').pop(),pinned:(data.items||[]).filter(x=>x.pinned).length,side:settings.sidebarSide==='left'?'left':'right'});
})();
