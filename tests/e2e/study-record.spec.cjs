const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
let directory;
let app;

async function launch() {
  const env = { ...process.env, STUDY_DESK_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  // Playwright defaults to no OS sandbox on Linux. Opt in on a configured host.
  app = await electron.launch({ args: [root], env, chromiumSandbox: process.env.STUDY_DESK_TEST_SANDBOX === '1' });
  const page = await app.firstWindow();
  await expect(page.locator('#status')).not.toHaveAttribute('data-state', 'loading');
  return page;
}

test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-e2e-'));
});
test.afterEach(async () => {
  await fs.chmod(directory, 0o700);
  if (app) {
    // Do not let an unsaved-change confirmation hang test cleanup.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    app = undefined;
  }
  await fs.rm(directory, { recursive: true, force: true });
});

test('edits save via IPC and restore after actual process exit/relaunch', async ({}, testInfo) => {
  let page = await launch();
  const sample = await fs.readFile(path.join(root, 'samples/data-analysis.cpp'), 'utf8');
  await expect(page.getByRole('heading', { name: '데이터분석', exact: true })).toBeVisible();
  await expect(page.getByLabel('풀이 코드')).toHaveValue(sample);
  await expect(page.getByLabel('생각해볼점')).toBeEmpty();
  expect(await page.evaluate(() => ({ require: typeof require, process: typeof process, bridge: Object.keys(window.studyRecord).sort() }))).toEqual({ require: 'undefined', process: 'undefined', bridge: ['load', 'save'] });
  expect(await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation };
  })).toEqual({ sandbox: true, nodeIntegration: false, contextIsolation: true });
  const editedCode = `${sample}\n// 재시작 뒤에도 남는 기록`;
  const editedNotes = '인덱스 배열 대신 벡터를 사용하면 어떨까?\n정렬 기준을 다시 살펴보기. 📝';
  await page.getByLabel('풀이 코드').fill(editedCode);
  await page.getByLabel('생각해볼점').fill(editedNotes);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'dirty');
  await page.getByRole('button', { name: /저장/ }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'saved');
  const pid = app.process().pid;
  const record = JSON.parse(await fs.readFile(path.join(directory, 'study-record.json'), 'utf8'));
  expect(record.code).toBe(editedCode);
  expect(record.notes).toBe(editedNotes);
  // SIGKILL ensures restoration cannot depend on an exit-time write or living process.
  const exited = new Promise(resolve => app.process().once('exit', resolve));
  app.process().kill('SIGKILL');
  await exited;
  app = undefined;
  page = await launch();
  expect(app.process().pid).not.toBe(pid);
  await expect(page.getByLabel('풀이 코드')).toHaveValue(editedCode);
  await expect(page.getByLabel('생각해볼점')).toHaveValue(editedNotes);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'saved');
  await page.screenshot({ path: testInfo.outputPath('restored.png'), fullPage: true });
  await page.getByLabel('풀이 코드').fill('');
  await page.getByLabel('생각해볼점').fill('');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'saved');
  await app.close();
  app = undefined;
  page = await launch();
  await expect(page.getByLabel('풀이 코드')).toHaveValue('');
  await expect(page.getByLabel('생각해볼점')).toHaveValue('');
});

test('real permission failure preserves editor and disk; retry succeeds', async ({}, testInfo) => {
  test.skip(process.getuid?.() === 0, 'Permission denial must run as a non-root user');
  const page = await launch();
  await page.getByRole('button', { name: /저장/ }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'saved');
  const original = await fs.readFile(path.join(directory, 'study-record.json'), 'utf8');
  await page.getByLabel('풀이 코드').fill('// 저장 실패에도 보존할 코드');
  await page.getByLabel('생각해볼점').fill('사라지면 안 되는 메모');
  await fs.chmod(directory, 0o500);
  await page.getByRole('button', { name: /저장/ }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status')).toContainText('권한');
  await expect(page.getByLabel('풀이 코드')).toHaveValue('// 저장 실패에도 보존할 코드');
  await expect(page.getByLabel('생각해볼점')).toHaveValue('사라지면 안 되는 메모');
  expect(await fs.readFile(path.join(directory, 'study-record.json'), 'utf8')).toBe(original);
  await page.screenshot({ path: testInfo.outputPath('save-failure.png'), fullPage: true });
  await fs.chmod(directory, 0o700);
  await page.getByRole('button', { name: /저장/ }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'saved');
  expect(await fs.readFile(path.join(directory, 'study-record.json.bak'), 'utf8')).toBe(original);
  await app.close();
  app = undefined;
  const restored = await launch();
  await expect(restored.getByLabel('생각해볼점')).toHaveValue('사라지면 안 되는 메모');
});

test('corrupt data blocks saving and remains byte-for-byte unchanged', async ({}, testInfo) => {
  const corrupt = '{"schemaVersion": 1, broken';
  const filename = path.join(directory, 'study-record.json');
  await fs.writeFile(filename, corrupt);
  const page = await launch();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status')).toContainText('손상');
  await expect(page.getByRole('button', { name: /저장/ })).toBeDisabled();
  expect((await page.evaluate(() => window.studyRecord.save({ code: 'overwrite', notes: '' }))).ok).toBe(false);
  expect(await fs.readFile(filename, 'utf8')).toBe(corrupt);
  await page.screenshot({ path: testInfo.outputPath('corrupt-record.png'), fullPage: true });
});

test('external modification blocks overwrite and retains edits', async () => {
  const page = await launch();
  await page.getByRole('button', { name: /저장/ }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'saved');
  const filename = path.join(directory, 'study-record.json');
  const original = JSON.parse(await fs.readFile(filename, 'utf8'));
  const external = JSON.stringify({ ...original, notes: '외부에서 바뀐 메모' });
  await fs.writeFile(filename, external);
  await page.getByLabel('생각해볼점').fill('현재 창의 메모');
  await page.getByRole('button', { name: /저장/ }).click();
  await expect(page.locator('#status')).toContainText('변경되거나 삭제');
  await expect(page.getByLabel('생각해볼점')).toHaveValue('현재 창의 메모');
  expect(await fs.readFile(filename, 'utf8')).toBe(external);
});

test('closing an unsaved window asks to return and keeps the draft', async () => {
  const page = await launch();
  await page.getByLabel('생각해볼점').fill('아직 저장하지 않은 메모');
  await app.evaluate(({ dialog, BrowserWindow }) => {
    globalThis.closePrompts = [];
    // Simulate choosing the default "돌아가기" button in the native dialog.
    dialog.showMessageBoxSync = (_window, options) => {
      globalThis.closePrompts.push(options);
      return 0;
    };
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect.poll(() => app.evaluate(() => globalThis.closePrompts.length)).toBe(1);
  expect(await app.evaluate(() => globalThis.closePrompts[0].buttons)).toEqual(['돌아가기', '저장하지 않고 닫기']);
  await expect(page.getByLabel('생각해볼점')).toHaveValue('아직 저장하지 않은 메모');
  await page.getByRole('button', { name: /저장/ }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'saved');
});
