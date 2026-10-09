// 테마: <html data-theme="..."> 로 common.css / calendar.css 의 테마 토큰을 바꿉니다.
// 설정(settings.json)에는 theme(테마 id)와 themeColors(그라데이션 테마의 사용자 색)를 저장합니다.
(function(){
  const THEMES=[
    {id:'basic',name:'기본',desc:'깔끔한 흰색'},
    {id:'gradient',name:'그라데이션',desc:'은은한 3색 · 색 바꾸기 가능'},
    {id:'mint',name:'민트 피아노',desc:'민트 · 브라운 · 화이트'},
    {id:'y2k',name:'Y2K 윈도우',desc:'하늘색 · 클로버 · 반짝 버튼'}
  ];
  const DEFAULT_THEME='gradient';
  const GRADIENT_DEFAULT={bg1:'#FDECE9',bg2:'#F5EDFA',bg3:'#E9F2FC',accent:'#E0577B'};
  const HEX=/^#[0-9a-fA-F]{6}$/;
  const rgbTriplet=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(' ');

  function themeId(settings){
    const id=settings&&settings.theme;
    return THEMES.some(t=>t.id===id)?id:DEFAULT_THEME;
  }
  function gradientColors(settings){
    const saved=(settings&&settings.themeColors)||{};
    const out={...GRADIENT_DEFAULT};
    for(const k of Object.keys(out))if(HEX.test(saved[k]||''))out[k]=saved[k].toUpperCase();
    return out;
  }
  function apply(settings){
    const root=document.documentElement,id=themeId(settings);
    root.dataset.theme=id;
    ['--theme-bg-1','--theme-bg-2','--theme-bg-3','--accent'].forEach(p=>root.style.removeProperty(p));
    if(id==='gradient'){
      const c=gradientColors(settings);
      root.style.setProperty('--theme-bg-1',rgbTriplet(c.bg1));
      root.style.setProperty('--theme-bg-2',rgbTriplet(c.bg2));
      root.style.setProperty('--theme-bg-3',rgbTriplet(c.bg3));
      root.style.setProperty('--accent',c.accent);
    }
    return id;
  }
  window.Theme={THEMES,DEFAULT_THEME,GRADIENT_DEFAULT,themeId,gradientColors,apply};
})();
