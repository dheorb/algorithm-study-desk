const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const VERSION = '0.169.0';
const MODEL = 'gpt-6.1-sol';
const MAX_OUTPUT = 256 * 1024;
const WARNINGS = [
  'Under-development features enabled: omit_skill_descriptions, skip_host_skill_discovery.',
  'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed;'
];
const disabled = ['shell_tool', 'view_image', 'apply_patch_freeform', 'apps', 'plugins', 'remote_plugin',
  'plugin_hooks', 'hooks', 'memories', 'multi_agent', 'multi_agent_v2', 'multi_agent_v2_dynamic_tools',
  'multi_agent_mode', 'goals', 'browser_use', 'browser_use_external', 'in_app_browser', 'computer_use',
  'image_generation', 'code_mode', 'code_mode_only', 'code_mode_host', 'js_repl', 'js_repl_tools_only',
  'shell_snapshot', 'shell_snapshot_v2', 'skill_search', 'skill_mcp_dependency_install', 'tool_suggest',
  'standalone_web_search', 'search_tool', 'exec_permission_approvals', 'request_permissions_tool',
  'request_rule', 'default_mode_request_user_input', 'sleep_tool', 'model_catalog_in_context',
  'external_agent_memory_import', 'agent_message_board', 'agent_message_board_mcp'];

function childEnvironment() {
  const env = {};
  // Preserve the existing login location; never copy keys, Orca session IDs, or other app context.
  for (const key of ['PATH', 'HOME', 'CODEX_HOME', 'LANG', 'LC_ALL', 'TMPDIR']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}
function buildArgs(directory) {
  const config = [...disabled.map(key => `features.${key}=false`),
    'features.skip_host_skill_discovery=true', 'features.omit_skill_descriptions=true',
    'features.tool_registry.turn_metadata_includes_tool_info=true', 'agents.enabled=false',
    'skills.bundled.enabled=false', 'skills.include_instructions=false', 'project_doc_max_bytes=0',
    'include_environment_context=false', 'include_environment_context_time=false',
    'include_apps_instructions=false', 'include_collaboration_mode_instructions=false',
    'include_permissions_instructions=false', 'memories.use_memories=false', 'memories.generate_memories=false',
    'web_search="disabled"', 'tools.update_plan.enabled=false', 'tools.experimental_request_user_input.enabled=false',
    'apps._default.enabled=false', 'plugins._default.enabled=false', 'mcp_servers={}', 'history.persistence="none"',
    `model_instructions_file=${JSON.stringify(path.join(__dirname, 'ai-tutor.txt'))}`,
    `log_dir=${JSON.stringify(path.join(directory, 'logs'))}`, `sqlite_home=${JSON.stringify(path.join(directory, 'state'))}`];
  return ['exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config',
    '--skip-git-repo-check', '-c', 'approval_policy="never"',
    '-c', 'default_permissions="study-deny"',
    '-c', 'permissions.study-deny={filesystem={"/"="deny"},network={enabled=false}}',
    '--model', MODEL, '-C', directory, ...config.flatMap(value => ['-c', value]), '-'];
}

class ProviderError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function runProcess(binary, args, { input = '', signal, timeout = 60000, cwd, env, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child, reason, output = '', size = 0, killTimer;
    const stop = code => {
      reason ||= code;
      if (child?.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        killTimer ||= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 500);
      }
    };
    // A separate deadline also survives an abrupt Electron main-process death.
    // Linux coreutils timeout is required; never fall back to an unbounded child.
    try { child = spawnProcess('/usr/bin/timeout', ['--signal=TERM', '--kill-after=1s', `${timeout / 1000}s`, binary, ...args], { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { reject(new ProviderError('unavailable')); return; }
    const timer = setTimeout(() => stop('timeout'), timeout);
    const abort = () => stop('cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', () => { reason ||= 'unavailable'; });
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_OUTPUT) stop('output');
      else output += chunk.toString('utf8');
    });
    // Never keep or surface raw stderr (it can contain private diagnostics).
    child.stderr.on('data', chunk => { size += chunk.length; if (size > MAX_OUTPUT) stop('output'); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      if (reason || code !== 0) reject(new ProviderError(reason || ([126, 127].includes(code) ? 'unavailable' : [124, 137].includes(code) ? 'timeout' : 'connection')));
      else resolve(output);
    });
    child.stdin.end(input);
  });
}
function parseResponse(output) {
  let complete = false, answer = null;
  try {
    for (const line of output.split('\n').filter(value => value.trim())) {
      const event = JSON.parse(line);
      if (complete) throw new Error();
      if (event.type === 'turn.failed' || event.type === 'error') throw new ProviderError('connection');
      if (event.type === 'item.completed' && event.item?.type === 'error') {
        if (!WARNINGS.some(prefix => event.item.message?.startsWith(prefix))) throw new ProviderError('configuration');
      } else if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        answer = event.item.text;
      } else if (event.type === 'turn.completed') complete = true;
      else if (!['thread.started', 'turn.started', 'item.started', 'item.updated', 'item.completed'].includes(event.type)) throw new Error();
      if (event.item && !['agent_message', 'reasoning', 'error'].includes(event.item.type)) throw new ProviderError('configuration');
    }
  } catch (error) { throw error instanceof ProviderError ? error : new ProviderError('protocol'); }
  if (!complete || typeof answer !== 'string' || !answer.trim()) throw new ProviderError('empty');
  if (Buffer.byteLength(answer) > 48 * 1024) throw new ProviderError('output');
  return answer;
}

class CodexProvider {
  constructor(run = runProcess) { this.run = run; }
  async answer(snapshot, signal) {
    const env = childEnvironment();
    const version = await this.run('codex', ['--version'], { env, signal, timeout: 5000 });
    if (version.trim() !== `codex-cli ${VERSION}`) throw new ProviderError('version');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-codex-'));
    try {
      return parseResponse(await this.run('codex', buildArgs(directory), {
        input: JSON.stringify(snapshot), cwd: directory, env, signal
      }));
    } finally { await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); }
  }
}
const errors = {
  boundary: 'Codex의 파일·도구 제한을 확인하지 못해 AI 연결을 보류했습니다. 기존 학습 기록 기능은 계속 사용할 수 있습니다.',
  unavailable: 'Codex CLI를 실행할 수 없습니다. 설치와 실행 경로를 확인한 뒤 다시 시도해 주세요.',
  version: `검증한 Codex ${VERSION}만 연결합니다. 현재 버전의 도구 제한을 먼저 확인해야 합니다.`,
  connection: 'Codex 연결이 완료되지 않았습니다. Codex의 로그인 상태, 네트워크 또는 사용량 제한을 확인하고 다시 시도해 주세요.',
  configuration: 'Codex 설정이나 도구 제한을 확인하지 못해 응답을 중단했습니다. 검증한 연결 설정을 확인해 주세요.',
  timeout: '응답 대기 시간 60초를 넘었습니다. 질문은 유지됩니다. 다시 시도해 주세요.',
  output: 'Codex 출력이 크기 제한을 넘어 중단했습니다. 질문을 줄여 다시 시도해 주세요.',
  protocol: 'Codex 응답 형식을 확인할 수 없습니다. 다시 시도해 주세요.',
  empty: 'Codex가 완성된 답변 없이 종료됐습니다. 다시 시도해 주세요.',
  cancelled: '요청을 취소했습니다. 질문 초안은 유지됩니다.'
};
module.exports = { CodexProvider, ProviderError, buildArgs, childEnvironment, parseResponse, runProcess, VERSION, MODEL, errors };
