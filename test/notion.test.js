// Notion 연동 테스트: 가짜 Notion API 로 앱 → Notion 동기화가 맞게 되는지 확인합니다.
//   node test/notion.test.js
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ----- 가짜 Notion -----
// 앱이 권하는 열을 모두 갖춘 데이터베이스
const db = { id: '0123456789abcdef0123456789abcdef', title: [{ plain_text: '내 일정' }], properties: {
  '이름': { type: 'title' }, '날짜': { type: 'date' }, '상태': { type: 'select' }, '폴더': { type: 'select' },
  '반복': { type: 'select' }, '즐겨찾기': { type: 'checkbox' }, '앱 ID': { type: 'rich_text' } } };
// 이미 쓰던 업무 데이터베이스: 제목 열 이름이 다르고 '상태'가 상태(status) 종류, 다른 열은 없음
const workDb = { id: 'fedcba9876543210fedcba9876543210', title: [{ plain_text: '업무회고록' }], properties: {
  '내용': { type: 'title' }, '날짜': { type: 'date' }, '프로젝트': { type: 'select' },
  '상태': { type: 'status', status: { options: ['일정', '시작 전', '진행 중', '완료'].map(name => ({ name })) } } } };
// 빈 데이터베이스(제목 열만)
const blankDb = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', title: [{ plain_text: '빈 표' }], properties: { 'Name': { type: 'title' } } };
const dbs = Object.fromEntries([db, workDb, blankDb].map(d => [d.id, d]));
const pages = {}; // id → { properties, children:[{id,...}], archived }
const calls = [];
let nextId = 1;
const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body });
async function fakeFetch(url, opts) {
  const u = url.replace('https://api.notion.com/v1', '');
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push(`${opts.method} ${u.split('?')[0]}`);
  if (opts.headers.Authorization !== 'Bearer ntn_good') return json(401, { code: 'unauthorized', message: 'API token is invalid.' });
  let m;
  if ((m = u.match(/^\/databases\/([\w-]+)$/))) {
    const d = dbs[m[1].replace(/-/g, '')];
    if (!d) return json(404, { code: 'object_not_found', message: 'not found' });
    if (opts.method === 'PATCH') for (const [k, v] of Object.entries(body.properties)) d.properties[k] = { type: Object.keys(v)[0] };
    return json(200, d);
  }
  if (u === '/pages' && opts.method === 'POST') {
    const id = `page-${nextId++}`;
    pages[id] = { parent: body.parent.database_id.replace(/-/g, ''), properties: body.properties, children: body.children.map(c => ({ id: `b${nextId++}`, ...c })), archived: false };
    return json(200, { id });
  }
  if ((m = u.match(/^\/pages\/([\w-]+)$/))) {
    const p = pages[m[1]];
    if (!p || p.gone) return json(404, { code: 'object_not_found', message: 'not found' });
    if (body.archived) p.archived = true;
    if (body.properties) p.properties = body.properties;
    return json(200, { id: m[1] });
  }
  if ((m = u.match(/^\/blocks\/([\w-]+)\/children/))) {
    const p = pages[m[1]];
    if (opts.method === 'GET') return json(200, { results: p.children.map(c => ({ id: c.id })), has_more: false });
    p.children.push(...body.children.map(c => ({ id: `b${nextId++}`, ...c })));
    return json(200, {});
  }
  if ((m = u.match(/^\/blocks\/([\w-]+)$/)) && opts.method === 'DELETE') {
    for (const p of Object.values(pages)) p.children = p.children.filter(c => c.id !== m[1]);
    return json(200, {});
  }
  return json(400, { message: `unexpected ${opts.method} ${u}` });
}

// electron 모듈을 가짜로 바꿉니다.
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { net: { fetch: fakeFetch }, safeStorage: { isEncryptionAvailable: () => false } };
  return origLoad.call(this, req, ...rest);
};
const { createNotionSync, notionDate, parseDatabaseId, friendlyError } = require('../notion-sync');

