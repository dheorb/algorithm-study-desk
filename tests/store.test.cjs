const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { StudyStore, MAX_CODE, MAX_TITLE } = require('../src/store.cjs');

const A = 'data-analysis';
const legacyRecord = { schemaVersion: 1, problemId: A, code: '// 이전 코드\n', notes: '기존 한글 메모 📝', savedAt: '2025-04-03T12:34:56.789+09:00' };
const legacyBytes = Buffer.from(` \r\n${JSON.stringify(legacyRecord, null, '\t')}\r\n\t`);
const entry = (result, id = A) => result.library.problems.find((problem) => problem.id === id);

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-unit-'));
  t.after(async () => { await fs.chmod(directory, 0o700); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, store: new StudyStore(directory, '// sample') };
}
async function bytes(store) { return fs.readFile(store.filePath); }

test('A/B stable IDs isolate Unicode edits and empty values across reloads; load never writes', async (t) => {
  const { directory, store } = await fixture(t);
  assert.equal(entry(await store.load()).code, '// sample');
  assert.deepEqual(await fs.readdir(directory), []);
  const first = await store.save({ id: A, code: '// 한국어\nint main() {}', notes: 'A 벡터 📝' });
  assert.equal(first.ok, true);
  const added = await store.create('  두 수의 합  ');
  assert.equal(added.ok, true);
  const B = added.problemId;
  assert.notEqual(B, A);
  assert.equal(entry(added, B).title, '두 수의 합');
  assert.equal(entry(added, B).code, '');
  assert.equal(entry(added, B).notes, '');
  assert.deepEqual(entry(added), entry(first));
  await store.save({ id: B, code: '// B', notes: 'B 메모' });
  const original = await bytes(store);
  const cleared = await store.save({ id: A, code: '', notes: '' });
  assert.equal(entry(cleared).code, '');
  assert.equal(entry(cleared, B).notes, 'B 메모');
  assert.deepEqual(await fs.readFile(store.backupPath), original);
  const reopened = await new StudyStore(directory, '// changed sample').load();
  assert.deepEqual(reopened.library, cleared.library);
  assert.equal((await fs.stat(store.filePath)).mode & 0o777, 0o600);
});

test('v1 read is byte-preserving; first addition migrates all values and pins original bytes across later backups', async (t) => {
  const { directory, store } = await fixture(t);
  await fs.writeFile(store.filePath, legacyBytes);
  const loaded = await store.load();
  assert.deepEqual(entry(loaded), { id: A, title: '데이터분석', code: legacyRecord.code, notes: legacyRecord.notes, savedAt: legacyRecord.savedAt });
  assert.deepEqual(await bytes(store), legacyBytes);
  assert.deepEqual(await fs.readdir(directory), ['study-record.json']);
  const added = await store.create('새 문제');
  assert.equal(added.ok, true);
  assert.deepEqual(entry(added), entry(loaded));
  assert.equal(JSON.parse(await bytes(store)).schemaVersion, 2);
  assert.deepEqual(await fs.readFile(store.legacyBackupPath), legacyBytes);
  for (const notes of ['새 메모', '또 다른 메모']) {
    assert.equal((await store.save({ id: added.problemId, code: '', notes })).ok, true);
  }
  assert.deepEqual(await fs.readFile(store.legacyBackupPath), legacyBytes);
  const restarted = await new StudyStore(directory, '// fallback must not appear').load();
  assert.deepEqual(entry(restarted), entry(loaded));
  assert.equal(entry(restarted, added.problemId).notes, '또 다른 메모');
  const blankDirectory = await fs.mkdtemp(path.join(directory, 'blank-v1-'));
  const blankStore = new StudyStore(blankDirectory, '// must not replace empty code');
  const blankBytes = Buffer.from(JSON.stringify({ ...legacyRecord, code: '', notes: '' }));
  await fs.writeFile(blankStore.filePath, blankBytes);
  assert.equal(entry(await blankStore.load()).code, '');
  assert.equal((await blankStore.create('빈 기록 옆 문제')).ok, true);
  const blankRestored = entry(await new StudyStore(blankDirectory, '// sample').load());
  assert.equal(blankRestored.code, '');
  assert.equal(blankRestored.notes, '');
  assert.equal(blankRestored.savedAt, legacyRecord.savedAt);
  assert.deepEqual(await fs.readFile(blankStore.legacyBackupPath), blankBytes);
});

