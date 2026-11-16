const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { StudyStore } = require('../src/store.cjs');
const { ChatStore } = require('../src/chat-store.cjs');
const { ChatService, makeSnapshot } = require('../src/chat-service.cjs');
const { CodexProvider, parseResponse, runProcess, buildArgs, childEnvironment } = require('../src/codex-provider.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await tick(); } assert.fail('state timed out'); }
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-chat-unit-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const study = new StudyStore(dir, 'sample'); await study.load();
  const store = new ChatStore(dir); const calls = [];
  const provider = { answer(snapshot, signal) { return new Promise((resolve, reject) => calls.push({ snapshot, signal, resolve, reject })); } };
  const service = new ChatService(store, study, provider); await service.load();
  const input = () => ({ id: randomUUID(), problemId: 'data-analysis', question: '왜 그런가요?', code: '// 미저장', notes: '메모', idea: null });
  return { dir, study, store, service, calls, input };
}
test('frozen unsaved snapshot, selected idea override, bounded own history, payload rejection', async t => {
  const { study, input } = await setup(t);
  const a = await study.createIdea('data-analysis'); const b = await study.createIdea('data-analysis');
  const other = await study.create('B');
  const request = { ...input(), idea: { id: a.ideaId, body: '현재 아이디어' } };
  const entries = Array.from({ length: 9 }, (_, i) => ({ problemId: 'data-analysis', status: 'completed', question: `q${i}`, answer: '한글' }));
  entries.push({ problemId: other.problemId, status: 'completed', question: '다른 문제 비밀', answer: 'B' });
  const snapshot = makeSnapshot(request, study.library, entries);
  assert.equal(snapshot.code, '// 미저장'); assert.equal(snapshot.ideas[0].body, '현재 아이디어');
  assert.equal(snapshot.ideas[1].id, b.ideaId); assert.equal(snapshot.history.length, 6); assert.equal(snapshot.omittedHistory, 3);
  assert.equal(JSON.stringify(snapshot).includes('비밀'), false);
  assert.throws(() => makeSnapshot({ ...request, idea: { id: randomUUID(), body: 'x' } }, study.library, entries));
  assert.throws(() => makeSnapshot({ ...request, question: 'x'.repeat(4001) }, study.library, entries));
  assert.throws(() => makeSnapshot({ ...request, code: '가'.repeat(24000) }, study.library, entries), /64 KiB/);
  entries.at(-2).answer = 'x'.repeat(25 * 1024);
  assert.equal(makeSnapshot(request, study.library, entries).history.length, 0);
});
test('one active request, duplicate ID, cancellation and ignored late reply; new attempt is distinct', async t => {
  const { service, calls, input, store } = await setup(t);
  const first = input(); assert.equal((await service.send(first)).ok, true); await until(() => calls.length === 1);
  first.code = 'changed later'; assert.equal(calls[0].snapshot.code, '// 미저장');
  assert.equal((await service.send(input())).ok, false);
  service.cancel(first.id); await until(() => !service.active);
  calls[0].resolve('늦은 답변'); await tick();
  assert.equal(store.entries.length, 1); assert.equal(store.entries[0].status, 'cancelled'); assert.equal(store.entries[0].answer, '');
  assert.equal((await service.send(first)).ok, false);
  const second = input(); await service.send(second); await until(() => calls.length === 2);
  calls[1].resolve('새 답변'); await until(() => !service.active);
  assert.equal(store.entries.length, 2); assert.equal(store.entries[1].answer, '새 답변');
});
test('post-rename sync failure then pre-rename failure keeps answer/id through unrelated study save, no second model call', async t => {
  const { service, calls, input, store, study, dir } = await setup(t);
  await service.send(input()); await until(() => calls.length === 1);
  const sync = store.syncDirectory.bind(store); store.syncDirectory = async () => { throw new Error('synthetic sync'); };
  calls[0].resolve('보존할 답변'); await until(() => service.active?.phase === 'save-failed');
  const id = service.active.entry.id;
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'ai-chat.json'))).entries[0].answer, '보존할 답변');
  assert.equal((await study.save({ id: 'data-analysis', code: '독립 저장', notes: '새 메모' })).ok, true);
  store.syncDirectory = sync;
  const write = store.writeTemporary.bind(store); store.writeTemporary = async () => { throw new Error('synthetic write'); };
  service.retrySave(id); await until(() => service.active?.phase === 'save-failed');
  store.writeTemporary = write; service.retrySave(id); await until(() => !service.active);
  assert.equal(calls.length, 1); assert.equal(store.entries.length, 1); assert.equal(store.entries[0].id, id);
  assert.equal(study.library.problems[0].code, '독립 저장');
});
test('start-write failure launches no model; cancel preserves question; reopened pending is interrupted', async t => {
  const { service, calls, input, store, dir } = await setup(t);
  const write = store.writeTemporary.bind(store); store.writeTemporary = async () => { throw new Error('permission'); };
  await service.send(input()); await until(() => service.active?.phase === 'save-failed'); assert.equal(calls.length, 0);
  store.writeTemporary = write; service.retrySave(service.active.entry.id); await until(() => calls.length === 1);
  const reopened = new ChatStore(dir); await reopened.load(); assert.equal(reopened.entries[0].status, 'interrupted');
  service.close(); assert.equal(calls[0].signal.aborted, true);
  calls[0].resolve('종료 후 응답'); await tick(); assert.equal(reopened.entries[0].answer, '');
});
test('full A rejects before lock/write/model, preserving bytes and allowing B; uncertain start still requires save retry', async t => {
  const { dir, study, input } = await setup(t);
  const b = await study.create('B');
  const entries = Array.from({ length: 200 }, (_, i) => ({ id: randomUUID(), problemId: 'data-analysis',
    question: `Q${i}`, answer: `A${i}`, status: 'completed', error: null,
    createdAt: '2026-01-01T00:00:00Z', historyCount: 0, omittedHistory: 0 }));
  const raw = JSON.stringify({ schemaVersion: 1, entries }); const file = path.join(dir, 'ai-chat.json');
  await fs.writeFile(file, raw);
  const store = new ChatStore(dir); let calls = 0;
  const service = new ChatService(store, study, { answer: async () => { calls++; return 'B 답변'; } }); await service.load();
  const a = input(); const result = await service.send(a);
  assert.equal(result.ok, false); assert.match(result.message, /한도.*전송하지/);
  assert.equal(service.active, null); assert.equal(service.cancel(a.id).ok, false); assert.equal(calls, 0);
  assert.equal(await fs.readFile(file, 'utf8'), raw); assert.equal(a.question, '왜 그런가요?');
  const sync = store.syncDirectory.bind(store); store.syncDirectory = async () => { throw new Error('after rename'); };
  const request = { ...input(), problemId: b.problemId };
  assert.equal((await service.send(request)).ok, true); await until(() => service.active?.phase === 'save-failed');
  assert.equal(calls, 0); assert.equal(store.entries.at(-1).id, request.id);
  // A start that reached rename cannot be abandoned like the preflight rejection.
  service.cancel(request.id); await until(() => service.active?.entry.status === 'cancelled' && !service.active.flushing);
  assert.equal(service.active.entry.id, request.id); assert.equal((await service.send(input())).ok, false);
  store.syncDirectory = sync; service.retrySave(request.id); await until(() => !service.active);
  assert.equal((await service.send({ ...input(), problemId: b.problemId })).ok, true);
  await until(() => !service.active);
  assert.equal(calls, 1); assert.equal(store.entries.length, 202);
  assert.deepEqual(store.entries.slice(0, 200), entries);
  assert.equal(store.entries.at(-1).answer, 'B 답변');
});
test('v1/v2/v3 bytes and values stay unchanged during chat writes, migrate only on study save', async t => {
  const { dir } = await setup(t);
  const savedAt = '2024-01-02T03:04:05.000Z';
  for (const version of [1, 2, 3]) {
    const sub = path.join(dir, String(version)); await fs.mkdir(sub);
    const p = { id: 'data-analysis', title: '데이터분석', code: '// 한글\r\n\t', notes: '', savedAt };
    const fixture = version === 1 ? { schemaVersion: 1, problemId: p.id, code: p.code, notes: p.notes, savedAt } :
      { schemaVersion: version, problems: [{ ...p, ...(version === 3 ? { ideas: [{ id: randomUUID(), body: '생각', savedAt }] } : {}) }] };
    const raw = Buffer.from(JSON.stringify(fixture, null, 3)); const file = path.join(sub, 'study-record.json'); await fs.writeFile(file, raw);
    const study = new StudyStore(sub, 'sample'); assert.equal((await study.load()).ok, true);
    const chat = new ChatStore(sub); await chat.load();
    await chat.put({ id: randomUUID(), problemId: p.id, question: '질문', answer: '답변', status: 'completed', error: null, createdAt: savedAt, historyCount: 0, omittedHistory: 0 });
    assert.deepEqual(await fs.readFile(file), raw);
    await study.save({ id: p.id, code: p.code, notes: p.notes });
    if (version < 3) assert.deepEqual(await fs.readFile(path.join(sub, `study-record.v${version}.json`)), raw);
    assert.equal(study.library.problems[0].savedAt, savedAt);
  }
});
test('corruption, unsupported chat, external changes, real permission error preserve bytes and retry', async t => {
  const { dir, service, store, calls, input } = await setup(t);
  await service.send(input()); await until(() => calls.length === 1);
  await fs.chmod(dir, 0o500); t.after(() => fs.chmod(dir, 0o700).catch(() => {}));
  calls[0].resolve('권한 복구 후 저장'); await until(() => service.active?.phase === 'save-failed');
  await fs.chmod(dir, 0o700); service.retrySave(service.active.entry.id); await until(() => !service.active);
  for (const raw of ['broken', '{"schemaVersion":99,"entries":[]}']) {
    await fs.writeFile(store.filePath, raw); const reopened = new ChatStore(dir);
    await assert.rejects(reopened.load()); await assert.rejects(store.put(store.entries[0]));
    assert.equal(await fs.readFile(store.filePath, 'utf8'), raw);
  }
});
const good = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '한글 답변' } }) + '\n' + JSON.stringify({ type: 'turn.completed' });
test('JSONL completion contract, known warning vs unknown error, malformed/empty/tool/duplicate completion rejection', () => {
  assert.equal(parseResponse(good), '한글 답변');
  const warning = JSON.stringify({ type: 'item.completed', item: { type: 'error', message: 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed;' } });
  assert.equal(parseResponse(warning + '\n' + good), '한글 답변');
  for (const bad of ['bad', '{"type":"turn.completed"}', good + '\n{"type":"turn.completed"}',
    '{"type":"item.completed","item":{"type":"error","message":"private details"}}\n' + good,
    '{"type":"turn.failed"}', '{"type":"item.started","item":{"type":"command_execution"}}\n' + good]) assert.throws(() => parseResponse(bad));
});
test('subprocess handles split UTF-8, no final newline, timeout/cancel, output flood, spawn and exit failures', async () => {
  const code = `const b=Buffer.from(${JSON.stringify(good)});const split=b.indexOf(Buffer.from('한'))+1;process.stdout.write(b.subarray(0,split));setTimeout(()=>process.stdout.write(b.subarray(split)),10);`;
  assert.equal(parseResponse(await runProcess(process.execPath, ['-e', code])), '한글 답변');
  await assert.rejects(runProcess('/no/such/study-desk-cli', []), error => error.code === 'unavailable');
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(7)']), error => error.code === 'connection');
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 50 }), error => error.code === 'timeout');
  const abort = new AbortController(); const pending = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal }); abort.abort();
  await assert.rejects(pending, error => error.code === 'cancelled');
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stderr.write("x".repeat(300000))']), error => error.code === 'output');
});
test('unsupported CLI version fails before request; fixed argv/env do not inherit app/session metadata', async () => {
  let count = 0; const provider = new CodexProvider(async () => { count++; return 'codex-cli 9.9.9'; });
  await assert.rejects(provider.answer({}, new AbortController().signal), error => error.code === 'version'); assert.equal(count, 1);
  const args = buildArgs('/tmp/synthetic-empty'); assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('features.code_mode_host=false'));
  assert.deepEqual(Object.keys(childEnvironment()).filter(key => !['PATH', 'HOME', 'CODEX_HOME', 'LANG', 'LC_ALL', 'TMPDIR'].includes(key)), []);
  assert.ok(args.includes('permissions.study-deny={filesystem={"/"="deny"},network={enabled=false}}'));
  assert.equal(args.includes('--sandbox'), false); assert.equal(args.includes('read-only'), false);
  let knownCalls = 0;
  const broken = new CodexProvider(async () => { knownCalls++; if (knownCalls === 1) return 'codex-cli 0.169.0'; throw { code: 'configuration' }; });
  await assert.rejects(broken.answer({}, new AbortController().signal), error => error.code === 'configuration');
  assert.equal(knownCalls, 2); // No retry or weaker permissions after a configuration failure.
});

test('external deadline terminates only the owned child after abrupt caller death', async t => {
  const { dir } = await setup(t); const pidFile = path.join(dir, 'child-pid');
  const { spawn } = require('node:child_process');
  const childCode = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
  const parentCode = `require(${JSON.stringify(path.resolve(__dirname, '../src/codex-provider.cjs'))}).runProcess(process.execPath,['-e',${JSON.stringify(childCode)}],{timeout:500}).catch(()=>{});`;
  const parent = spawn(process.execPath, ['-e', parentCode], { stdio: 'ignore' });
  t.after(() => parent.kill('SIGKILL'));
  let pid;
  for (let i = 0; i < 100; i++) { try { pid = Number(await fs.readFile(pidFile, 'utf8')); break; } catch { await tick(); } }
  assert.ok(pid); parent.kill('SIGKILL');
  await until(() => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
});
