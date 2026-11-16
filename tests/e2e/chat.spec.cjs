const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
let dir, app;
const q = page => page.locator('#chat-question');
const status = page => page.locator('#chat-status');
const code = page => page.getByRole('textbox', { name: '풀이 코드', exact: true });
async function setCode(page, text) {
  await code(page).focus(); await page.keyboard.press('Control+a');
  if (text) { await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text); await page.keyboard.press('Control+v'); }
  else await page.keyboard.press('Backspace');
}
async function launch(expectLoaded = true) {
  const env = { ...process.env, STUDY_DESK_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root], env, chromiumSandbox: false });
  const page = await app.firstWindow(); await expect(page.locator('#status')).not.toHaveAttribute('data-state', 'loading');
  await app.evaluate(({}, root) => {
    global.chatCalls = [];
    global.originalChatAnswer = process.mainModule.require(root + '/src/codex-provider.cjs').CodexProvider.prototype.answer;
    process.mainModule.require(root + '/src/codex-provider.cjs').CodexProvider.prototype.answer = function(snapshot, signal) {
      return new Promise((resolve, reject) => global.chatCalls.push({ snapshot, signal, resolve, reject }));
    };
  }, root);
  await page.locator('#chat-toggle').click(); if (expectLoaded) await expect(q(page)).toBeEnabled(); return page;
}
const count = () => app.evaluate(() => global.chatCalls.length);
async function send(page, question) { await q(page).fill(question); await page.locator('#chat-send').click(); }
async function answer(index, text) { await app.evaluate(({}, { index, text }) => global.chatCalls[index].resolve(text), { index, text }); }
async function add(page, title) { await page.locator('#new-title').fill(title); await page.locator('#add').click(); }
async function select(page, title) { await page.locator('#problem-list').getByRole('button', { name: title, exact: true }).click(); }
async function saved(page) { await page.locator('#save').click(); await expect(page.locator('#status')).toHaveAttribute('data-state', 'saved'); }
async function restart(force = false) {
  const pid = app.process().pid;
  if (force) { const exited = new Promise(resolve => app.process().once('exit', resolve)); app.process().kill('SIGKILL'); await exited; }
  else await app.close();
  app = null; const page = await launch(); expect(app.process().pid).not.toBe(pid); return page;
}
test.beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-ai-e2e-')); });
test.afterEach(async () => {
  await fs.chmod(dir, 0o700);
  if (app) { await app.evaluate(({ app }) => app.exit()).catch(() => {}); await app.close().catch(() => {}); app = null; }
  await fs.rm(dir, { recursive: true, force: true });
});

test('frozen unsaved code/memo/idea, no editor reset, A/B own replies and actual new-PID restoration', async ({}, info) => {
  let page = await launch();
  await page.locator('#ideas-toggle').click(); await page.locator('#idea-add').click();
  await expect(page.locator('#idea-body')).toBeEnabled();
  await page.locator('#idea-body').fill('선택 아이디어 미저장'); await setCode(page, '// A 한글\nint n = 1;');
  await page.locator('#notes').fill('A 생각');
  const before = await code(page).evaluate(node => { const v = node.cmTile.root.view; return { text: v.state.doc.toString(), selection: v.state.selection.toJSON() }; });
  await send(page, '<img src=x onerror=alert(1)> 왜 그런가요?'); await expect.poll(count).toBe(1);
  expect(await app.evaluate(() => global.chatCalls[0].snapshot)).toMatchObject({ title: '데이터분석', code: '// A 한글\nint n = 1;', notes: 'A 생각', ideas: [{ body: '선택 아이디어 미저장' }], history: [] });
  await q(page).fill('전송 후 새 초안');
  await answer(0, '<script>답변을 실행하지 않음</script> 한글 설명');
  await expect(status(page)).toContainText('저장했습니다');
  await expect(q(page)).toHaveValue('전송 후 새 초안');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'dirty');
  expect(await code(page).evaluate(node => { const v = node.cmTile.root.view; return { text: v.state.doc.toString(), selection: v.state.selection.toJSON() }; })).toEqual(before);
  await expect(page.locator('#chat-history img, #chat-history script')).toHaveCount(0);
  await page.locator('#chat-toggle').click(); await page.locator('#chat-toggle').click(); await expect(q(page)).toHaveValue('전송 후 새 초안');
  await saved(page); await add(page, 'B'); await expect(page.locator('#problem-title')).toHaveText('B');
  await send(page, 'B 질문'); await expect.poll(count).toBe(2);
  await select(page, '데이터분석'); await expect(q(page)).toHaveValue('전송 후 새 초안');
  await answer(1, 'B 전용 답변'); await expect(page.locator('#chat-history')).not.toContainText('B 전용');
  await select(page, 'B'); await expect(page.locator('#chat-history')).toContainText('B 전용 답변'); await expect(q(page)).toHaveValue('');
  await page.screenshot({ path: info.outputPath('ai-chat-wide.png'), fullPage: true });
  page = await restart(true); await expect(page.locator('#chat-history')).toContainText('한글 설명');
  await select(page, 'B'); await expect(page.locator('#chat-history')).toContainText('B 전용 답변');
  await page.setViewportSize({ width: 740, height: 820 });
  await page.screenshot({ path: info.outputPath('ai-chat-narrow.png'), fullPage: true });
});