test('interrupted migration after creating recovery copy leaves v1 usable and can restart/retry', async (t) => {
  const { directory, store } = await fixture(t);
  await fs.writeFile(store.filePath, legacyBytes);
  await store.load();
  // Fail after the pinned recovery file is published, before replacing the primary.
  const write = store.writeTemporary.bind(store);
  store.writeTemporary = (target, content) => {
    if (target === store.backupPath) throw Object.assign(new Error('injected I/O failure'), { code: 'EIO' });
    return write(target, content);
  };
  assert.equal((await store.create('추가할 문제')).ok, false);
  assert.deepEqual(await bytes(store), legacyBytes);
  assert.deepEqual(await fs.readFile(store.legacyBackupPath), legacyBytes);
  assert.equal((await fs.readdir(directory)).some((file) => file.endsWith('.tmp')), false);
  const reopened = new StudyStore(directory, 'sample');
  assert.equal(entry(await reopened.load()).notes, legacyRecord.notes);
  const rename = fs.rename;
  const replacementFailure = t.mock.method(fs, 'rename', async (source, target) => {
    if (target === store.filePath) throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
    return rename(source, target);
  });
  assert.equal((await reopened.create('추가할 문제')).ok, false);
  assert.deepEqual(await bytes(store), legacyBytes);
  assert.deepEqual(await fs.readFile(store.legacyBackupPath), legacyBytes);
  replacementFailure.mock.restore();
  const result = await reopened.create('추가할 문제');
  assert.equal(result.ok, true);
  assert.equal(result.library.problems.length, 2);
  assert.deepEqual(await fs.readFile(store.legacyBackupPath), legacyBytes);
});

test('real directory permission failure during migration leaves v1 intact, then retries', async (t) => {
  if (process.getuid?.() === 0) return t.skip('Run as non-root for permission checks');
  const { directory, store } = await fixture(t);
  await fs.writeFile(store.filePath, legacyBytes);
  await store.load();
  await fs.chmod(directory, 0o500);
  const failed = await store.create('B');
  assert.equal(failed.ok, false);
  assert.match(failed.message, /권한/);
  assert.deepEqual(await bytes(store), legacyBytes);
  assert.equal(entry(await new StudyStore(directory, 'sample').load()).savedAt, legacyRecord.savedAt);
  await fs.chmod(directory, 0o700);
  assert.equal((await store.create('B')).ok, true);
  assert.deepEqual(await fs.readFile(store.legacyBackupPath), legacyBytes);
});

test('conflicting v1 recovery copy is never overwritten', async (t) => {
  const { store } = await fixture(t);
  await fs.writeFile(store.filePath, legacyBytes);
  await fs.writeFile(store.legacyBackupPath, 'older recovery copy');
  await store.load();
  const failed = await store.save({ id: A, code: '// edited', notes: 'draft' });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /복구 사본/);
  assert.deepEqual(await bytes(store), legacyBytes);
  assert.equal(await fs.readFile(store.legacyBackupPath, 'utf8'), 'older recovery copy');
});

test('corrupt/unsupported/malformed records block all mutations without touching bytes', async (t) => {
  const { directory, store } = await fixture(t);
  const valid = { id: A, title: '데이터분석', code: '', notes: '', savedAt: null };
  const invalid = [
    '{"code":', 'null', JSON.stringify({ ...legacyRecord, schemaVersion: 99 }),
    JSON.stringify({ ...legacyRecord, notes: 17 }),
    ...[[], [valid, valid], [{ ...valid, id: '../escape' }], [{ ...valid, title: ' ' }], [{ ...valid, savedAt: 'bad date' }], [{ ...valid, code: null }]].map(problems => JSON.stringify({ schemaVersion: 2, problems })),
    Buffer.concat([Buffer.from('{"code":"'), Buffer.from([0xff]), Buffer.from('"}')])
  ];
  for (const raw of invalid) {
    await fs.writeFile(store.filePath, raw);
    const reopened = new StudyStore(directory, 'sample');
    assert.equal((await reopened.load()).ok, false);
    assert.equal((await reopened.save({ id: A, code: 'replacement', notes: '' })).ok, false);
    assert.equal((await reopened.create('B')).ok, false);
    assert.deepEqual(await bytes(store), Buffer.from(raw));
  }
});

