// Notion 연동: 날짜가 있는 일정을 사용자의 Notion 데이터베이스로 보냅니다(앱 → Notion 한쪽 방향).
// - 연결 키(Internal Integration Secret)와 데이터베이스 링크는 이 컴퓨터의 설정 파일에만 저장합니다.
//   (Windows·맥에서는 운영체제 암호화(safeStorage)로 키를 암호화해 둡니다.)
// - 일정마다 Notion 페이지 하나를 만들고, 앱에서 고치면 그 페이지를 고치고, 지우면 Notion 휴지통으로 보냅니다.
// - 어떤 일정이 어떤 페이지인지는 userData/notion-sync.json 에 기록합니다.
const { net, safeStorage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// 캘린더 화면과 같은 마크다운 해석기(renderer/markdown.js)를 그대로 씁니다.
function loadMarkdown() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'renderer', 'markdown.js'), 'utf8'), sandbox);
  return sandbox.window.MD;
}

const STATUS_LABEL = { todo: '시작 전', doing: '진행 중', done: '완료' };
const REPEAT_LABEL = { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' };
// 앱이 데이터베이스에 만들어 두는 열(이미 있으면 그대로 씁니다).
const SCHEMA = {
  '날짜': { date: {} },
  '상태': { select: { options: [{ name: '시작 전', color: 'gray' }, { name: '진행 중', color: 'blue' }, { name: '완료', color: 'green' }] } },
  '폴더': { select: {} },
  '반복': { select: { options: [{ name: '매일', color: 'purple' }, { name: '매주', color: 'purple' }, { name: '매월', color: 'purple' }, { name: '매년', color: 'purple' }] } },
  '즐겨찾기': { checkbox: {} },
  '앱 ID': { rich_text: {} }
};
const TYPE_LABEL = { date: '날짜', select: '선택', checkbox: '체크박스', rich_text: '텍스트' };

const pad = n => String(n).padStart(2, '0');
const sha = v => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 데이터베이스 링크(또는 ID)에서 32자리 ID를 꺼냅니다.
// 링크 마지막 부분은 "제목-ID" 꼴이라(예: My-DB-0123…), 끝의 32자리만 씁니다.
function parseDatabaseId(input) {
  const last = String(input || '').trim().split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  const m = last.replace(/-/g, '').match(/[0-9a-f]{32}$/i);
  if (!m) return '';
  const id = m[0].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

// "2026-10-13" + "09:30" → 이 컴퓨터 시간대가 붙은 ISO 시각
function isoDateTime(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const off = -new Date(y, m - 1, d, h, mi).getTimezoneOffset();
  const a = Math.abs(off);
  return `${date}T${pad(h)}:${pad(mi)}:00${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function notionDate(item) {
  const endDate = item.endDate || item.startDate;
  if (item.startTime) {
    const start = isoDateTime(item.startDate, item.startTime);
    let end = null;
    if (item.endTime) end = isoDateTime(endDate, item.endTime);
    else if (endDate !== item.startDate) return { start: item.startDate, end: endDate }; // 여러 날 일정은 날짜만
    if (end && new Date(end) <= new Date(start)) end = null;
    return { start, end };
  }
  return { start: item.startDate, end: endDate > item.startDate ? endDate : null };
}

// 마크다운 한 줄 → Notion rich_text (굵게·기울임·취소선·밑줄·코드 유지)
function richText(MD, text) {
  const html = MD.inline(text || '');
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const on = { bold: 0, italic: 0, strikethrough: 0, underline: 0, code: 0 };
  const TAG = { strong: 'bold', em: 'italic', s: 'strikethrough', u: 'underline', code: 'code' };
  const out = [];
  for (const m of html.matchAll(/<(\/?)(strong|em|s|u|code)>|([^<]+)/g)) {
    if (m[2]) { on[TAG[m[2]]] += m[1] ? -1 : 1; continue; }
    const content = decode(m[3]);
    const annotations = Object.fromEntries(Object.entries(on).map(([k, v]) => [k, v > 0]));
    for (let i = 0; i < content.length; i += 2000) out.push({ type: 'text', text: { content: content.slice(i, i + 2000) }, annotations });
  }
  return out;
}

function blocksFromMarkdown(MD, content) {
  const blocks = [];
  for (const b of MD.parse(content || '')) {
    const rt = () => richText(MD, b.text);
    switch (b.type) {
      case 'blank': break;
      case 'heading': { const t = `heading_${Math.min(3, b.level)}`; blocks.push({ type: t, [t]: { rich_text: rt() } }); break; }
      case 'todo': blocks.push({ type: 'to_do', to_do: { rich_text: rt(), checked: !!b.checked } }); break;
      case 'ul': blocks.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt() } }); break;
      case 'ol': blocks.push({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt() } }); break;
      case 'quote': blocks.push({ type: 'quote', quote: { rich_text: rt() } }); break;
      case 'hr': blocks.push({ type: 'divider', divider: {} }); break;
      default: blocks.push({ type: 'paragraph', paragraph: { rich_text: rt() } });
    }
  }
  return blocks;
}

class NotionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function friendlyError(e) {
  if (e instanceof NotionError) {
    if (e.status === 401) return '연결 키가 올바르지 않아요. Notion 통합 화면에서 키를 다시 복사해 주세요.';
    if (e.status === 404 || e.code === 'object_not_found') return '데이터베이스를 찾지 못했어요. 데이터베이스 오른쪽 위 ⋯ → 연결에서 앱 통합을 추가했는지 확인해 주세요.';
    if (e.status === 403) return '이 데이터베이스에 쓸 권한이 없어요. 통합의 기능 설정에서 "콘텐츠 입력/업데이트"를 켜 주세요.';
    return e.message;
  }
  return '인터넷 연결을 확인해 주세요.';
}

function createNotionSync({ userData, loadSettings, saveSettings, loadData, onStatus }) {
  const MD = loadMarkdown();
  const mapFile = path.join(userData, 'notion-sync.json');
  let status = { state: 'off' };
  let timer = null, retryTimer = null, running = false, again = false;

  const setStatus = patch => { status = { ...status, ...patch }; onStatus(status); };

  // ----- 설정(연결 키는 암호화해서 저장) -----
  function config() {
    const n = loadSettings().notion;
    if (!n || !n.databaseId || !n.token) return null;
    let token = n.token;
    if (n.encrypted) {
      try { token = safeStorage.decryptString(Buffer.from(n.token, 'base64')); } catch { return null; }
    }
    return { token, databaseId: n.databaseId, databaseTitle: n.databaseTitle || '' };
  }
  function storeConfig(token, databaseId, databaseTitle) {
    const encrypted = safeStorage.isEncryptionAvailable();
    const stored = encrypted ? safeStorage.encryptString(token).toString('base64') : token;
    saveSettings({ ...loadSettings(), notion: { token: stored, encrypted, databaseId, databaseTitle } });
  }

  function loadMap(databaseId) {
    try {
      const m = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      if (m.databaseId === databaseId && m.items) return m;
    } catch {}
    return { databaseId, items: {} };
  }
  const saveMap = m => fs.writeFileSync(mapFile, JSON.stringify(m, null, 2), 'utf8');

  // ----- Notion API -----
  let lastCall = 0;
  async function api(token, method, url, body) {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCall + 340 - Date.now(); // 초당 3회 제한에 맞춰 천천히
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      const res = await net.fetch(API + url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      if (res.status === 429 && attempt < 5) { await sleep((Number(res.headers.get('retry-after')) || 1) * 1000); continue; }
      if (res.status >= 500 && attempt < 2) { await sleep(1500); continue; }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new NotionError(res.status, json.code, json.message || `Notion 오류 (${res.status})`);
      return json;
    }
  }

  async function getDatabase(token, databaseId) {
    const db = await api(token, 'GET', `/databases/${databaseId}`);
    return { db, title: (db.title || []).map(t => t.plain_text).join('') || '제목 없는 데이터베이스' };
  }

  // 필요한 열이 없으면 만들고, 같은 이름인데 종류가 다르면 알려 줍니다. 제목 열의 이름을 돌려줍니다.
  async function ensureSchema(token, databaseId, db) {
    const props = db.properties || {};
    const titleName = Object.keys(props).find(k => props[k].type === 'title');
    const missing = {};
    for (const [name, def] of Object.entries(SCHEMA)) {
      const type = Object.keys(def)[0];
      if (!props[name]) missing[name] = def;
      else if (props[name].type !== type) throw new NotionError(400, 'schema', `데이터베이스의 '${name}' 열 종류를 '${TYPE_LABEL[type]}'(으)로 바꾸거나 열 이름을 바꿔 주세요.`);
    }
    if (Object.keys(missing).length) await api(token, 'PATCH', `/databases/${databaseId}`, { properties: missing });
    return titleName;
  }

  function pageProperties(item, titleName) {
    const folder = String(item.folder || '').replace(/,/g, ' ').trim();
    return {
      [titleName]: { title: [{ type: 'text', text: { content: String(item.title || '제목 없음').slice(0, 2000) } }] },
      '날짜': { date: notionDate(item) },
      '상태': { select: STATUS_LABEL[item.status] ? { name: STATUS_LABEL[item.status] } : null },
      '폴더': { select: folder ? { name: folder } : null },
      '반복': { select: REPEAT_LABEL[item.repeat] ? { name: REPEAT_LABEL[item.repeat] } : null },
      '즐겨찾기': { checkbox: !!item.favorite },
      '앱 ID': { rich_text: [{ type: 'text', text: { content: String(item.id) } }] }
    };
  }

  async function appendBlocks(token, pageId, blocks) {
    for (let i = 0; i < blocks.length; i += 100) {
      await api(token, 'PATCH', `/blocks/${pageId}/children`, { children: blocks.slice(i, i + 100) });
    }
  }
  async function replaceBody(token, pageId, blocks) {
    let cursor;
    const old = [];
    do {
      const r = await api(token, 'GET', `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
      old.push(...r.results.map(b => b.id));
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);
    for (const id of old) await api(token, 'DELETE', `/blocks/${id}`);
    await appendBlocks(token, pageId, blocks);
  }

  async function createPage(cfg, item, props, blocks) {
    const page = await api(cfg.token, 'POST', '/pages', {
      parent: { database_id: cfg.databaseId }, properties: props, children: blocks.slice(0, 100)
    });
    await appendBlocks(cfg.token, page.id, blocks.slice(100));
    return page.id;
  }

  async function syncOnce() {
    const cfg = config();
    if (!cfg) { setStatus({ state: 'off' }); return; }
    setStatus({ state: 'syncing', databaseTitle: cfg.databaseTitle });
    const { db } = await getDatabase(cfg.token, cfg.databaseId);
    const titleName = await ensureSchema(cfg.token, cfg.databaseId, db);

    const map = loadMap(cfg.databaseId);
    const dated = (loadData().items || []).filter(x => x.startDate);
    const keep = new Set();
    for (const item of dated) {
      keep.add(item.id);
      const props = pageProperties(item, titleName);
      const blocks = blocksFromMarkdown(MD, item.content);
      const propsHash = sha(props), bodyHash = sha(blocks);
      const entry = map.items[item.id];
      if (entry && entry.propsHash === propsHash && entry.bodyHash === bodyHash) continue;
      try {
        if (!entry) {
          map.items[item.id] = { pageId: await createPage(cfg, item, props, blocks), propsHash, bodyHash };
        } else {
          if (entry.propsHash !== propsHash) await api(cfg.token, 'PATCH', `/pages/${entry.pageId}`, { properties: props });
          if (entry.bodyHash !== bodyHash) await replaceBody(cfg.token, entry.pageId, blocks);
          map.items[item.id] = { ...entry, propsHash, bodyHash };
        }
      } catch (e) {
        // Notion 에서 페이지를 직접 지웠으면 새로 만듭니다.
        if (entry && e instanceof NotionError && (e.status === 404 || /archived/i.test(e.message))) {
          map.items[item.id] = { pageId: await createPage(cfg, item, props, blocks), propsHash, bodyHash };
        } else throw e;
      }
      saveMap(map);
    }
    // 앱에서 지웠거나 날짜를 뺀 일정은 Notion 휴지통으로 보냅니다.
    for (const [id, entry] of Object.entries(map.items)) {
      if (keep.has(id)) continue;
      try { await api(cfg.token, 'PATCH', `/pages/${entry.pageId}`, { archived: true }); }
      catch (e) { if (!(e instanceof NotionError && (e.status === 404 || /archived/i.test(e.message)))) throw e; }
      delete map.items[id];
      saveMap(map);
    }
    setStatus({ state: 'ok', lastSync: Date.now(), count: dated.length, message: '' });
  }

  async function run() {
    if (running) { again = true; return; }
    running = true;
    clearTimeout(retryTimer);
    try {
      do { again = false; await syncOnce(); } while (again);
    } catch (e) {
      console.error('notion sync error:', e);
      setStatus({ state: 'error', message: friendlyError(e) });
      retryTimer = setTimeout(schedule, 5 * 60 * 1000); // 5분 뒤 다시 시도
    } finally {
      running = false;
    }
  }
  function schedule(delay = 1500) {
    if (!config()) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  async function connect(token, databaseInput) {
    token = String(token || '').trim();
    const databaseId = parseDatabaseId(databaseInput);
    if (!token) return { ...status, state: 'off', message: '연결 키를 붙여 넣어 주세요.' };
    if (!databaseId) return { ...status, state: 'off', message: '데이터베이스 링크를 확인해 주세요. Notion 에서 데이터베이스를 열고 "링크 복사"한 주소를 붙여 넣으면 돼요.' };
    try {
      const { db, title } = await getDatabase(token, databaseId);
      await ensureSchema(token, databaseId, db);
      storeConfig(token, databaseId, title);
      setStatus({ state: 'syncing', databaseTitle: title, message: '' });
      schedule(0);
      return status;
    } catch (e) {
      return { ...status, state: 'off', message: friendlyError(e) };
    }
  }
  function disconnect() {
    const s = loadSettings();
    delete s.notion;
    saveSettings(s);
    try { fs.unlinkSync(mapFile); } catch {}
    clearTimeout(timer); clearTimeout(retryTimer);
    setStatus({ state: 'off', message: '', lastSync: null, databaseTitle: '' });
    return status;
  }
  function getStatus() {
    const cfg = config();
    if (!cfg) return { state: 'off' };
    return { ...status, state: status.state === 'off' ? 'idle' : status.state, databaseTitle: cfg.databaseTitle };
  }

  return { schedule, connect, disconnect, getStatus, syncNow: () => { schedule(0); return getStatus(); } };
}

module.exports = { createNotionSync, parseDatabaseId, notionDate, blocksFromMarkdown, richText, loadMarkdown };
