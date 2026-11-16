const code = document.querySelector('#code');
const notes = document.querySelector('#notes');
const save = document.querySelector('#save');
const status = document.querySelector('#status');
const savedAt = document.querySelector('#saved-at');
const list = document.querySelector('#problem-list');
const newTitle = document.querySelector('#new-title');
const add = document.querySelector('#add');
const leaveDialog = document.querySelector('#leave-dialog');
let library = null;
let selectedId = null;
let baseline = { code: '', notes: '' };
let loaded = false;
let busy = '';
let lastError = '';
let saveFailed = false;
let pendingAction = null;

function activeProblem() { return library.problems.find((problem) => problem.id === selectedId); }
function draft() { return { id: selectedId, code: code.value, notes: notes.value }; }
function isDirty() { return loaded && (code.value !== baseline.code || notes.value !== baseline.notes); }
function showStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}
function refresh() {
  const disabled = !loaded || Boolean(busy);
  save.disabled = add.disabled = newTitle.disabled = disabled;
  code.disabled = notes.disabled = !loaded;
  // Freeze this snapshot until its request settles; switching/adding is also disabled.
  code.readOnly = notes.readOnly = Boolean(busy);
  for (const button of list.querySelectorAll('button')) button.disabled = disabled;
  if (!loaded) return;
  const title = activeProblem().title;
  if (busy) showStatus(busy === 'save' ? `‘${title}’ 저장 중…` : '새 문제를 추가하는 중…', 'saving');
  else if (lastError) showStatus(lastError, 'error');
  else if (isDirty()) showStatus(`‘${title}’에 저장하지 않은 변경 사항이 있습니다.`, 'dirty');
  else showStatus(activeProblem().savedAt ? `저장 완료 · ‘${title}’의 변경 사항을 보관했습니다.` : `‘${title}’ · 아직 풀이를 저장하지 않았습니다.`, activeProblem().savedAt ? 'saved' : 'ready');
}
function showTime(value) {
  savedAt.textContent = value ? `마지막 저장: ${new Date(value).toLocaleString('ko-KR')}` : '저장 버튼을 누르면 이 문제의 코드와 메모를 함께 보관합니다.';
}
function renderList() {
  list.replaceChildren();
  document.querySelector('#problem-count').textContent = `(${library.problems.length})`;
  for (const problem of library.problems) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = problem.title;
    button.dataset.problemId = problem.id;
    if (problem.id === selectedId) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => requestAction({ type: 'select', id: problem.id }));
    item.append(button);
    list.append(item);
  }
}
function showProblem(id) {
  selectedId = id;
  const problem = activeProblem();
  code.value = problem.code;
  notes.value = problem.notes;
  baseline = draft();
  lastError = '';
  saveFailed = false;
  document.querySelector('#problem-title').textContent = problem.title;
  document.title = `Algorithm Study Desk · ${problem.title}`;
  showTime(problem.savedAt);
  renderList();
  refresh();
}

async function persist() {
  if (!loaded || busy) return false;
  const snapshot = draft();
  busy = 'save';
  refresh();
  try {
    const result = await window.studyRecord.save(snapshot);
    if (result.library) library = result.library;
    if (!result.ok) throw new Error(result.message);
    baseline = snapshot;
    lastError = '';
    saveFailed = false;
    showTime(activeProblem().savedAt);
    return true;
  } catch (error) {
    saveFailed = true;
    lastError = `저장 확인 실패 · ${error.message} 편집 내용과 현재 선택은 유지됩니다.`;
    return false;
  } finally {
    busy = '';
    renderList();
    refresh();
  }
}

async function executeAction(action) {
  if (busy) return;
  if (action.type === 'select') {
    showProblem(action.id);
    return;
  }
  busy = 'create';
  refresh();
  try {
    const result = await window.studyRecord.create(action.title);
    if (result.library) library = result.library;
    if (!result.ok) throw new Error(result.message + (result.library ? ' 추가된 항목이 목록에 보입니다. 다시 추가하지 말고 해당 항목을 선택해 저장을 재시도해 주세요.' : ''));
    newTitle.value = '';
    showProblem(result.problemId);
  } catch (error) {
    lastError = `문제 추가 확인 실패 · ${error.message} 현재 편집 내용과 선택은 유지됩니다.`;
  } finally {
    busy = '';
    renderList();
    refresh();
  }
}

function requestAction(action) {
  if (!loaded || busy || pendingAction || (action.type === 'select' && action.id === selectedId)) return;
  if (isDirty() || saveFailed) {
    pendingAction = action;
    document.querySelector('#leave-description').textContent = `‘${activeProblem().title}’의 편집 내용을 어떻게 할까요? 저장에 실패하면 이동하지 않습니다.`;
    leaveDialog.showModal();
  } else {
    void executeAction(action);
  }
}
function cancelAction() { pendingAction = null; leaveDialog.close(); }
leaveDialog.addEventListener('cancel', (event) => { event.preventDefault(); cancelAction(); });
document.querySelector('#keep-editing').addEventListener('click', cancelAction);
document.querySelector('#discard-move').addEventListener('click', () => {
  const action = pendingAction;
  cancelAction();
  // Creation can fail: don't discard the editor until the new item exists.
  if (action) void executeAction(action);
});
document.querySelector('#save-move').addEventListener('click', async () => {
  const action = pendingAction;
  cancelAction();
  if (action && await persist()) await executeAction(action);
});
code.addEventListener('input', refresh);
notes.addEventListener('input', refresh);
save.addEventListener('click', persist);
document.querySelector('#add-form').addEventListener('submit', (event) => {
  event.preventDefault();
  requestAction({ type: 'create', title: newTitle.value });
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!leaveDialog.open) void persist();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (isDirty() || busy || saveFailed) { event.preventDefault(); event.returnValue = ''; }
});

(async () => {
  try {
    const result = await window.studyRecord.load();
    document.querySelector('#storage-path').textContent = result.filePath || '경로를 불러오지 못했습니다.';
    if (!result.ok) throw new Error(result.message);
    library = result.library;
    loaded = true;
    showProblem(library.problems[0].id);
  } catch (error) {
    document.querySelector('#problem-title').textContent = '기록 확인 필요';
    showStatus(`기록을 열지 못했습니다 · ${error.message}`, 'error');
    savedAt.textContent = '기록 보관 위치의 원본과 .bak, study-record.v1.json을 먼저 복사해 보존한 뒤 확인해 주세요. 복구 후 앱을 다시 열면 읽습니다.';
  }
})();