const results = [];
const check = (n, g, e) => { const ok = JSON.stringify(g) === JSON.stringify(e); results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : `\n  got: ${JSON.stringify(g)}\n  exp: ${JSON.stringify(e)}`)); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-notion-'));
  let settings = {};
  let data = { items: [
    { id: 'a', title: '팀 회의', startDate: '2026-10-14', endDate: '2026-10-14', startTime: '14:00', endTime: '15:00', status: 'doing', folder: '업무', repeat: 'weekly', favorite: true, content: '# 안건\n- [x] **회의록** 준비\n- 우유' },
    { id: 'b', title: '여행', startDate: '2026-10-20', endDate: '2026-10-22', content: '' },
    { id: 'c', title: '날짜 없는 메모', startDate: '', content: '보내지 않음' }
  ] };
  let status = {}, waiters = [];
  const sync = createNotionSync({
    userData: dir, loadSettings: () => settings, saveSettings: s => { settings = JSON.parse(JSON.stringify(s)); }, loadData: () => data,
    onStatus: st => { status = st; if (st.state === 'ok' || st.state === 'error') waiters.splice(0).forEach(r => r(st)); }
  });
  const synced = () => new Promise(r => waiters.push(r));
  const pageOf = id => Object.values(pages).find(p => p.properties['앱 ID'].rich_text[0].text.content === id && !p.archived && !p.gone);

  // 잘못된 입력
  check('bad link', (await sync.connect('ntn_good', 'https://www.notion.so/abc')).message.startsWith('데이터베이스 링크'), true);
  check('bad token', (await sync.connect('ntn_bad', `https://www.notion.so/ws/${db.id}?v=1`)).message.startsWith('연결 키가'), true);
  check('db not shared', (await sync.connect('ntn_good', 'https://www.notion.so/ws/ffffffffffffffffffffffffffffffff')).message.startsWith('데이터베이스를 찾지'), true);

  // 연결 → 열 만들기 + 날짜 있는 일정만 보내기
  check('link parsing', ['https://www.notion.so/ws/My-DB-' + db.id + '?v=1', db.id, 'https://app.notion.com/p/ws/' + db.id + '?pvs=106', '01234567-89ab-cdef-0123-456789abcdef'].map(parseDatabaseId),
    Array(4).fill('01234567-89ab-cdef-0123-456789abcdef'));
  let done = synced();
  const conn = await sync.connect('ntn_good', `https://www.notion.so/ws/My-DB-${db.id}?v=999`);
  check('connect ok', [conn.state, conn.message || ''], ['syncing', '']);
  if (conn.state !== 'syncing') process.exit(1);
  await done;
  check('schema unchanged when columns exist', Object.keys(db.properties).length, 7);
  check('settings saved', !!settings.notion.token, true);
  check('only dated items', Object.values(pages).length, 2);
  const a = pageOf('a');
  check('title', a.properties['이름'].title[0].text.content, '팀 회의');
  check('status/folder/repeat/fav', [a.properties['상태'].select.name, a.properties['폴더'].select.name, a.properties['반복'].select.name, a.properties['즐겨찾기'].checkbox], ['진행 중', '업무', '매주', true]);
  check('date with time', /^2026-10-14T14:00:00[+-]\d\d:\d\d$/.test(a.properties['날짜'].date.start) && /^2026-10-14T15:00:00/.test(a.properties['날짜'].date.end), true);
  check('multi-day date', pageOf('b').properties['날짜'].date, { start: '2026-10-20', end: '2026-10-22' });
  check('body blocks', a.children.map(c => c.type), ['heading_1', 'to_do', 'bulleted_list_item']);
  check('todo checked + bold', [a.children[1].to_do.checked, a.children[1].to_do.rich_text[0].annotations.bold, a.children[1].to_do.rich_text[0].text.content], [true, true, '회의록']);
  check('status ok', [status.state, status.count, status.databaseTitle], ['ok', 2, '내 일정']);

  // 아무것도 안 바뀌면 쓰지 않음
  calls.length = 0; done = synced(); sync.syncNow(); await done;
  check('no change → no writes', calls.filter(c => !c.startsWith('GET')).length, 0);

  // 제목만 바꾸면 속성만 고침
  data.items[0].title = '팀 회의 (변경)';
  calls.length = 0; done = synced(); sync.schedule(0); await done;
  check('title edit → props only', calls.filter(c => !c.startsWith('GET')), ['PATCH /pages/' + Object.keys(pages).find(k => pages[k] === a)]);
  check('title updated', a.properties['이름'].title[0].text.content, '팀 회의 (변경)');

  // 내용 바꾸면 본문 교체
  data.items[0].content = '- [ ] 새 할 일';
  done = synced(); sync.schedule(0); await done;
  check('body replaced', a.children.map(c => [c.type, c.to_do?.checked]), [['to_do', false]]);

  // 날짜 빼면 휴지통
  data.items[1].startDate = ''; data.items[1].endDate = '';
  done = synced(); sync.schedule(0); await done;
  check('undated → archived', Object.values(pages).filter(p => p.archived).length, 1);

  // Notion 에서 직접 지운 페이지는 다시 만듦
  a.gone = true; data.items[0].title = '다시 만들기';
  done = synced(); sync.schedule(0); await done;
  check('recreated after manual delete', pageOf('a')?.properties['이름'].title[0].text.content, '다시 만들기');

  // 연결 끊기
  check('disconnect', [sync.disconnect().state, settings.notion], ['off', undefined]);

  // 이미 쓰던 업무 데이터베이스: 열을 새로 만들지 않고, 상태(status) 열에 맞춰 넣음
  const workSettings = {};
  const work = createNotionSync({
    userData: fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-notion-')), loadSettings: () => workSettings.v || {}, saveSettings: s => { workSettings.v = JSON.parse(JSON.stringify(s)); },
    loadData: () => ({ items: [
      { id: 'w1', title: '보고서 마감', startDate: '2026-10-15', status: 'doing', folder: '업무', favorite: true, content: '' },
      { id: 'w2', title: '상태 없는 일정', startDate: '2026-10-16', content: '' }
    ] }),
    onStatus: st => { if (st.state === 'ok' || st.state === 'error') waiters.splice(0).forEach(r => r(st)); }
  });
  done = synced();
  check('work db: connect', (await work.connect('ntn_good', `https://app.notion.com/p/ws/${workDb.id}?v=1`)).state, 'syncing');
  check('work db: synced', (await done).state, 'ok');
  check('work db: no new columns', Object.keys(workDb.properties).sort(), ['내용', '날짜', '상태', '프로젝트'].sort());
  const workPages = Object.values(pages).filter(p => p.parent === workDb.id);
  check('work db: title/date/status', [workPages[0].properties['내용'].title[0].text.content, workPages[0].properties['날짜'].date.start, workPages[0].properties['상태']], ['보고서 마감', '2026-10-15', { status: { name: '진행 중' } }]);
  check('work db: no status → left to Notion default', workPages[1].properties['상태'], undefined);
  check('work db: only existing columns written', Object.keys(workPages[0].properties).sort(), ['내용', '날짜', '상태'].sort());

  // 빈 데이터베이스: 날짜 열만 만들어서 씀
  const blankSettings = {};
  const blank = createNotionSync({
    userData: fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-notion-')), loadSettings: () => blankSettings.v || {}, saveSettings: s => { blankSettings.v = JSON.parse(JSON.stringify(s)); },
    loadData: () => ({ items: [{ id: 'x', title: '하나', startDate: '2026-10-17', content: '' }] }),
    onStatus: st => { if (st.state === 'ok' || st.state === 'error') waiters.splice(0).forEach(r => r(st)); }
  });
  done = synced(); await blank.connect('ntn_good', blankDb.id); await done;
  check('blank db: only date column added', Object.keys(blankDb.properties).sort(), ['Name', '날짜'].sort());
  check('blank db: page written', Object.values(pages).filter(p => p.parent === blankDb.id).map(p => [p.properties.Name.title[0].text.content, p.properties['날짜'].date.start]), [['하나', '2026-10-17']]);

  // 접속 실패 문구: 원인별로 구분
  const netErr = c => Object.assign(new TypeError('fetch failed'), { cause: new Error(`net::${c}`) });
  check('offline message', friendlyError(netErr('ERR_INTERNET_DISCONNECTED')).startsWith('인터넷에 연결되어 있지 않은'), true);
  check('blocked message', friendlyError(netErr('ERR_CONNECTION_RESET')).includes('막고 있을 수 있어요. 다른 네트워크') && friendlyError(netErr('ERR_CONNECTION_RESET')).endsWith('(ERR_CONNECTION_RESET)'), true);
  check('code bug not shown as network', friendlyError(new TypeError('x is undefined')), 'Notion 으로 보내는 중 문제가 생겼어요. (x is undefined)');

  // 날짜 변환 단독
  check('end before start dropped', notionDate({ startDate: '2026-01-01', startTime: '10:00', endTime: '09:00' }).end, null);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
