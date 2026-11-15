const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { StudyStore } = require('./store.cjs');

app.setName('Algorithm Study Desk');
const appRoot = path.resolve(__dirname, '..');
const pageURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const override = process.env.STUDY_DESK_DATA_DIR;
const dataDirectory = override || path.join(app.getPath('appData'), 'algorithm-study-desk');
let window;

try {
  if (!path.isAbsolute(dataDirectory)) throw new Error('STUDY_DESK_DATA_DIR는 절대 경로여야 합니다.');
  const relative = path.relative(appRoot, path.resolve(dataDirectory));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('사용자 기록 경로는 저장소 밖에 있어야 합니다.');
  }
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  app.setPath('userData', dataDirectory);
} catch (error) {
  dialog.showErrorBox('학습 기록 폴더를 열 수 없습니다', `${error.message}\n저장 경로를 확인해 주세요: ${dataDirectory}`);
  app.exit(1);
}

// The stable userData path also shares the instance lock across worktrees/versions.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });

  app.whenReady().then(() => {
    const sample = fs.readFileSync(path.join(appRoot, 'samples/data-analysis.cpp'), 'utf8');
    const store = new StudyStore(dataDirectory, sample);
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      title: 'Algorithm Study Desk · 데이터분석',
      width: 1180, height: 820, minWidth: 740, minHeight: 600,
      backgroundColor: '#f5f3ee',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        webSecurity: true
      }
    });
    const trusted = (event) => event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === pageURL;
    ipcMain.handle('study:load', (event) => {
      if (!trusted(event)) return { ok: false, message: '허용되지 않은 요청입니다.' };
      return store.load();
    });
    ipcMain.handle('study:save', (event, draft) => {
      if (!trusted(event)) return { ok: false, message: '허용되지 않은 요청입니다.' };
      return store.save(draft);
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(window, {
        type: 'warning', title: '저장하지 않은 변경 사항',
        message: '아직 저장하지 않은 코드와 메모가 있습니다.',
        detail: '편집을 계속하려면 돌아가기를 선택하세요. 저장 중이라면 완료될 때까지 기다려 주세요.',
        buttons: ['돌아가기', '저장하지 않고 닫기'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (choice === 1) event.preventDefault();
    });
    window.loadURL(pageURL);
  }).catch((error) => {
    dialog.showErrorBox('앱 실행 실패', error.message);
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
}
