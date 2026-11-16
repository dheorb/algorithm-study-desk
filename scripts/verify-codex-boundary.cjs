// No real model request: an unauthenticated loopback provider supplies synthetic SSE.
// Uses the product's exact version/args/env/model/cwd policy. Does not collect headers.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { buildArgs, childEnvironment, runProcess, VERSION, MODEL } = require('../src/codex-provider.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'study-desk-codex-boundary-'));
  const empty = path.join(root, 'empty'); await fs.mkdir(empty);
  const env = childEnvironment();
  assert.equal((await runProcess('codex', ['--version'], { env, timeout: 5000 })).trim(), `codex-cli ${VERSION}`);
  const instruction = (await fs.readFile(path.join(__dirname, '../src/ai-tutor.txt'), 'utf8')).trim();
  const prompt = JSON.stringify({ title: '합성 문제', code: 'int x = 1;', notes: '합성 메모', ideas: [], question: '1 + 1?', history: [], omittedHistory: 0 });
  const sentinel = path.join(empty, 'unexpected-side-effect');
  const legacy = process.argv.includes('--legacy-read-only');
  // All targets are our fixtures, outside the working directory when testing reads.
  const canary = path.join(root, 'synthetic-canary.cpp');
  const canaryText = 'SYNTHETIC_CANARY_ONLY\n';
  const inside = path.join(empty, 'synthetic-inside.cpp');
  await fs.writeFile(canary, canaryText);
  await fs.writeFile(path.join(root, 'synthetic.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD2sAAAAASUVORK5CYII=', 'base64'));
  const calls = [
    { name: 'exec', type: 'custom_tool_call', namespace: 'functions', input: `await tools.exec_command({cmd: ${JSON.stringify('touch ' + sentinel)}})` },
    { name: 'wait', type: 'function_call', namespace: 'functions', arguments: JSON.stringify({ cell_id: 'synthetic-cell' }) },
    { name: 'exec_command', type: 'function_call', namespace: 'functions', arguments: JSON.stringify({ cmd: 'touch ' + sentinel }) },
    ...['shell_command', 'shell'].map(name => ({ name, type: 'function_call', arguments: JSON.stringify({ command: 'touch ' + sentinel }) })),
    { name: 'read_file', type: 'function_call', arguments: JSON.stringify({ path: canary }) },
    { name: 'apply_patch', type: 'custom_tool_call', namespace: 'functions', input: `*** Begin Patch\n*** Add File: ${sentinel}\n+synthetic\n*** End Patch` },
    { name: 'apply_patch', type: 'custom_tool_call', namespace: 'functions', input: `*** Begin Patch\n*** Update File: ${canary}\n@@\n-NOT_MATCHING\n+ignored\n*** End Patch` },
    { name: 'apply_patch', type: 'custom_tool_call', namespace: 'functions', input: `*** Begin Patch\n*** Update File: ${canary}\n@@\n-SYNTHETIC_CANARY_ONLY\n+ignored\n*** End Patch` },
    { name: 'apply_patch', type: 'custom_tool_call', namespace: 'functions', input: `*** Begin Patch\n*** Update File: ${root}/synthetic-missing.cpp\n@@\n-NOT_MATCHING\n+ignored\n*** End Patch` },
    { name: 'apply_patch', type: 'custom_tool_call', namespace: 'functions', input: `*** Begin Patch\n*** Update File: ${inside}\n@@\n-SYNTHETIC_CANARY_ONLY\n+ignored\n*** End Patch` },
    ...[canary, inside].map(file => ({ name: 'apply_patch', type: 'custom_tool_call', namespace: 'functions', input: `*** Begin Patch\n*** Delete File: ${file}\n*** End Patch` })),
    { name: 'view_image', type: 'function_call', namespace: 'functions', arguments: JSON.stringify({ path: path.join(root, 'synthetic.png') }) },
    { name: 'web_search', type: 'function_call', arguments: '{}' },
    { name: 'mcp__synthetic__read', type: 'function_call', arguments: '{}' },
    { name: 'spawn_agent', type: 'function_call', arguments: '{}' },
    { name: 'unregistered_synthetic_tool', type: 'function_call', arguments: '{}' }
  ];
  const summaries = [];
  const names = tools => tools.flatMap(tool => tool.tools ? names(tool.tools).map(name => `${tool.name}.${name}`) : [tool.name ?? tool.type]);
  function candidateArgs() {
    const args = buildArgs(empty); args.pop();
    if (legacy) {
      for (let i = args.length - 1; i > 0; i--) if (/^(default_permissions|permissions.study-deny)=/.test(args[i])) args.splice(i - 1, 2);
      args.push('--sandbox', 'read-only');
    }
    return args;
  }
  for (const call of [null, ...calls]) {
    await fs.rm(empty, { recursive: true, force: true }); await fs.mkdir(empty);
    await fs.writeFile(inside, canaryText);
    const paths = [canary, inside, path.join(root, 'synthetic.png')];
    for (const file of paths) await fs.utimes(file, new Date('2000-01-01'), new Date('2000-01-01'));
    const beforeTimes = await Promise.all(paths.map(async file => (await fs.stat(file)).atimeMs));
    let requests = 0, denial = null, failure = null;
    const server = http.createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url.startsWith('/v1/models')) { res.writeHead(404).end(); return; }
        let raw = ''; for await (const chunk of req) raw += chunk;
        if (!raw) throw new Error(`Empty synthetic body: ${req.method} ${req.url} during ${call?.name ?? 'none'}`);
        const body = JSON.parse(raw); requests++;
        assert.equal(body.model, MODEL);
        const tools = body.input.filter(item => item.type === 'additional_tools');
        assert.equal(tools.length, 1);
        assert.deepEqual(names(tools[0].tools), ['functions.exec', 'functions.wait']);
        assert.deepEqual(body.input.filter(item => item.type === 'message').map(item => ({ role: item.role, content: item.content })), [
          { role: 'developer', content: [{ type: 'input_text', text: instruction }] },
          { role: 'user', content: [{ type: 'input_text', text: prompt }] }
        ]);
        const rest = body.input.filter(item => !['additional_tools', 'message'].includes(item.type));
        if (requests === 1) assert.deepEqual(rest, []);
        else {
          assert.equal(rest.length, 2); assert.equal(rest[0].name, call.name);
          assert.match(rest[1].type, /^(function_call_output|custom_tool_call_output)$/);
          assert.equal(typeof rest[1].output, 'string');
          assert.match(rest[1].output, /code-mode host is disabled|unsupported call:|patch rejected:|apply_patch verification failed:/);
          denial = rest[1].output;
        }
        const item = call && requests === 1 ? { ...call, id: 'probe-tool', call_id: 'probe-call' } :
          { id: 'probe-message', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '합성 응답', annotations: [] }] };
        const response = { id: 'probe-response', object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const event of [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
          { type: 'response.output_item.added', output_index: 0, item }, { type: 'response.output_item.done', output_index: 0, item },
          { type: 'response.completed', response }]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        res.end();
      } catch (error) { failure = error; res.writeHead(400).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const args = candidateArgs();
      args.push('-c', 'model_provider="boundary_probe"', '-c',
        `model_providers.boundary_probe={name="Synthetic loopback probe",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",requires_openai_auth=false,request_max_retries=0,stream_max_retries=0}`, '-');
      try { await runProcess('codex', args, { cwd: empty, env, input: prompt, timeout: 15000 }); }
      catch (error) { throw failure || new Error(`${call?.name ?? 'none'}: ${error.message}`); }
      if (failure) throw failure;
      assert.equal(requests, call ? 2 : 1);
      // Stat before our own content read. Old timestamps force Linux relatime to record a read.
      const afterTimes = await Promise.all(paths.map(async file => (await fs.stat(file)).atimeMs));
      const readAbsent = afterTimes.every((time, index) => time === beforeTimes[index]);
      if (!legacy) assert.equal(readAbsent, true, `${call?.name}: fixture was read`);
      await assert.rejects(fs.stat(sentinel), { code: 'ENOENT' });
      assert.equal(await fs.readFile(canary, 'utf8'), canaryText);
      assert.equal(await fs.readFile(inside, 'utf8'), canaryText);
      if (!legacy && call?.name === 'apply_patch' && !call.input.includes('*** Add File:')) {
        assert.match(denial, /Failed to (read|delete).*No such file or directory/s);
      }
      summaries.push({ injected: call?.name ?? 'none', requests, model: MODEL, toolNames: ['functions.exec', 'functions.wait'],
        exactAllowedMessages: true, noOtherInput: true, denial, mutationAbsent: true, beforeTimes, afterTimes, readAbsent,
        classification: !call ? 'exposure-only' : !readAbsent ? 'filesystem-read-before-write-denial' :
          denial.startsWith('apply_patch verification failed:') ? 'permission-denied-before-read' :
          denial.startsWith('patch rejected:') ? 'sandbox-denied-write-handler-remains' : 'dispatch-denied' });
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
  const invalidConfigurations = [];
  if (!legacy) {
    for (const invalid of ['default_permissions="missing-profile"', 'permissions.study-deny.filesystem={"/"="invalid-permission"}']) {
      let modelRequests = 0;
      const server = http.createServer((req, res) => { if (req.url.startsWith('/v1/responses')) modelRequests++; res.writeHead(400).end(); });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const args = candidateArgs(); args.push('-c', 'model_provider="boundary_probe"', '-c',
          `model_providers.boundary_probe={name="Synthetic probe",base_url="http://127.0.0.1:${server.address().port}/v1",requires_openai_auth=false,request_max_retries=0}`, '-c', invalid, '-');
        await assert.rejects(runProcess('codex', args, { cwd: empty, env, input: prompt, timeout: 15000 }));
        assert.equal(modelRequests, 0);
        invalidConfigurations.push({ override: invalid, rejected: true, modelRequests });
      } finally { await new Promise(resolve => server.close(resolve)); }
    }
  }
  const isolationSatisfied = summaries.every(item => item.readAbsent);
  const result = { version: VERSION, mode: 'synthetic-loopback-no-real-model', legacy, productCandidateConfiguration: !legacy, isolationSatisfied, summaries, invalidConfigurations };
  await fs.writeFile(path.join(root, 'summary.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ report: path.join(root, 'summary.json'), ...result }, null, 2));
  if (!isolationSatisfied) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
