// One Linux session/group per invocation. This leader stays alive until the final
// group KILL, even when the direct child exits or closes its standard streams.
// No shell, process discovery, or signals to another session are used.
const { spawn } = require('node:child_process');
let started = false, stopping = false;
let deadline = setTimeout(() => stop('unavailable'), 5000);

function stop(reason, code = null) {
  if (stopping) return;
  stopping = true;
  clearTimeout(deadline);
  // Do not cancel this timer on child exit: descendants may ignore TERM and
  // have no open stdio. Keeping the leader alive also pins the group identity.
  setTimeout(() => {
    try { process.kill(-process.pid, 'SIGKILL'); } finally { process.exit(1); }
  }, 500);
  if (process.connected) process.send({ type: 'result', reason, code }, () => {});
  try { process.kill(-process.pid, 'SIGTERM'); } catch {}
}

process.on('SIGTERM', () => stop('cancelled'));
process.on('SIGINT', () => stop('cancelled'));
process.on('disconnect', () => stop('cancelled'));
process.on('uncaughtException', () => stop('unavailable'));
process.on('message', message => {
  if (message?.type === 'stop') { stop(message.reason); return; }
  if (message?.type !== 'start' || started || stopping) return;
  started = true;
  clearTimeout(deadline);
  const remaining = message.deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) { stop('timeout'); return; }
  deadline = setTimeout(() => stop('timeout'), remaining);
  let child;
  try {
    child = spawn(message.binary, message.args, {
      cwd: message.cwd, env: message.env, stdio: ['inherit', 'inherit', 'inherit']
    });
  } catch { stop('unavailable'); return; }
  child.on('error', () => stop('unavailable'));
  child.on('exit', code => stop(code === 0 ? null : 'connection', code));
});
