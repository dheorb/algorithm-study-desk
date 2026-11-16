const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runProcess } = require('../src/codex-provider.cjs');
const { processTree } = require('./helpers/process-tree.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(file) {
  for (let i = 0; i < 200; i++) { try { return Number(await fs.readFile(file, 'utf8')); } catch { await delay(10); } }
  assert.fail('synthetic descendant not ready');
}
async function stopped(pid, beatFile) {
  const first = await fs.readFile(beatFile, 'utf8'); await delay(150);
  assert.equal(await fs.readFile(beatFile, 'utf8'), first, 'descendant heartbeat must stop');
  const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (stat) assert.equal(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0], 'Z', 'descendant must not be running');
}
for (const mode of ['cancel', 'deadline', 'caller-death', 'normal-exit']) {
  test(`owned same-group descendant is killed after ${mode}, even when direct child exits first`, async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-process-'));
    const tree = processTree(dir, mode === 'normal-exit'); let descendant, supervisor, caller;
    // Separate session sentinel proves we never signal unrelated process groups.
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
    t.after(async () => {
      sentinel.kill('SIGKILL'); caller?.kill('SIGKILL');
      for (const pid of [descendant, supervisor]) { if (pid) try { process.kill(pid, 'SIGKILL'); } catch {} }
      await fs.rm(dir, { recursive: true, force: true });
    });
    const controller = new AbortController(); let pending;
    if (mode === 'caller-death') {
      const parentCode = `const {spawn}=require('node:child_process');require(${JSON.stringify(path.resolve(__dirname, '../src/codex-provider.cjs'))}).runProcess(process.execPath,['-e',${JSON.stringify(tree.code)}],{timeout:500,spawnProcess(...args){const c=spawn(...args);require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'supervisor.pid'))},String(c.pid));return c}}).catch(()=>{});`;
      caller = spawn(process.execPath, ['-e', parentCode], { stdio: 'ignore' });
    } else {
      pending = runProcess(process.execPath, ['-e', tree.code], { signal: controller.signal, timeout: mode === 'deadline' ? 500 : 5000,
        spawnProcess(...args) { const child = spawn(...args); supervisor = child.pid; return child; }
      }).then(() => 'success', error => error.code);
    }
    descendant = await ready(tree.pidFile);
    if (caller) supervisor = await ready(path.join(dir, 'supervisor.pid'));
    const stat = await fs.readFile(`/proc/${descendant}/stat`, 'utf8');
    assert.equal(Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]), supervisor, 'fixture must share the owned group');
    if (mode === 'cancel') controller.abort();
    if (caller) {
      const exit = new Promise(resolve => caller.once('exit', resolve)); caller.kill('SIGKILL'); await exit;
    } else assert.equal(await pending, { cancel: 'cancelled', deadline: 'timeout', 'normal-exit': 'success' }[mode]);
    // Includes the review's 900ms cancellation and 1.8s caller-death windows.
    await delay(mode === 'caller-death' ? 1800 : 800);
    await stopped(descendant, tree.beatFile);
    assert.doesNotThrow(() => process.kill(sentinel.pid, 0));
  });
}
test('supervisor spawn failure has no unbounded fallback or target launch', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-no-supervisor-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'target-started'); let launches = 0;
  await assert.rejects(runProcess(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'x')`], {
    spawnProcess(binary, args, options) {
      launches++; assert.equal(binary, process.execPath); assert.match(args[0], /process-supervisor.cjs$/);
      return spawn(path.join(dir, 'missing-runtime'), args, options);
    }
  }), error => error.code === 'unavailable');
  assert.equal(launches, 1); await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
});