test('double send, cancel/late reply, distinct retry, draft protection and interrupted restart', async () => {
  let page = await launch(); await send(page, '취소할 질문'); await expect.poll(count).toBe(1);
  await expect(page.locator('#chat-send')).toBeDisabled();
  await page.locator('#chat-cancel').click(); await expect(status(page)).toContainText('취소했습니다');
  await answer(0, '무시해야 할 늦은 응답'); await expect(page.locator('#chat-history')).not.toContainText('늦은 응답');
  await expect(q(page)).toHaveValue('취소할 질문');
  await add(page, 'B'); await q(page).fill('B 초안'); await select(page, '데이터분석'); await expect(q(page)).toHaveValue('취소할 질문');
  await page.locator('#chat-send').click(); await expect.poll(count).toBe(2);
  const old = JSON.parse(await fs.readFile(path.join(dir, 'ai-chat.json'))); expect(old.entries).toHaveLength(2);
  expect(old.entries[0].id).not.toBe(old.entries[1].id);
  page = await restart(true); await expect(page.locator('#chat-history')).toContainText('이전 실행에서 중단됨');
  await expect(q(page)).toHaveValue('취소할 질문'); await expect(page.locator('#chat-send')).toBeEnabled();
});

test('response rename/sync failure then study save then pre-rename failure: same ID, draft and answer, no model retry', async () => {
  const page = await launch(); await setCode(page, 'int keep = 1;'); await page.locator('#notes').fill('그대로 둘 초안');
  await send(page, '저장 실패 시험'); await expect.poll(count).toBe(1);
  await app.evaluate(({}, root) => {
    const p = process.mainModule.require(root + '/src/chat-store.cjs').ChatStore.prototype;
    global.chatSync = p.syncDirectory; p.syncDirectory = async () => { throw new Error('synthetic sync'); };
  }, root);
  await answer(0, '잃지 않을 답변'); await expect(status(page)).toContainText('저장 확인에 실패');
  await expect(q(page)).toHaveValue('저장 실패 시험'); await expect(page.locator('#chat-history')).toContainText('잃지 않을 답변');
  const first = JSON.parse(await fs.readFile(path.join(dir, 'ai-chat.json'))); expect(first.entries).toHaveLength(1);
  await saved(page);
  await app.evaluate(({}, root) => {
    const p = process.mainModule.require(root + '/src/chat-store.cjs').ChatStore.prototype;
    p.syncDirectory = global.chatSync; global.chatWrite = p.writeTemporary; p.writeTemporary = async () => { throw new Error('synthetic write'); };
  }, root);
  await page.locator('#chat-retry-save').click(); await expect(status(page)).toContainText('저장 확인에 실패');
  await app.evaluate(({}, root) => { process.mainModule.require(root + '/src/chat-store.cjs').ChatStore.prototype.writeTemporary = global.chatWrite; }, root);
  await page.locator('#chat-retry-save').click(); await expect(status(page)).toContainText('저장했습니다');
  const final = JSON.parse(await fs.readFile(path.join(dir, 'ai-chat.json')));
  expect(final.entries).toHaveLength(1); expect(final.entries[0].id).toBe(first.entries[0].id); expect(await count()).toBe(1);
  expect(JSON.parse(await fs.readFile(path.join(dir, 'study-record.json'))).problems[0]).toMatchObject({ code: 'int keep = 1;', notes: '그대로 둘 초안' });
  await expect(page.locator('#chat-panel')).toBeVisible();
});

