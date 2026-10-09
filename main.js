const { app, BrowserWindow, ipcMain, Notification, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let calendarWindow = null;
let sidebarWindow = null;
let sidebarOpen = false;
let memoResizeInProgress = false;
let calendarPinned = false;
let calendarBaseWidth = 1120;
let calendarBaseHeight = 760;
let manualResize = null;
const IS_MAC = process.platform === 'darwin';
const RELEASES_URL = 'https://github.com/boriboris2al/desktop-calendar-memo/releases/latest';

function dataFile() {
  return path.join(app.getPath('userData'), 'data.json');
}

const initialData = {
  items: [{
    id: 'welcome',
    title: '사용법',
    content: '# 캘린더 + 메모\n\n- [ ] 날짜를 넣으면 캘린더와 연결됩니다\n- [ ] 날짜가 없으면 일반 메모로 남습니다\n- [ ] 사이드 고정을 켜면 오른쪽 탭에서 바로 볼 수 있습니다.',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    reminderMinutes: null,
    repeat: 'none',
    pinned: false,
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }]
};

function loadData() {
  try {
    if (!fs.existsSync(dataFile())) {
      fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
      fs.writeFileSync(dataFile(), JSON.stringify(initialData, null, 2), 'utf8');
    }
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch (e) {
    console.error('data load error:', e);
    return { items: [] };
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2), 'utf8');
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try {
    if (!fs.existsSync(settingsFile())) return {};
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch { return {}; }
}
function saveSettings(settings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
}
function saveWindowState() {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;
  const b = calendarWindow.getBounds();
  const settings = loadSettings();
  settings.calendarPinned = calendarPinned;
  settings.calendarBaseWidth = calendarBaseWidth;
  settings.calendarBaseHeight = calendarBaseHeight;
  settings.calendarBounds = b;
  saveSettings(settings);
}
function memoOpenState() {
  return calendarWindow && !calendarWindow.isDestroyed() &&
    calendarWindow.getSize()[0] > calendarBaseWidth + 100;
}

function displayForBounds(bounds) {
  try { return screen.getDisplayMatching(bounds || calendarWindow?.getBounds() || screen.getPrimaryDisplay().bounds); }
  catch { return screen.getPrimaryDisplay(); }
}
function area(bounds) {
  return displayForBounds(bounds).workArea;
}

function placeCalendar(memoOpen = false) {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;
  const bounds = calendarWindow.getBounds();
  const a = area(bounds);
  const extra = memoOpen ? 390 : 0;
  const maxWidthFromX = Math.max(760, a.x + a.width - bounds.x);
  const width = Math.min(calendarBaseWidth + extra, a.width - 10, maxWidthFromX);
  const height = Math.min(calendarBaseHeight, a.height - 10);
  // 현재 창의 X/Y는 유지합니다. 다른 모니터로 되돌리지 않습니다.
  const x = bounds.x;
  const y = Math.max(a.y, Math.min(bounds.y, a.y + a.height - height));
  memoResizeInProgress = true;
  calendarWindow.setBounds({ x, y, width, height });
  setTimeout(() => { memoResizeInProgress = false; }, 100);
}

function createCalendar() {
  const settings = loadSettings();
  calendarPinned = !!settings.calendarPinned;
  calendarBaseWidth = settings.calendarBaseWidth || 1120;
  calendarBaseHeight = settings.calendarBaseHeight || 760;

  calendarWindow = new BrowserWindow({
    width: calendarBaseWidth,
    height: calendarBaseHeight,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'assets', 'calendar-icon.ico'),
    resizable: true,
    movable: !calendarPinned,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  calendarWindow.loadFile(path.join(__dirname, 'renderer', 'calendar.html'));

  calendarWindow.once('ready-to-show', () => {
    const settings = loadSettings();
    const b = settings.calendarBounds;
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
      const a = area(b);
      const w = Math.max(760, Math.min(b.width || calendarBaseWidth, a.width - 10, a.x + a.width - b.x));
      const h = Math.max(560, Math.min(b.height || calendarBaseHeight, a.height - 10));
      calendarWindow.setBounds({ x: b.x, y: Math.max(a.y, Math.min(b.y, a.y + a.height - h)), width: w, height: h });
    } else {
      placeCalendar(false);
    }
    calendarWindow.show();
    calendarWindow.focus();
    calendarWindow.setMovable(!calendarPinned);
  });

  calendarWindow.on('moved', () => saveWindowState());
  calendarWindow.on('resize', () => {
    if (!calendarWindow || calendarWindow.isDestroyed() || memoResizeInProgress) return;
    const b = calendarWindow.getBounds();
    calendarBaseWidth = Math.max(760, b.width - (memoOpenState() ? 390 : 0));
    calendarBaseHeight = b.height;
    saveWindowState();
  });

  calendarWindow.on('closed', () => {
    calendarWindow = null;
    if (sidebarWindow && !sidebarWindow.isDestroyed()) sidebarWindow.close();
    app.quit();
  });
}

function getSidebarDisplayAndSide() {
  const settings = loadSettings();
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const savedId = settings.sidebarDisplayId;
  const display = displays.find(d => String(d.id) === String(savedId)) || primary;
  const side = settings.sidebarSide === 'left' ? 'left' : 'right';
  return { display, side };
}

function getSidebarPositions() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const ordered = [primary, ...displays.filter(d => d.id !== primary.id)];
  return ordered.flatMap((d, index) => [
    { id: String(d.id), side: 'left', label: `${index === 0 ? '기본' : '보조'} 모니터 - 왼쪽`, bounds: d.workArea },
    { id: String(d.id), side: 'right', label: `${index === 0 ? '기본' : '보조'} 모니터 - 오른쪽`, bounds: d.workArea }
  ]);
}

function placeSidebar(expanded) {
  if (!sidebarWindow || sidebarWindow.isDestroyed()) return;
  const { display, side } = getSidebarDisplayAndSide();
  const a = display.workArea;
  const pinnedCount = loadData().items.filter(x => x.pinned).length;
  const width = expanded ? 390 : 58;
  const tabHeight = 102; // renderer/sidebar.css .tab 높이(96px) + 여백
  const gap = 6;
  const collapsedHeight = Math.max(72, pinnedCount * tabHeight + Math.max(0, pinnedCount - 1) * gap + 16);
  const height = expanded ? Math.min(640, Math.max(420, a.height - 100)) : Math.min(a.height - 20, collapsedHeight);
  const y = a.y + Math.round((a.height - height) / 2);
  const x = side === 'left' ? a.x : a.x + a.width - width;
  sidebarWindow.setBounds({ x, y, width, height });
}

function createSidebar() {
  if (sidebarWindow && !sidebarWindow.isDestroyed()) return;

  sidebarWindow = new BrowserWindow({
    width: 72,
    height: 170,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  sidebarWindow.setAlwaysOnTop(true, 'floating');
  // 맥: 데스크톱(Spaces)을 옮겨도, 전체 화면 앱 위에서도 사이드 탭이 보이게 합니다.
  if (IS_MAC) sidebarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  sidebarWindow.loadFile(path.join(__dirname, 'renderer', 'sidebar.html'));

  sidebarWindow.once('ready-to-show', () => {
    placeSidebar(false);
    const d = loadData();
    if ((d.items || []).some(x => x.pinned)) {
      sidebarWindow.showInactive();
    }
  });

  sidebarWindow.on('closed', () => {
    sidebarWindow = null;
  });
}

function broadcast(channel, payload) {
  for (const win of [calendarWindow, sidebarWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

ipcMain.handle('data:get', () => loadData());

ipcMain.handle('data:save', (_, data) => {
  saveData(data);
  broadcast('data:changed', data);

  // 고정 메모가 하나라도 있으면 오른쪽 탭을 항상 표시한다.
  const hasPinned = (data.items || []).some(x => x.pinned);
  if (!sidebarWindow || sidebarWindow.isDestroyed()) {
    if (hasPinned) createSidebar();
  }
  if (sidebarWindow && !sidebarWindow.isDestroyed()) {
    if (hasPinned) {
      if (!sidebarOpen) placeSidebar(false); else placeSidebar(true);
      sidebarWindow.showInactive();
      sidebarWindow.setAlwaysOnTop(true, 'floating');
    } else {
      sidebarOpen = false;
      sidebarWindow.hide();
    }
  }
  return true;
});

ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('sidebar:getPositions', () => getSidebarPositions());
ipcMain.handle('sidebar:getSide', () => loadSettings().sidebarSide === 'left' ? 'left' : 'right');

ipcMain.handle('sidebar:setPosition', (_, displayId, side) => {
  const positions = getSidebarPositions();
  const match = positions.find(p => p.id === String(displayId) && p.side === side);
  if (!match) return loadSettings();
  const settings = { ...loadSettings(), sidebarDisplayId: String(displayId), sidebarSide: side };
  saveSettings(settings);
  if (sidebarWindow && !sidebarWindow.isDestroyed()) {
    placeSidebar(sidebarOpen);
    sidebarWindow.webContents.send('sidebar:position', side);
    sidebarWindow.setAlwaysOnTop(true, 'floating');
    if (loadData().items.some(x => x.pinned)) sidebarWindow.showInactive();
  }
  return settings;
});

ipcMain.handle('settings:save', (_, patch) => {
  const settings = { ...loadSettings(), ...patch };
  saveSettings(settings);
  broadcast('settings:changed', settings); // 테마 등 설정을 사이드 메모에도 바로 반영
  return settings;
});

ipcMain.handle('window:getBounds', () => {
  if (!calendarWindow || calendarWindow.isDestroyed()) return null;
  return calendarWindow.getBounds();
});
ipcMain.handle('window:setBounds', (_, bounds) => {
  if (!calendarWindow || calendarWindow.isDestroyed()) return null;
  const current = calendarWindow.getBounds();
  const a = area(current);
  const minW = 760, minH = 560;
  let {x,y,width,height} = current;
  if (Number.isFinite(bounds?.x)) x = Math.round(bounds.x);
  if (Number.isFinite(bounds?.y)) y = Math.round(bounds.y);
  if (Number.isFinite(bounds?.width)) width = Math.max(minW, Math.round(bounds.width));
  if (Number.isFinite(bounds?.height)) height = Math.max(minH, Math.round(bounds.height));
  width = Math.min(width, Math.max(minW, a.x + a.width - x));
  height = Math.min(height, a.height - 10);
  // 리사이즈 중에는 사용자가 잡은 X/Y를 그대로 유지합니다.
  y = Math.max(a.y, Math.min(y, a.y + a.height - height));
  memoResizeInProgress = true;
  calendarWindow.setBounds({x,y,width,height});
  setTimeout(() => { memoResizeInProgress = false; }, 20);
  const base = memoOpenState() ? Math.max(760, width - 390) : width;
  calendarBaseWidth = base;
  calendarBaseHeight = height;
  saveWindowState();
  return {x,y,width,height};
});

ipcMain.handle('calendar:setMemoList', (_, open) => {
  if (calendarWindow && !calendarWindow.isDestroyed()) {
    placeCalendar(Boolean(open));
    saveWindowState();
  }
  return true;
});

ipcMain.handle('calendar:setPinned', (_, pinned) => {
  calendarPinned = Boolean(pinned);
  if (calendarWindow && !calendarWindow.isDestroyed()) {
    calendarWindow.setMovable(!calendarPinned);
    saveWindowState();
  }
  return calendarPinned;
});

ipcMain.handle('sidebar:setExpanded', (_, expanded) => {
  sidebarOpen = Boolean(expanded);
  if (!sidebarWindow || sidebarWindow.isDestroyed()) createSidebar();

  if (sidebarWindow && !sidebarWindow.isDestroyed()) {
    placeSidebar(sidebarOpen);
    sidebarWindow.setAlwaysOnTop(true, 'floating');
    sidebarWindow.show();
    if (!sidebarOpen) {
      // 닫기는 팝업만 접고, 오른쪽의 작은 탭은 계속 남긴다.
      sidebarWindow.showInactive();
    }
  }
  return sidebarOpen;
});

ipcMain.handle('calendar:open', (_, id = null) => {
  if (!calendarWindow || calendarWindow.isDestroyed()) {
    createCalendar();
  } else {
    calendarWindow.show();
    calendarWindow.focus();
  }
  if (id) {
    setTimeout(() => {
      if (calendarWindow && !calendarWindow.isDestroyed()) {
        calendarWindow.webContents.send('calendar:edit', id);
      }
    }, 150);
  }
});

ipcMain.handle('window:close', (_, which) => {
  if (which === 'sidebar') {
    if (sidebarWindow && !sidebarWindow.isDestroyed()) sidebarWindow.hide();
    return;
  }
  app.quit();
});

ipcMain.handle('window:minimize', () => {
  if (calendarWindow && !calendarWindow.isDestroyed()) calendarWindow.minimize();
});

ipcMain.handle('notify:test', (_, title, body) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// ===== 자동 업데이트 =====
// GitHub Releases 에 새 버전이 올라오면 백그라운드로 내려받고, 다 받으면 알려 줍니다.
// 설치된 앱(app.isPackaged)에서만 동작하며, 개발 중(run.bat)에는 꺼져 있습니다.
let updateState = { state: 'idle', version: app.getVersion() };
let autoUpdater = null;

function sendUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  broadcast('update:status', updateState);
}

function releaseNotesText(notes) {
  if (!notes) return '';
  if (Array.isArray(notes)) return notes.map(n => `v${n.version}\n${n.note || ''}`).join('\n\n');
  return String(notes);
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    console.error('electron-updater load error:', e);
    return;
  }
  // 맥은 Apple 개발자 서명이 없으면 앱이 스스로 새 버전을 설치할 수 없습니다.
  // 그래서 새 버전이 있다는 것만 알려 주고, 다운로드 페이지를 열어 직접 받게 합니다.
  autoUpdater.autoDownload = !IS_MAC;
  autoUpdater.autoInstallOnAppQuit = !IS_MAC;

  autoUpdater.on('checking-for-update', () => sendUpdateState({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => sendUpdateState({ state: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('update-available', info => {
    if (!IS_MAC) return sendUpdateState({ state: 'downloading', newVersion: info.version, percent: 0 });
    sendUpdateState({ state: 'ready', manual: true, newVersion: info.version, notes: releaseNotesText(info.releaseNotes) });
    if (Notification.isSupported()) {
      const n = new Notification({ title: `새 버전 v${info.version} 이 나왔어요`, body: '캘린더 아래쪽의 업데이트 버튼을 눌러 받아 주세요.' });
      n.on('click', () => { if (calendarWindow && !calendarWindow.isDestroyed()) { calendarWindow.show(); calendarWindow.focus(); } });
      n.show();
    }
  });
  autoUpdater.on('download-progress', p => sendUpdateState({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', info => {
    sendUpdateState({ state: 'ready', newVersion: info.version, notes: releaseNotesText(info.releaseNotes) });
    if (Notification.isSupported()) {
      const n = new Notification({
        title: `새 버전 v${info.version} 준비 완료`,
        body: '캘린더 아래쪽의 업데이트 버튼을 누르거나, 앱을 다시 켜면 적용돼요.'
      });
      n.on('click', () => { if (calendarWindow && !calendarWindow.isDestroyed()) { calendarWindow.show(); calendarWindow.focus(); } });
      n.show();
    }
  });
  autoUpdater.on('error', e => sendUpdateState({ state: 'error', message: String(e && e.message || e).slice(0, 200) }));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);                  // 켠 뒤 잠시 후 한 번
  setInterval(check, 6 * 60 * 60 * 1000);   // 이후 6시간마다
}

ipcMain.handle('app:version', () => app.getVersion());

// ===== 피드백 보내기 =====
// package.json 의 feedbackUrl(공개 Notion 폼 주소)을 앱 안의 작은 창으로 띄웁니다.
// 주소가 비어 있으면 버튼을 숨깁니다. 폼 바깥 링크는 기본 브라우저로 엽니다.
let feedbackWindow = null;
function feedbackUrl() {
  try {
    const url = String(require('./package.json').feedbackUrl || '');
    return /^https:\/\//.test(url) ? url : '';
  } catch { return ''; }
}
ipcMain.handle('feedback:available', () => Boolean(feedbackUrl()));
ipcMain.handle('feedback:open', () => {
  const url = feedbackUrl();
  if (!url) return false;
  if (feedbackWindow && !feedbackWindow.isDestroyed()) { feedbackWindow.show(); feedbackWindow.focus(); return true; }
  feedbackWindow = new BrowserWindow({
    width: 560, height: 780, minWidth: 420, minHeight: 520,
    title: '피드백 보내기 · Desktop Calendar Memo',
    icon: path.join(__dirname, 'assets', 'calendar-icon.ico'),
    parent: calendarWindow && !calendarWindow.isDestroyed() ? calendarWindow : undefined,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const host = new URL(url).host;
  feedbackWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  feedbackWindow.webContents.on('will-navigate', (e, target) => {
    try {
      const h = new URL(target).host;
      if (h !== host && !h.endsWith('notion.so') && !h.endsWith('notion.site') && !h.endsWith('notion.com')) { e.preventDefault(); shell.openExternal(target); }
    } catch { e.preventDefault(); }
  });
  // Notion 폼의 텍스트 칸은 한 줄 높이라 쓰기 답답합니다. 앱 창 안에서만 입력칸을 크게 보여 줍니다.
  feedbackWindow.webContents.on('did-finish-load', () => {
    feedbackWindow?.webContents.insertCSS(
      '[contenteditable="true"],textarea{min-height:240px!important;align-items:flex-start!important;' +
      'white-space:pre-wrap!important;overflow-y:auto!important;line-height:1.6!important}'
    ).catch(() => {});
  });
  feedbackWindow.loadURL(url);
  feedbackWindow.on('closed', () => { feedbackWindow = null; });
  return true;
});
ipcMain.handle('update:get', () => updateState);
ipcMain.handle('update:check', async () => {
  if (!autoUpdater) return { ...updateState, state: app.isPackaged ? 'error' : 'dev' };
  try { await autoUpdater.checkForUpdates(); } catch {}
  return updateState;
});
ipcMain.handle('update:install', () => {
  if (updateState.state !== 'ready') return;
  if (updateState.manual) shell.openExternal(RELEASES_URL);
  else if (autoUpdater) autoUpdater.quitAndInstall(false, true);
});

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 캘린더 화면(renderer/calendar.js 의 hasDate)과 같은 규칙으로 일정이 그 날짜에 있는지 판단합니다.
function occursOn(item, key) {
  if (!item.startDate || key < item.startDate) return false;
  const [sy, sm, sd] = item.startDate.split('-').map(Number);
  const [y, m, d] = key.split('-').map(Number);
  const s = new Date(sy, sm - 1, sd), t = new Date(y, m - 1, d);
  switch (item.repeat) {
    case 'daily': return true;
    case 'weekly': return Math.round((t - s) / 86400000) % 7 === 0;
    case 'monthly': return d === sd;
    case 'yearly': return m === sm && d === sd;
    default: return key === item.startDate; // 여러 날 일정은 첫날 시작 시각에 알림
  }
}
function reminderLabel(min) {
  if (min % 1440 === 0) return `${min / 1440}일`;
  if (min % 60 === 0) return `${min / 60}시간`;
  return `${min}분`;
}

app.whenReady().then(() => {
  createCalendar();
  createSidebar();
  setupAutoUpdate();

  // 일정 알림: "시작 시각 - 알림 시간"이 된 일정을 컴퓨터(Windows·맥) 알림으로 띄웁니다.
  // 반복 일정과 전날 알림(1일 전)도 처리하고, 같은 알림은 한 번만 띄웁니다.
  const firedReminders = new Set();
  setInterval(() => {
    const data = loadData();
    const now = new Date();
    for (const item of data.items || []) {
      if (!item.startDate || !item.startTime || item.reminderMinutes == null) continue;
      // 지금 알림을 띄워야 하는 일정은 "지금 + 알림 시간"에 시작하는 일정입니다.
      const start = new Date(now.getTime() + Number(item.reminderMinutes) * 60000);
      const day = dateKey(start);
      const hhmm = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
      if (hhmm !== item.startTime || !occursOn(item, day)) continue;
      const id = `${item.id}|${day}|${item.reminderMinutes}`;
      if (firedReminders.has(id)) continue;
      firedReminders.add(id);
      if (Notification.isSupported()) {
        const when = Number(item.reminderMinutes) === 0 ? '지금 시작' : `${reminderLabel(Number(item.reminderMinutes))} 후 시작`;
        new Notification({ title: item.title || '일정 알림', body: `${item.startTime} · ${when}` }).show();
      }
    }
  }, 20000);
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
