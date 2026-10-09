// 진행 상태: 일정 · 메모에 선택해서 다는 태그. 값이 없으면 아무 표시도 하지 않습니다.
(function(){
  const STATUSES=[
    {id:'todo',label:'시작 전'},
    {id:'doing',label:'진행 중'},
    {id:'done',label:'완료'}
  ];
  const find=id=>STATUSES.find(s=>s.id===id)||null;
  // 메모 카드 · 사이드 메모에 붙는 작은 태그 HTML (상태가 없으면 빈 문자열)
  function tag(id){
    const s=find(id);
    return s?`<span class="status-tag ${s.id}"><i></i>${s.label}</span>`:'';
  }
  window.ItemStatus={STATUSES,find,tag};
})();