test('real permissions, provider failure/retry, payload and ownership validation, corrupt chat preserves study use', async () => {
  const page = await launch();
  await q(page).fill('가'.repeat(4001)); await page.locator('#chat-send').click(); await expect(status(page)).toContainText('4,000'); expect(await count()).toBe(0);
  expect(await page.evaluate(() => window.studyChat.send({ id: crypto.randomUUID(), problemId: 'data-analysis', question: 'x', code: '', notes: '', idea: { id: crypto.randomUUID(), body: 'foreign' } }))).toMatchObject({ ok: false });
  await send(page, '다시 보낼 질문'); await expect.poll(count).toBe(1);
  await app.evaluate(() => global.chatCalls[0].reject({ code: 'connection', message: 'never show private diagnostics' }));
  await expect(status(page)).toContainText('로그인'); await expect(status(page)).not.toContainText('private'); await expect(q(page)).toHaveValue('다시 보낼 질문');
  await page.locator('#chat-send').click(); await expect.poll(count).toBe(2);
  await fs.chmod(dir, 0o500); await answer(1, '권한 복구 답변'); await expect(status(page)).toContainText('저장 확인에 실패');
  await fs.chmod(dir, 0o700); await page.locator('#chat-retry-save').click(); await expect(status(page)).toContainText('저장했습니다');
  const pid = app.process().pid; await app.close(); app = null;
  await fs.writeFile(path.join(dir, 'ai-chat.json'), '{broken'); const next = await launch(false); expect(app.process().pid).not.toBe(pid);
  await expect(status(next)).toContainText('대화 파일을 읽지 못했습니다'); await expect(q(next)).toBeDisabled();
  await setCode(next, 'study still works'); await saved(next);
  expect(await fs.readFile(path.join(dir, 'ai-chat.json'), 'utf8')).toBe('{broken');
});

test('response arrives during delayed study save; chat update preserves editor history and canceling window close preserves request', async () => {
  const page = await launch(); await setCode(page, 'initial'); await saved(page);
  await code(page).focus(); await page.keyboard.press('End'); await page.keyboard.type(' edited');
  await send(page, '동시에 저장해도 되나요?'); await expect.poll(count).toBe(1);
  await app.evaluate(({ dialog }, root) => {
    const p = process.mainModule.require(root + '/src/store.cjs').StudyStore.prototype;
    global.originalStudyWrite = p.writeTemporary;
    p.writeTemporary = async function(...args) {
      if (this.filePath.endsWith('/study-record.json')) await new Promise(resolve => { global.releaseStudy = resolve; });
      return global.originalStudyWrite.apply(this, args);
    };
    dialog.showMessageBoxSync = () => 0;
  }, root);
  await page.locator('#save').click(); await expect(page.locator('#status')).toHaveAttribute('data-state', 'saving');
  await answer(0, '독립 파일에 저장합니다'); await expect(status(page)).toContainText('저장했습니다');
  await app.evaluate(({}, root) => {
    process.mainModule.require(root + '/src/store.cjs').StudyStore.prototype.writeTemporary = global.originalStudyWrite;
    global.releaseStudy();
  }, root);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'saved');
  await code(page).focus(); await page.keyboard.press('Control+z');
  await expect.poll(() => code(page).innerText()).toBe('initial');
  await send(page, '종료 취소 뒤 계속할 요청'); await expect.poll(count).toBe(2);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(q(page)).toHaveValue('종료 취소 뒤 계속할 요청');
  await answer(1, '종료를 취소해 이어진 답변'); await expect(status(page)).toContainText('저장했습니다');
  expect(await app.evaluate(({ ipcMain }) => ipcMain._invokeHandlers.get('chat:send')({ sender: null }, {}))).toMatchObject({ ok: false });
  expect(await page.evaluate(() => ({ require: typeof require, process: typeof process, keys: Object.keys(window.studyChat).sort() })))
    .toEqual({ require: 'undefined', process: 'undefined', keys: ['cancel', 'load', 'onState', 'retrySave', 'send'] });
});

test('unsupported CLI fails before inference and preserves the question in the actual UI', async ({}, info) => {
  const page = await launch();
  await app.evaluate(({}, root) => {
    global.versionCalls = 0;
    process.mainModule.require(root + '/src/codex-provider.cjs').CodexProvider.prototype.answer = function(snapshot, signal) {
      return global.originalChatAnswer.call({ run: async () => { global.versionCalls++; return 'codex-cli 9.9.9'; } }, snapshot, signal);
    };
  }, root);
  await send(page, '외부 전송하지 않을 합성 질문');
  await expect(status(page)).toContainText('검증한 Codex 0.169.0만');
  await expect(q(page)).toHaveValue('외부 전송하지 않을 합성 질문');
  expect(await count()).toBe(0);
  const data = JSON.parse(await fs.readFile(path.join(dir, 'ai-chat.json')));
  expect(data.entries[0]).toMatchObject({ status: 'failed', error: 'version', answer: '' });
  expect(await app.evaluate(() => global.versionCalls)).toBe(1);
  await page.screenshot({ path: info.outputPath('ai-version-blocked.png'), fullPage: true });
});
