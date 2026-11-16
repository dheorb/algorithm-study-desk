const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
let directory;
let app;
const filename = () => path.join(directory, 'study-record.json');
const pinned = () => path.join(directory, 'study-record.v1.json');
const heading = page => page.locator('#problem-title');
const problem = (page, title) => page.locator('#problem-list').getByRole('button', { name: title, exact: true });
const current = page => page.locator('#problem-list button[aria-current="true"]');
const state = page => page.locator('#status');

async function launch() {
  const env = { ...process.env, STUDY_DESK_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root], env, chromiumSandbox: process.env.STUDY_DESK_TEST_SANDBOX === '1' });
  const page = await app.firstWindow();
  await expect(state(page)).not.toHaveAttribute('data-state', 'loading');
  return page;
}
async function restart(force = false) {
  const pid = app.process().pid;
  if (force) {
    const exited = new Promise(resolve => app.process().once('exit', resolve));
    app.process().kill('SIGKILL');
    await exited;
  } else { await app.close(); }
  app = undefined;
  const page = await launch();
  expect(app.process().pid).not.toBe(pid);
  return page;
}
async function edit(page, code, notes) {
  await page.getByLabel('풀이 코드').fill(code);
  await page.getByLabel('생각해볼점').fill(notes);
}
async function save(page) {
  await page.locator('#save').click();
  await expect(state(page)).toHaveAttribute('data-state', 'saved');
}
async function add(page, title) {
  await page.getByLabel('새 문제 제목').fill(title);
  await page.locator('#add').click();
}
async function expectDraft(page, title, code, notes) {
  await expect(heading(page)).toHaveText(title);
  await expect(current(page)).toHaveText(title);
  await expect(page.getByLabel('풀이 코드')).toHaveValue(code);
  await expect(page.getByLabel('생각해볼점')).toHaveValue(notes);
}

test.beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-e2e-')); });
test.afterEach(async () => {
  await fs.chmod(directory, 0o700);
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    app = undefined;
  }
  await fs.rm(directory, { recursive: true, force: true });
});

test('A/B additions, repeated selection, Unicode edits, actual new-PID restoration and empty values', async ({}, testInfo) => {
  let page = await launch();
  const sample = await fs.readFile(path.join(root, 'samples/data-analysis.cpp'), 'utf8');
  await expectDraft(page, '데이터분석', sample, '');
  expect(await page.evaluate(() => ({ require: typeof require, process: typeof process, bridge: Object.keys(window.studyRecord).sort() })))
    .toEqual({ require: 'undefined', process: 'undefined', bridge: ['create', 'load', 'save'] });
  expect(await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation };
  })).toEqual({ sandbox: true, nodeIntegration: false, contextIsolation: true });
  await edit(page, '// A 코드', 'A 한국어 메모 📝');
  await save(page);
  await add(page, '두 수의 합');
  await expectDraft(page, '두 수의 합', '', '');
  await edit(page, '// B 코드', 'B 정렬에 대한 생각');
  await page.keyboard.press('Control+s');
  await expect(state(page)).toHaveAttribute('data-state', 'saved');
  for (let i = 0; i < 2; i++) {
    await problem(page, '데이터분석').click();
    await expectDraft(page, '데이터분석', '// A 코드', 'A 한국어 메모 📝');
    await problem(page, '두 수의 합').click();
    await expectDraft(page, '두 수의 합', '// B 코드', 'B 정렬에 대한 생각');
  }
  const before = JSON.parse(await fs.readFile(filename(), 'utf8'));
  expect(before.problems.map(p => p.title)).toEqual(['데이터분석', '두 수의 합']);
  page = await restart(true);
  await expectDraft(page, '데이터분석', '// A 코드', 'A 한국어 메모 📝');
  await problem(page, '두 수의 합').click();
  await expectDraft(page, '두 수의 합', '// B 코드', 'B 정렬에 대한 생각');
  await page.screenshot({ path: testInfo.outputPath('library-restored.png'), fullPage: true });
  expect(JSON.parse(await fs.readFile(filename(), 'utf8')).problems.map(p => p.id)).toEqual(before.problems.map(p => p.id));
  await edit(page, '', '');
  await save(page);
  page = await restart();
  await problem(page, '두 수의 합').click();
  await expectDraft(page, '두 수의 합', '', '');
  await problem(page, '데이터분석').click();
  await expectDraft(page, '데이터분석', '// A 코드', 'A 한국어 메모 📝');
});