test('external modifications and deletion block both save and create', async (t) => {
  const { store } = await fixture(t);
  await store.load();
  await store.save({ id: A, code: 'saved', notes: '' });
  await fs.writeFile(store.filePath, 'external change');
  assert.equal((await store.save({ id: A, code: 'draft', notes: '' })).ok, false);
  assert.equal((await store.create('B')).ok, false);
  assert.equal(await fs.readFile(store.filePath, 'utf8'), 'external change');
  await fs.unlink(store.filePath);
  assert.equal((await store.create('B')).ok, false);
  await assert.rejects(fs.access(store.filePath), { code: 'ENOENT' });
});

test('failed backup replacement preserves library and file, cleans temporary files, and retries', async (t) => {
  const { directory, store } = await fixture(t);
  await store.load();
  await store.save({ id: A, code: 'original', notes: 'original note' });
  const original = await bytes(store);
  await fs.mkdir(store.backupPath);
  assert.equal((await store.create('B')).ok, false);
  assert.deepEqual(await bytes(store), original);
  assert.equal((await store.load()).library.problems.length, 1);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['study-record.json', 'study-record.json.bak']);
  await fs.rmdir(store.backupPath);
  assert.equal((await store.create('B')).ok, true);
  assert.deepEqual(await fs.readFile(store.backupPath), original);
});

test('invalid IDs, oversized drafts, blank/long/control/duplicate titles cannot mutate the library', async (t) => {
  const { store } = await fixture(t);
  await store.load();
  for (const draft of [null, { id: 'unknown', code: '', notes: '' }, { id: A, code: 42, notes: '' }, { id: A, code: 'x'.repeat(MAX_CODE + 1), notes: '' }]) {
    assert.equal((await store.save(draft)).ok, false);
  }
  for (const title of [null, 7, '', '   ', '데이터분석', '  데이터분석  ', 'x'.repeat(MAX_TITLE + 1), '한\n줄', '한\t줄']) {
    assert.equal((await store.create(title)).ok, false);
  }
  await assert.rejects(fs.access(store.filePath), { code: 'ENOENT' });
  const accepted = await store.create('<b>일반 제목</b>');
  assert.equal(accepted.ok, true);
  assert.equal(entry(accepted, accepted.problemId).title, '<b>일반 제목</b>');
});

test('overlapping operations are refused and the original ID/snapshot is captured before I/O', async (t) => {
  const { store } = await fixture(t);
  await store.load();
  const B = (await store.create('B')).problemId;
  const write = store.writeTemporary.bind(store);
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  store.writeTemporary = async (...args) => { await gate; return write(...args); };
  const draft = { id: A, code: 'captured A', notes: '처음 메모' };
  const saving = store.save(draft);
  draft.id = B; draft.code = 'mutated B';
  assert.equal((await store.save({ id: B, code: 'overlap', notes: '' })).ok, false);
  assert.equal((await store.create('C')).ok, false);
  assert.equal((await store.load()).ok, false);
  resume();
  const result = await saving;
  assert.equal(result.ok, true);
  assert.equal(entry(result).code, 'captured A');
  assert.equal(entry(result, B).code, '');
});

test('post-rename sync failure reports the committed library without pretending success or duplicating creation', async (t) => {
  const { directory, store } = await fixture(t);
  await store.load();
  const sync = store.syncDirectory.bind(store);
  store.syncDirectory = async () => { throw Object.assign(new Error('sync failure'), { code: 'EIO' }); };
  const failed = await store.create('B');
  assert.equal(failed.ok, false);
  assert.equal(failed.library.problems.length, 2);
  assert.equal((await new StudyStore(directory, 'sample').load()).library.problems[1].id, failed.library.problems[1].id);
  store.syncDirectory = sync;
  assert.equal((await store.create('B')).ok, false);
  const retry = await store.save({ id: failed.library.problems[1].id, code: 'retry', notes: '' });
  assert.equal(retry.ok, true);
  assert.equal(retry.library.problems.length, 2);
});

test('aggregate serialized size cannot produce a file that is too large to reopen', async (t) => {
  const { store } = await fixture(t);
  await store.load();
  await store.save({ id: A, code: '\0'.repeat(MAX_CODE), notes: '' });
  const B = (await store.create('B')).problemId;
  const original = await bytes(store);
  const failed = await store.save({ id: B, code: '\0'.repeat(MAX_CODE), notes: '' });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /8 MiB/);
  assert.deepEqual(await bytes(store), original);
});
