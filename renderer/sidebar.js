let data={items:[]};
let activeId=null;

const $=id=>document.getElementById(id);

async function init(){
  const settings=await window.desktopAPI.getSettings();
  Theme.apply(settings);
  document.body.classList.toggle('side-left', settings.sidebarSide==='left');
  data=await window.desktopAPI.getData();
  render();
  await window.desktopAPI.setSidebarExpanded(false);
}

function pinnedItems(){
  return (data.items||[]).filter(x=>x.pinned);
}

function render(){
  const rail=$('tabRail');
  rail.innerHTML='';
  pinnedItems().forEach(item=>{
    const b=document.createElement('button');
    b.className='tab'+(activeId===item.id?' active':'');
    const tabColor=item.color||'#EAF3FF';
    b.style.setProperty('--tab-color',tabColor);
    b.innerHTML='<span class="tab-dot"></span><span class="tab-label"></span>';
    b.querySelector('.tab-label').textContent=item.title||'메모';
    b.title=item.title||'메모';
    b.addEventListener('click', async e=>{
      e.preventDefault();
      e.stopPropagation();
      if(activeId===item.id){
        activeId=null;
        $('panel').classList.add('hidden');
        await window.desktopAPI.setSidebarExpanded(false);
      }else{
        activeId=item.id;
        $('panel').classList.remove('hidden');
        await window.desktopAPI.setSidebarExpanded(true);
      }
      render();
      renderPanel();
    });
    rail.appendChild(b);
  });
  renderPanel();
}

const pad=n=>String(n).padStart(2,'0');
function formatDate(k){const [y,m,d]=k.split('-').map(Number);return `${m}월 ${d}일`}
function formatUpdated(ts){
  if(!ts)return '';
  const d=new Date(ts),now=new Date();
  const sameDay=d.toDateString()===now.toDateString();
  return (sameDay?`오늘 ${pad(d.getHours())}:${pad(d.getMinutes())}`:`${d.getMonth()+1}월 ${d.getDate()}일`)+' 수정';
}
function chip(icon,text,cls=''){return `<span class="chip ${cls}"><svg class="icon"><use href="#${icon}"/></svg>${MD.escapeHtml(text)}</span>`}

function renderPanel(){
  const x=(data.items||[]).find(i=>i.id===activeId && i.pinned);
  if(!x){
    $('panel').classList.add('hidden');
    return;
  }
  $('panelTitle').textContent=x.title||'메모';
  $('panel').style.setProperty('--panel-color',x.color||'#DCEBFF');

  const meta=[];
  if(x.startDate){
    const end=x.endDate&&x.endDate!==x.startDate?` ~ ${formatDate(x.endDate)}`:'';
    meta.push(chip('i-cal',formatDate(x.startDate)+end));
  }
  if(x.startTime)meta.push(chip('i-clock',x.startTime+(x.endTime?` – ${x.endTime}`:'')));
  const todos=MD.parse(x.content||'').filter(b=>b.type==='todo');
  const done=todos.filter(b=>b.checked).length;
  if(todos.length)meta.push(chip('i-check',`${done}/${todos.length}`,done===todos.length?'done':''));
  const st=ItemStatus.tag(x.status);
  if(st)meta.unshift(st);
  $('panelMeta').innerHTML=meta.join('');
  $('panelProgress').classList.toggle('hidden',!todos.length);
  $('panelProgress').style.setProperty('--p',todos.length?`${done/todos.length*100}%`:'0%');

  $('panelContent').innerHTML=MD.toHtml(x.content||'',{interactive:true});
  $('panelUpdated').textContent=formatUpdated(x.updatedAt);
}

$('panelContent').addEventListener('change',async e=>{
  if(!e.target.matches('input[data-line]')||!activeId)return;
  const item=data.items.find(i=>i.id===activeId);if(!item)return;
  item.content=MD.toggleTodo(item.content,Number(e.target.dataset.line),e.target.checked);
  item.updatedAt=Date.now();
  await window.desktopAPI.saveData(data);
});

$('closePanel').onclick=async()=>{
  activeId=null;
  $('panel').classList.add('hidden');
  await window.desktopAPI.setSidebarExpanded(false);
  render();
};

$('editBtn').onclick=()=>{
  if(activeId) window.desktopAPI.openCalendar(activeId);
};

$('unpinBtn').onclick=async()=>{
  const x=(data.items||[]).find(i=>i.id===activeId);
  if(!x)return;
  x.pinned=false;
  await window.desktopAPI.saveData(data);
  activeId=null;
  $('panel').classList.add('hidden');
  await window.desktopAPI.setSidebarExpanded(false);
  render();
};

window.desktopAPI.onDataChanged(d=>{
  data=d;
  if(activeId && !data.items.some(i=>i.id===activeId && i.pinned)) activeId=null;
  render();
});

init();
window.desktopAPI.onSidebarPositionChanged(side=>{document.body.classList.toggle('side-left',side==='left')});
window.desktopAPI.onSettingsChanged?.(s=>Theme.apply(s));