test('unsaved selection and addition can cancel, discard explicitly, or save before moving', async ({}, testInfo) => {
  const page = await launch();
  await edit(page, 'A saved', 'A 저장 메모');
  await save(page);
  await add(page, 'B');
  await expectDraft(page, 'B', '', '');
  await edit(page, 'B draft', 'B 미저장');
  await problem(page, '데이터분석').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('unsaved-choice.png'), fullPage: true });
  await page.getByRole('button', { name: '계속 편집', exact: true }).click();
  await expectDraft(page, 'B', 'B draft', 'B 미저장');
  await problem(page, '데이터분석').click();
  await page.keyboard.press('Escape');
  await expectDraft(page, 'B', 'B draft', 'B 미저장');
  await problem(page, '데이터분석').click();
  await page.getByRole('button', { name: '버리고 이동', exact: true }).click();
  await expectDraft(page, '데이터분석', 'A saved', 'A 저장 메모');
  await problem(page, 'B').click();
  await expectDraft(page, 'B', '', '');
  await edit(page, 'B keep', 'B 저장 후 이동');
  await problem(page, '데이터분석').click();
  await page.getByRole('button', { name: '저장 후 이동', exact: true }).click();
  await expectDraft(page, '데이터분석', 'A saved', 'A 저장 메모');
  await edit(page, 'A draft', 'A 미저장');
  await add(page, 'C');
  await page.getByRole('button', { name: '계속 편집', exact: true }).click();
  await expect(problem(page, 'C')).toHaveCount(0);
  await expectDraft(page, '데이터분석', 'A draft', 'A 미저장');
  await page.locator('#add').click();
  await page.getByRole('button', { name: '버리고 이동', exact: true }).click();
  await expectDraft(page, 'C', '', '');
  await problem(page, '데이터분석').click();
  await expectDraft(page, '데이터분석', 'A saved', 'A 저장 메모');
  await edit(page, 'A final', 'A 마지막 기록');
  await add(page, 'D');
  await page.getByRole('button', { name: '저장 후 이동', exact: true }).click();
  await expectDraft(page, 'D', '', '');
  const records = JSON.parse(await fs.readFile(filename(), 'utf8')).problems;
  expect(records.map(p => [p.title, p.code, p.notes])).toEqual([
    ['데이터분석', 'A final', 'A 마지막 기록'], ['B', 'B keep', 'B 저장 후 이동'], ['C', '', ''], ['D', '', '']
  ]);
});

test('permission failure during save-then-switch and discarded-add retains selection/draft, then retries', async ({}, testInfo) => {
  test.skip(process.getuid?.() === 0, 'Run as non-root for actual permission errors');
  const page = await launch();
  await edit(page, 'A saved', '기존 정상 기록');
  await save(page);
  await add(page, 'B');
  await expect(heading(page)).toHaveText('B');
  await problem(page, '데이터분석').click();
  await edit(page, 'A draft', '보존할 편집');
  const original = await fs.readFile(filename());
  await fs.chmod(directory, 0o500);
  await problem(page, 'B').click();
  await page.getByRole('button', { name: '저장 후 이동', exact: true }).click();
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  await expect(state(page)).toContainText('권한');
  await expectDraft(page, '데이터분석', 'A draft', '보존할 편집');
  await add(page, 'C');
  await page.getByRole('button', { name: '버리고 이동', exact: true }).click();
  await expect(state(page)).toContainText('문제 추가 확인 실패');
  await expectDraft(page, '데이터분석', 'A draft', '보존할 편집');
  await expect(problem(page, 'C')).toHaveCount(0);
  expect(await fs.readFile(filename())).toEqual(original);
  await page.screenshot({ path: testInfo.outputPath('save-failure.png'), fullPage: true });
  await fs.chmod(directory, 0o700);
  await page.locator('#add').click();
  await page.getByRole('button', { name: '저장 후 이동', exact: true }).click();
  await expectDraft(page, 'C', '', '');
  await problem(page, '데이터분석').click();
  await expectDraft(page, '데이터분석', 'A draft', '보존할 편집');
  const restored = await restart();
  await expectDraft(restored, '데이터분석', 'A draft', '보존할 편집');
  await expect(problem(restored, 'C')).toBeVisible();
});

