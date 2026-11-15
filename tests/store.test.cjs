const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { StudyStore, MAX_CODE } = require('../src/store.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-unit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, store: new StudyStore(directory, '// sample') };
}

test('first load is read-only; Unicode and empty values survive a new store; previous save is backed up', async (t) => {
  const { directory, store } = await fixture(t);
  assert.equal((await store.load()).record.code, '// sample');
  assert.deepEqual(await fs.readdir(directory), []);
  const first = { code: '// 한국어\nint main() {}', notes: '벡터를 써 볼까? 📝' };
  assert.equal((await store.save(first)).ok, true);
  const original = await fs.readFile(store.filePath, 'utf8');
  const reloaded = new StudyStore(directory, '// changed sample');
  const restored = await reloaded.load();
  assert.equal(restored.record.code, first.code);
  assert.equal(restored.record.notes, first.notes);
  assert.equal((await reloaded.save({ code: '', notes: '' })).ok, true);
  assert.equal(await fs.readFile(store.backupPath, 'utf8'), original);
  assert.equal((await new StudyStore(directory, 'sample').load()).record.code, '');
  assert.equal((await fs.stat(store.filePath)).mode & 0o777, 0o600);
});

test('corrupt and future-version data are preserved and cannot be silently overwritten', async (t) => {
  const { store } = await fixture(t);
  for (const raw of ['{"code":', JSON.stringify({ schemaVersion: 99, problemId: 'data-analysis', code: '', notes: '', savedAt: new Date().toISOString() })]) {
    await fs.writeFile(store.filePath, raw);
    assert.equal((await store.load()).ok, false);
    assert.equal((await store.save({ code: 'replacement', notes: '' })).ok, false);
    assert.equal(await fs.readFile(store.filePath, 'utf8'), raw);
  }
});

test('external changes and deletion after loading are not overwritten', async (t) => {
  const { store } = await fixture(t);
  await store.load();
  await store.save({ code: 'saved', notes: '' });
  await fs.writeFile(store.filePath, 'external change');
  assert.equal((await store.save({ code: 'draft', notes: '' })).ok, false);
  assert.equal(await fs.readFile(store.filePath, 'utf8'), 'external change');
  await fs.unlink(store.filePath);
  assert.equal((await store.save({ code: 'draft', notes: '' })).ok, false);
  await assert.rejects(fs.access(store.filePath), { code: 'ENOENT' });
});

test('failed backup replacement keeps the old record and cleans temporary files', async (t) => {
  const { directory, store } = await fixture(t);
  await store.load();
  await store.save({ code: 'original', notes: 'original note' });
  const original = await fs.readFile(store.filePath, 'utf8');
  // A directory at the backup destination deterministically makes rename fail.
  await fs.mkdir(store.backupPath);
  const result = await store.save({ code: 'new draft', notes: 'new note' });
  assert.equal(result.ok, false);
  assert.equal(await fs.readFile(store.filePath, 'utf8'), original);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['study-record.json', 'study-record.json.bak']);
  await fs.rmdir(store.backupPath);
  assert.equal((await store.save({ code: 'retry', notes: 'retry note' })).ok, true);
  assert.equal(await fs.readFile(store.backupPath, 'utf8'), original);
});

test('invalid or oversized IPC payload cannot change the file', async (t) => {
  const { store } = await fixture(t);
  await store.load();
  for (const draft of [null, { code: 42, notes: '' }, { code: 'x'.repeat(MAX_CODE + 1), notes: '' }]) {
    assert.equal((await store.save(draft)).ok, false);
  }
  await assert.rejects(fs.access(store.filePath), { code: 'ENOENT' });
});
