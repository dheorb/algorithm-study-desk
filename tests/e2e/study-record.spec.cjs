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
    .toEqual({ require: 'undefined', process: 'undefined', bridge: ['create', 'createIdea', 'load', 'save'] });
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

test('v1 read, failed migration, retry and v3 restart preserve values and original bytes permanently', async ({}, testInfo) => {
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
  expect(saved.schemaVersion).toBe(3);
  expect(saved.problems[0]).toEqual({ id: 'data-analysis', title: '데이터분석', code: legacy.code, notes: legacy.notes, savedAt: legacy.savedAt, ideas: [] });
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

const ideaButtons = page => page.locator('#idea-list button');
const ideaSelection = page => page.locator('#idea-list button[aria-current="true"]');
async function openIdeas(page) {
  if (await page.locator('#ideas-panel').isHidden()) await page.locator('#ideas-toggle').click();
  await expect(page.locator('#ideas-toggle')).toHaveAttribute('aria-expanded', 'true');
}
async function addIdea(page) {
  const count = await ideaButtons(page).count();
  await page.locator('#idea-add').click();
  await expect(ideaButtons(page)).toHaveCount(count + 1);
  await expect(ideaSelection(page)).toHaveCount(1);
  return ideaSelection(page).getAttribute('data-idea-id');
}
async function editAll(page, suffix) {
  await edit(page, `code ${suffix}`, `자유 메모 ${suffix}`);
  await page.locator('#idea-body').fill(`아이디어 ${suffix}`);
}
async function expectAll(page, suffix, id) {
  await expectDraft(page, '데이터분석', `code ${suffix}`, `자유 메모 ${suffix}`);
  await expect(page.locator('#idea-body')).toHaveValue(`아이디어 ${suffix}`);
  await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', id);
  await expect(page.locator('#ideas-panel')).toBeVisible();
}
async function seedIdeas(page) {
  await openIdeas(page);
  const A1 = await addIdea(page);
  await editAll(page, 'saved');
  await save(page);
  const A2 = await addIdea(page);
  await page.locator('#idea-body').fill('두 번째 저장 아이디어');
  await save(page);
  await add(page, 'B');
  await expect(heading(page)).toHaveText('B');
  await problem(page, '데이터분석').click();
  await expectAll(page, 'saved', A1);
  return { A1, A2 };
}

test('A1/A2/B1/B2, same first lines, empty ideas and code/memo survive two new-process launches', async ({}, testInfo) => {
  let page = await launch();
  await edit(page, 'A code', 'A 자유 메모 📝');
  // Opening the panel must not reset code/memo drafts.
  await openIdeas(page);
  await expectDraft(page, '데이터분석', 'A code', 'A 자유 메모 📝');
  await save(page);
  const A1 = await addIdea(page);
  await page.locator('#idea-body').fill('같은 첫 줄\nA1 한글 📝');
  await save(page);
  const A2 = await addIdea(page);
  await page.locator('#idea-body').fill('같은 첫 줄\nA2 다른 접근');
  await page.keyboard.press('Control+s');
  await expect(state(page)).toHaveAttribute('data-state', 'saved');
  await expect(ideaButtons(page).nth(0)).toHaveText('1. 같은 첫 줄');
  await expect(ideaButtons(page).nth(1)).toHaveText('2. 같은 첫 줄');
  await page.screenshot({ path: testInfo.outputPath('ideas-open.png'), fullPage: true });
  await add(page, 'B');
  await expect(heading(page)).toHaveText('B');
  await edit(page, 'B code', 'B 자유 메모');
  await save(page);
  const B1 = await addIdea(page);
  await page.locator('#idea-body').fill('B1 생각\n둘째 줄');
  await save(page);
  const B2 = await addIdea(page);
  await save(page);
  const disk = JSON.parse(await fs.readFile(filename(), 'utf8'));
  expect(disk.problems.map(p => p.ideas.map(i => i.id))).toEqual([[A1, A2], [B1, B2]]);
  page = await restart(true);
  await expect(page.locator('#ideas-panel')).toBeHidden();
  await expectDraft(page, '데이터분석', 'A code', 'A 자유 메모 📝');
  await openIdeas(page);
  await expect(page.locator('#idea-body')).toHaveValue('같은 첫 줄\nA1 한글 📝');
  await ideaButtons(page).nth(1).click();
  await expect(page.locator('#idea-body')).toHaveValue('같은 첫 줄\nA2 다른 접근');
  await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', A2);
  await problem(page, 'B').click();
  await expectDraft(page, 'B', 'B code', 'B 자유 메모');
  await expect(page.locator('#idea-body')).toHaveValue('B1 생각\n둘째 줄');
  await ideaButtons(page).nth(1).click();
  await expect(page.locator('#idea-body')).toHaveValue('');
  await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', B2);
  await page.locator('#ideas-toggle').click();
  await expect(page.locator('#ideas-panel')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('ideas-closed.png'), fullPage: true });
  page = await restart();
  await problem(page, 'B').click();
  await openIdeas(page);
  await expect(ideaButtons(page)).toHaveCount(2);
  await ideaButtons(page).nth(1).click();
  await expect(page.locator('#idea-body')).toHaveValue('');
  expect(JSON.parse(await fs.readFile(filename(), 'utf8'))).toEqual(disk);
});

for (const kind of ['idea-select', 'problem-select', 'idea-add', 'problem-add', 'panel-close']) {
  test(`three-field drafts: ${kind} can cancel, explicitly discard, or save together`, async ({}, testInfo) => {
    const page = await launch();
    const { A1, A2 } = await seedIdeas(page);
    const trigger = async suffix => {
      if (kind === 'idea-select') await ideaButtons(page).nth(1).click();
      if (kind === 'problem-select') await problem(page, 'B').click();
      if (kind === 'idea-add') await page.locator('#idea-add').click();
      if (kind === 'problem-add') await add(page, `문제 ${suffix}`);
      if (kind === 'panel-close') await page.locator('#ideas-toggle').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    };
    const returnToA1 = async () => {
      if (await heading(page).textContent() !== '데이터분석') await problem(page, '데이터분석').click();
      await openIdeas(page);
      await ideaButtons(page).nth(0).click();
    };
    await editAll(page, 'cancel');
    await trigger('cancel');
    await expect(page.locator('#leave-description')).toContainText('코드·자유 메모·선택 아이디어 변경을 함께');
    if (kind === 'panel-close') await page.screenshot({ path: testInfo.outputPath('ideas-unsaved-dialog.png'), fullPage: true });
    await page.locator('#keep-editing').click();
    await expectAll(page, 'cancel', A1);
    await trigger('cancel');
    await page.keyboard.press('Escape');
    await expectAll(page, 'cancel', A1);
    await trigger('discard');
    await page.locator('#discard-move').click();
    if (kind === 'panel-close') await expect(page.locator('#ideas-panel')).toBeHidden();
    else if (kind === 'idea-select') await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', A2);
    else if (kind === 'problem-select') await expect(heading(page)).toHaveText('B');
    else if (kind === 'problem-add') await expect(heading(page)).toHaveText('문제 discard');
    else await expect(ideaButtons(page)).toHaveCount(3);
    await returnToA1();
    await expectAll(page, 'saved', A1);
    await editAll(page, 'committed');
    await trigger('committed');
    await page.locator('#save-move').click();
    if (kind === 'panel-close') await expect(page.locator('#ideas-panel')).toBeHidden();
    else if (kind === 'idea-select') await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', A2);
    else if (kind === 'problem-select') await expect(heading(page)).toHaveText('B');
    else if (kind === 'problem-add') await expect(heading(page)).toHaveText('문제 committed');
    else await expect(ideaButtons(page)).toHaveCount(4);
    await returnToA1();
    await expectAll(page, 'committed', A1);
    const record = JSON.parse(await fs.readFile(filename(), 'utf8')).problems[0];
    expect([record.code, record.notes, record.ideas[0].body, record.ideas[1].body]).toEqual([
      'code committed', '자유 메모 committed', '아이디어 committed', '두 번째 저장 아이디어'
    ]);
  });
}

test('permission errors on close/save and discarded additions keep all drafts, IDs and panel until retry', async ({}, testInfo) => {
  test.skip(process.getuid?.() === 0, 'Run as non-root for actual permission errors');
  const page = await launch();
  const { A1, A2 } = await seedIdeas(page);
  const original = await fs.readFile(filename());
  await editAll(page, 'retry');
  await fs.chmod(directory, 0o500);
  await page.locator('#ideas-toggle').click();
  await page.locator('#save-move').click();
  await expect(state(page)).toContainText('권한');
  await expectAll(page, 'retry', A1);
  await page.locator('#idea-add').click();
  await page.locator('#discard-move').click();
  await expect(state(page)).toContainText('아이디어 추가 확인 실패');
  await expectAll(page, 'retry', A1);
  await expect(ideaButtons(page)).toHaveCount(2);
  await add(page, '실패한 새 문제');
  await page.locator('#discard-move').click();
  await expect(state(page)).toContainText('문제 추가 확인 실패');
  await expectAll(page, 'retry', A1);
  expect(await fs.readFile(filename())).toEqual(original);
  await page.screenshot({ path: testInfo.outputPath('ideas-permission-error.png'), fullPage: true });
  await fs.chmod(directory, 0o700);
  await ideaButtons(page).nth(1).click();
  await page.locator('#save-move').click();
  await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', A2);
  const restored = await restart(true);
  await openIdeas(restored);
  await expectAll(restored, 'retry', A1);
});

for (const operation of ['save', 'createIdea']) {
  test(`delayed ${operation} locks all three editors, both lists, additions, panel close and Ctrl+S`, async () => {
    const page = await launch();
    const { A1 } = await seedIdeas(page);
    if (operation === 'save') await editAll(page, 'snapshot');
    await app.evaluate((_electron, root) => {
      const { StudyStore } = process.mainModule.require(`${root}/src/store.cjs`);
      const write = StudyStore.prototype.writeTemporary;
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      StudyStore.prototype.writeTemporary = async function (...args) { await gate; return write.apply(this, args); };
      globalThis.releaseStudyWrite = () => { StudyStore.prototype.writeTemporary = write; release(); };
    }, root);
    await page.locator(operation === 'save' ? '#save' : '#idea-add').click();
    await expect(state(page)).toHaveAttribute('data-state', 'saving');
    for (const selector of ['#code', '#notes', '#idea-body']) {
      await expect(page.locator(selector)).toHaveAttribute('readonly', '');
      await page.locator(selector).focus();
      await page.keyboard.type('not accepted');
    }
    await ideaButtons(page).nth(1).dispatchEvent('click');
    await problem(page, 'B').dispatchEvent('click');
    await page.locator('#idea-add').dispatchEvent('click');
    await page.locator('#ideas-toggle').dispatchEvent('click');
    await page.locator('#add-form').dispatchEvent('submit');
    await page.keyboard.press('Control+s');
    await expectAll(page, operation === 'save' ? 'snapshot' : 'saved', A1);
    for (const selector of ['#save', '#add', '#idea-add', '#ideas-toggle']) await expect(page.locator(selector)).toBeDisabled();
    await app.evaluate(() => globalThis.releaseStudyWrite());
    await expect(state(page)).not.toHaveAttribute('data-state', 'saving');
    await expect(ideaButtons(page)).toHaveCount(operation === 'save' ? 2 : 3);
    const record = JSON.parse(await fs.readFile(filename(), 'utf8')).problems[0];
    expect(record.ideas[0].body).toBe(operation === 'save' ? '아이디어 snapshot' : '아이디어 saved');
    expect(record.ideas[1].body).toBe('두 번째 저장 아이디어');
    expect(record.code).toBe(operation === 'save' ? 'code snapshot' : 'code saved');
  });
}

test('post-rename idea addition failure keeps drafts and retries the returned ID without another empty idea', async ({}, testInfo) => {
  const page = await launch();
  const { A1 } = await seedIdeas(page);
  await editAll(page, 'keep on failure');
  await app.evaluate((_electron, root) => {
    const { StudyStore } = process.mainModule.require(`${root}/src/store.cjs`);
    const sync = StudyStore.prototype.syncDirectory;
    StudyStore.prototype.syncDirectory = async function () {
      StudyStore.prototype.syncDirectory = sync;
      throw Object.assign(new Error('injected fsync failure'), { code: 'EIO' });
    };
  }, root);
  await page.locator('#idea-add').click();
  await page.locator('#discard-move').click();
  await expect(state(page)).toContainText('추가 확인 재시도');
  await expectAll(page, 'keep on failure', A1);
  await expect(ideaButtons(page)).toHaveCount(3);
  const newId = await ideaButtons(page).nth(2).getAttribute('data-idea-id');
  await expect(page.locator('#idea-add')).toHaveText('추가 확인 재시도');
  await page.screenshot({ path: testInfo.outputPath('ideas-uncertain-add.png'), fullPage: true });
  await page.locator('#idea-add').click();
  await page.locator('#save-move').click();
  await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', newId);
  await expect(ideaButtons(page)).toHaveCount(3);
  await expect(page.locator('#idea-body')).toHaveValue('');
  const fourthId = await addIdea(page);
  expect(fourthId).not.toBe(newId);
  await expect(ideaButtons(page)).toHaveCount(4);
  const restored = await restart();
  await openIdeas(restored);
  await expectAll(restored, 'keep on failure', A1);
  await expect(ideaButtons(restored)).toHaveCount(4);
});

test('pending idea retry survives full-save success then a second pre-rename failure', async ({}, testInfo) => {
  let page = await launch();
  await openIdeas(page);
  const A1 = await addIdea(page);
  await editAll(page, 'saved');
  await save(page);
  await editAll(page, 'retry boundary 📝');
  await failNextIdeaSync();
  await page.locator('#idea-add').click();
  await page.locator('#discard-move').click();
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  await expectAll(page, 'retry boundary 📝', A1);
  await expect(ideaButtons(page)).toHaveCount(2);
  const A2 = await ideaButtons(page).nth(1).getAttribute('data-idea-id');
  await expect(page.locator('#idea-add')).toHaveText('추가 확인 재시도');
  await app.evaluate((_electron, root) => {
    const { StudyStore } = process.mainModule.require(`${root}/src/store.cjs`);
    const write = StudyStore.prototype.writeTemporary;
    let primaryWrites = 0;
    StudyStore.prototype.writeTemporary = async function (target, content) {
      if (target === this.filePath && ++primaryWrites === 2) {
        StudyStore.prototype.writeTemporary = write;
        throw Object.assign(new Error('retry write after successful full save'), { code: 'EIO' });
      }
      return write.call(this, target, content);
    };
  }, root);
  await page.locator('#idea-add').click();
  await page.locator('#save-move').click();
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  await expect(state(page)).toContainText('아이디어 추가 확인 실패');
  await expectAll(page, 'retry boundary 📝', A1);
  await expect(page.locator('#idea-add')).toHaveText('추가 확인 재시도');
  await expect(ideaButtons(page)).toHaveCount(2);
  const saved = JSON.parse(await fs.readFile(filename(), 'utf8'));
  expect(saved.problems[0]).toMatchObject({ code: 'code retry boundary 📝', notes: '자유 메모 retry boundary 📝',
    ideas: [{ id: A1, body: '아이디어 retry boundary 📝' }, { id: A2, body: '' }] });
  await page.screenshot({ path: testInfo.outputPath('ideas-retry-second-failure.png'), fullPage: true });
  await page.locator('#idea-add').click();
  await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', A2);
  await expect(ideaButtons(page)).toHaveCount(2);
  await expect(state(page)).toHaveAttribute('data-state', 'saved');
  await expectDraft(page, '데이터분석', 'code retry boundary 📝', '자유 메모 retry boundary 📝');
  await expect(page.locator('#idea-body')).toHaveValue('');
  await expect(page.locator('#ideas-panel')).toBeVisible();
  await expect(page.locator('#idea-add')).toHaveText('아이디어 추가');
  expect(JSON.parse(await fs.readFile(filename(), 'utf8'))).toEqual(saved);
  await page.screenshot({ path: testInfo.outputPath('ideas-retry-same-item.png'), fullPage: true });
  page = await restart();
  await openIdeas(page);
  await expectAll(page, 'retry boundary 📝', A1);
  await expect(ideaButtons(page)).toHaveCount(2);
  expect(JSON.parse(await fs.readFile(filename(), 'utf8'))).toEqual(saved);
});

async function failNextIdeaSync() {
  await app.evaluate((_electron, root) => {
    const { StudyStore } = process.mainModule.require(`${root}/src/store.cjs`);
    const sync = StudyStore.prototype.syncDirectory;
    StudyStore.prototype.syncDirectory = async function () {
      StudyStore.prototype.syncDirectory = sync;
      throw Object.assign(new Error('post-rename sync failure'), { code: 'EIO' });
    };
  }, root);
}

test('failed retry stays scoped to its problem; a separate save permits explicit new additions', async () => {
  const page = await launch();
  await openIdeas(page);
  const A1 = await addIdea(page);
  await editAll(page, 'saved A');
  await save(page);
  await add(page, 'B');
  await expect(heading(page)).toHaveText('B');
  const B1 = await addIdea(page);
  await edit(page, 'B code', 'B 메모');
  await page.locator('#idea-body').fill('B 아이디어');
  await save(page);
  await problem(page, '데이터분석').click();
  await failNextIdeaSync();
  await page.locator('#idea-add').click();
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  const A2 = await ideaButtons(page).nth(1).getAttribute('data-idea-id');
  await problem(page, 'B').click();
  await failNextIdeaSync();
  await page.locator('#idea-add').click();
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  const B2 = await ideaButtons(page).nth(1).getAttribute('data-idea-id');
  await problem(page, '데이터분석').click();
  await expect(page.locator('#idea-add')).toHaveText('추가 확인 재시도');
  const before = await fs.readFile(filename(), 'utf8');
  await app.evaluate((_electron, root) => {
    const { StudyStore } = process.mainModule.require(`${root}/src/store.cjs`);
    const write = StudyStore.prototype.writeTemporary;
    StudyStore.prototype.writeTemporary = async function () {
      StudyStore.prototype.writeTemporary = write;
      throw Object.assign(new Error('pre-rename retry failure'), { code: 'EIO' });
    };
  }, root);
  await page.locator('#idea-add').click();
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  await expectAll(page, 'saved A', A1);
  await expect(page.locator('#idea-add')).toHaveText('추가 확인 재시도');
  expect(await fs.readFile(filename(), 'utf8')).toBe(before);
  await problem(page, 'B').click();
  await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', B1);
  await expect(page.locator('#idea-add')).toHaveText('추가 확인 재시도');
  await page.locator('#idea-add').click();
  await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', B2);
  await expect(ideaButtons(page)).toHaveCount(2);
  await expectDraft(page, 'B', 'B code', 'B 메모');
  await expect(page.locator('#idea-body')).toHaveValue('');
  await problem(page, '데이터분석').click();
  await expectAll(page, 'saved A', A1);
  await expect(page.locator('#idea-add')).toHaveText('아이디어 추가');
  await failNextIdeaSync();
  await page.locator('#idea-add').click();
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  const A3 = await ideaButtons(page).nth(2).getAttribute('data-idea-id');
  await expect(page.locator('#idea-add')).toHaveText('추가 확인 재시도');
  await save(page); // Separate confirmed save, not an unfinished save-then-retry action.
  await expect(page.locator('#idea-add')).toHaveText('아이디어 추가');
  const A4 = await addIdea(page);
  expect(new Set([A1, A2, A3, A4, B1, B2]).size).toBe(6);
  const saved = JSON.parse(await fs.readFile(filename(), 'utf8'));
  expect(saved.problems.map(p => p.ideas.map(i => i.id))).toEqual([[A1, A2, A3, A4], [B1, B2]]);
  expect(saved.problems[1]).toMatchObject({ code: 'B code', notes: 'B 메모', ideas: [{ id: B1, body: 'B 아이디어' }, { id: B2, body: '' }] });
});

for (const version of [1, 2]) {
  test(`v${version} ideas migration preserves legacy bytes/times through permission retry and new PID`, async () => {
    test.skip(process.getuid?.() === 0, 'Run as non-root for actual permission errors');
    const old = { schemaVersion: 1, problemId: 'data-analysis', code: 'old code', notes: '이전 메모 📝', savedAt: '2024-01-02T03:04:05.123+09:00' };
    const oldProblems = [{ id: 'data-analysis', title: '데이터분석', code: old.code, notes: old.notes, savedAt: old.savedAt },
      { id: '02020202-0202-4202-8202-020202020202', title: 'B', code: '', notes: '', savedAt: null }];
    const raw = Buffer.from(` \r\n${JSON.stringify(version === 1 ? old : { schemaVersion: 2, problems: oldProblems }, null, '\t')}\r\n`);
    const olderBytes = Buffer.from(` ${JSON.stringify(old)}\n`);
    await fs.writeFile(filename(), raw);
    if (version === 2) await fs.writeFile(pinned(), olderBytes);
    let page = await launch();
    await openIdeas(page);
    await expectDraft(page, '데이터분석', old.code, old.notes);
    await expect(ideaButtons(page)).toHaveCount(0);
    expect(await fs.readFile(filename())).toEqual(raw);
    await fs.chmod(directory, 0o500);
    await page.locator('#idea-add').click();
    await expect(state(page)).toContainText('권한');
    await expect(ideaButtons(page)).toHaveCount(0);
    expect(await fs.readFile(filename())).toEqual(raw);
    await fs.chmod(directory, 0o700);
    const id = await addIdea(page);
    await page.locator('#idea-body').fill('이전 후 아이디어 📝');
    await save(page);
    const records = JSON.parse(await fs.readFile(filename(), 'utf8'));
    expect(records.schemaVersion).toBe(3);
    expect(records.problems[0].savedAt).toBe(old.savedAt);
    if (version === 2) expect(records.problems[1]).toEqual({ ...oldProblems[1], ideas: [] });
    const recoveryPath = path.join(directory, `study-record.v${version}.json`);
    expect(await fs.readFile(recoveryPath)).toEqual(raw);
    page = await restart(true);
    await openIdeas(page);
    await expectDraft(page, '데이터분석', old.code, old.notes);
    await expect(ideaSelection(page)).toHaveAttribute('data-idea-id', id);
    await expect(page.locator('#idea-body')).toHaveValue('이전 후 아이디어 📝');
    await page.locator('#idea-body').fill('후속 아이디어 저장');
    await save(page);
    expect(await fs.readFile(recoveryPath)).toEqual(raw);
    if (version === 2) expect(await fs.readFile(pinned())).toEqual(olderBytes);
    expect(JSON.parse(await fs.readFile(filename(), 'utf8')).problems[0].savedAt).toBe(old.savedAt);
  });
}

test('idea text is not HTML, foreign/unknown IPC targets are refused, and idea-only app closing is protected', async ({}, testInfo) => {
  const page = await launch();
  const { A1 } = await seedIdeas(page);
  const markup = '<img src=x onerror="window.ideaInjected=1">\n일반 텍스트';
  await page.locator('#idea-body').fill(markup);
  await expect(ideaButtons(page).nth(0)).toContainText('<img');
  expect(await page.locator('#ideas-panel img').count()).toBe(0);
  expect(await page.evaluate(() => window.ideaInjected)).toBeUndefined();
  const original = await fs.readFile(filename());
  const B = JSON.parse(original).problems[1].id;
  expect((await page.evaluate(({ B, A1 }) => window.studyRecord.save({ id: B, code: 'bad', notes: 'bad', idea: { id: A1, body: 'bad' } }), { B, A1 })).ok).toBe(false);
  expect((await page.evaluate(A1 => window.studyRecord.createIdea('unknown', A1), A1)).ok).toBe(false);
  expect(await fs.readFile(filename())).toEqual(original);
  await app.evaluate(({ dialog, BrowserWindow }) => {
    globalThis.ideaClosePrompts = [];
    dialog.showMessageBoxSync = (_window, options) => { globalThis.ideaClosePrompts.push(options); return 0; };
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect.poll(() => app.evaluate(() => globalThis.ideaClosePrompts.length)).toBe(1);
  expect(await app.evaluate(() => globalThis.ideaClosePrompts[0].message)).toContain('아이디어');
  await expect(page.locator('#idea-body')).toHaveValue(markup);
  await page.setViewportSize({ width: 740, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ideas-narrow-text.png'), fullPage: true });
  await save(page);
});