test('delayed real save freezes typing, switching, adding and repeated Ctrl+S until the captured ID is saved', async ({}, testInfo) => {
  const page = await launch();
  await save(page);
  await add(page, 'B');
  await expect(heading(page)).toHaveText('B');
  await problem(page, '데이터분석').click();
  await edit(page, 'A snapshot', 'A 저장할 순간');
  await page.getByLabel('새 문제 제목').fill('C');
  // Delay the real store's filesystem boundary; no test endpoints in product code.
  await app.evaluate((_electron, root) => {
    const { StudyStore } = process.mainModule.require(`${root}/src/store.cjs`);
    const write = StudyStore.prototype.writeTemporary;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    StudyStore.prototype.writeTemporary = async function (...args) { await gate; return write.apply(this, args); };
    globalThis.releaseStudyWrite = () => { StudyStore.prototype.writeTemporary = write; release(); };
  }, root);
  await page.locator('#save').click();
  await expect(state(page)).toHaveAttribute('data-state', 'saving');
  await expect(page.getByLabel('풀이 코드')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('생각해볼점')).toHaveAttribute('readonly', '');
  await page.getByLabel('풀이 코드').focus();
  await page.keyboard.type('must not enter');
  await problem(page, 'B').dispatchEvent('click');
  await page.locator('#add-form').dispatchEvent('submit');
  await page.keyboard.press('Control+s');
  await expect(problem(page, 'B')).toBeDisabled();
  await expect(page.locator('#add')).toBeDisabled();
  await expectDraft(page, '데이터분석', 'A snapshot', 'A 저장할 순간');
  await page.screenshot({ path: testInfo.outputPath('saving-snapshot.png'), fullPage: true });
  await app.evaluate(() => globalThis.releaseStudyWrite());
  await expect(state(page)).toHaveAttribute('data-state', 'saved');
  await expect(problem(page, 'C')).toHaveCount(0);
  await problem(page, 'B').click();
  await expectDraft(page, 'B', '', '');
  await problem(page, '데이터분석').click();
  await expectDraft(page, '데이터분석', 'A snapshot', 'A 저장할 순간');
});

test('v1 read, failed migration, retry and v2 restart preserve values and original bytes permanently', async ({}, testInfo) => {
  test.skip(process.getuid?.() === 0, 'Run as non-root for actual permission errors');
  const legacy = { schemaVersion: 1, problemId: 'data-analysis', code: '// v1 코드\n', notes: 'v1 한국어 기록 📝', savedAt: '2024-06-07T08:09:10.123+09:00' };
  const original = Buffer.from(` \r\n${JSON.stringify(legacy, null, '\t')}\r\n`);
  await fs.writeFile(filename(), original);
  let page = await launch();
  await expectDraft(page, '데이터분석', legacy.code, legacy.notes);
  expect(await fs.readFile(filename())).toEqual(original);
  await expect(page.locator('#saved-at')).not.toHaveText('');
  await fs.chmod(directory, 0o500);
  await add(page, 'B');
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  await expectDraft(page, '데이터분석', legacy.code, legacy.notes);
  expect(await fs.readFile(filename())).toEqual(original);
  await fs.chmod(directory, 0o700);
  await page.locator('#add').click();
  await expectDraft(page, 'B', '', '');
  let saved = JSON.parse(await fs.readFile(filename(), 'utf8'));
  expect(saved.schemaVersion).toBe(2);
  expect(saved.problems[0]).toEqual({ id: 'data-analysis', title: '데이터분석', code: legacy.code, notes: legacy.notes, savedAt: legacy.savedAt });
  expect(await fs.readFile(pinned())).toEqual(original);
  await edit(page, '// B 新', 'B 메모');
  await save(page);
  page = await restart(true);
  await expectDraft(page, '데이터분석', legacy.code, legacy.notes);
  await problem(page, 'B').click();
  await expectDraft(page, 'B', '// B 新', 'B 메모');
  await edit(page, '// B final', '후속 저장');
  await save(page);
  expect(await fs.readFile(pinned())).toEqual(original);
  saved = JSON.parse(await fs.readFile(filename(), 'utf8'));
  expect(saved.problems[0].savedAt).toBe(legacy.savedAt);
  await page.screenshot({ path: testInfo.outputPath('v1-migrated.png'), fullPage: true });
});

test('corrupt primary blocks saving/adding and external changes are preserved', async ({}, testInfo) => {
  const corrupt = '{"schemaVersion": 2, broken';
  await fs.writeFile(filename(), corrupt);
  let page = await launch();
  await expect(state(page)).toContainText('손상');
  await expect(heading(page)).toHaveText('기록 확인 필요');
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#add')).toBeDisabled();
  expect((await page.evaluate(() => window.studyRecord.save({ id: 'data-analysis', code: 'overwrite', notes: '' }))).ok).toBe(false);
  expect((await page.evaluate(() => window.studyRecord.create('B'))).ok).toBe(false);
  expect(await fs.readFile(filename(), 'utf8')).toBe(corrupt);
  await page.screenshot({ path: testInfo.outputPath('corrupt-library.png'), fullPage: true });
  await app.close(); app = undefined;
  await fs.unlink(filename());
  page = await launch();
  await save(page);
  const external = await fs.readFile(filename(), 'utf8') + ' \n';
  await fs.writeFile(filename(), external);
  await edit(page, 'draft', '유지할 메모');
  await saveFailure(page);
  await expect(state(page)).toContainText('변경되거나 삭제');
  await expectDraft(page, '데이터분석', 'draft', '유지할 메모');
  expect(await fs.readFile(filename(), 'utf8')).toBe(external);
});
async function saveFailure(page) {
  await page.locator('#save').click();
  await expect(state(page)).toHaveAttribute('data-state', 'error');
}

test('titles are plain text and duplicate/blank/oversized input does not add another item', async ({}, testInfo) => {
  const page = await launch();
  const title = '<img src=x onerror="window.injected=1">';
  await add(page, title);
  await expect(heading(page)).toHaveText(title);
  expect(await page.locator('#problem-title img, #problem-list img').count()).toBe(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await add(page, `  ${title}  `);
  await expect(state(page)).toContainText('같은 제목');
  await expect(page.locator('#problem-list button')).toHaveCount(2);
  for (const value of ['  ', 'x'.repeat(121), '줄\n바꿈']) {
    expect((await page.evaluate(value => window.studyRecord.create(value), value)).ok).toBe(false);
  }
  await page.setViewportSize({ width: 740, height: 600 });
  await page.screenshot({ path: testInfo.outputPath('narrow-title.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a post-rename creation error keeps the current editor and exposes one recoverable new item', async () => {
  const page = await launch();
  await edit(page, 'A saved', 'A 정상');
  await save(page);
  await app.evaluate((_electron, root) => {
    const { StudyStore } = process.mainModule.require(`${root}/src/store.cjs`);
    const sync = StudyStore.prototype.syncDirectory;
    StudyStore.prototype.syncDirectory = async function () {
      StudyStore.prototype.syncDirectory = sync;
      throw Object.assign(new Error('injected fsync failure'), { code: 'EIO' });
    };
  }, root);
  await add(page, 'B');
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  await expect(state(page)).toContainText('추가된 항목이 목록에 보입니다');
  await expectDraft(page, '데이터분석', 'A saved', 'A 정상');
  await expect(problem(page, 'B')).toHaveCount(1);
  await page.locator('#add').click();
  await expect(state(page)).toContainText('같은 제목');
  await expect(problem(page, 'B')).toHaveCount(1);
  await problem(page, 'B').click();
  await expectDraft(page, 'B', '', '');
  await save(page);
  const restored = await restart();
  await problem(restored, 'B').click();
  await expectDraft(restored, 'B', '', '');
});

test('closing an unsaved window asks to return and keeps the draft', async () => {
  const page = await launch();
  await page.getByLabel('생각해볼점').fill('아직 저장하지 않은 메모');
  await app.evaluate(({ dialog, BrowserWindow }) => {
    globalThis.closePrompts = [];
    dialog.showMessageBoxSync = (_window, options) => { globalThis.closePrompts.push(options); return 0; };
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect.poll(() => app.evaluate(() => globalThis.closePrompts.length)).toBe(1);
  expect(await app.evaluate(() => globalThis.closePrompts[0].buttons)).toEqual(['돌아가기', '저장하지 않고 닫기']);
  await expect(page.getByLabel('생각해볼점')).toHaveValue('아직 저장하지 않은 메모');
  await save(page);
});
