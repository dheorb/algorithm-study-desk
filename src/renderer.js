import { CodeEditor } from './code-editor.js';
import { ChatPanel } from './chat-panel.js';
const notes = document.querySelector('#notes');
const save = document.querySelector('#save');
const status = document.querySelector('#status');
const savedAt = document.querySelector('#saved-at');
const list = document.querySelector('#problem-list');
const newTitle = document.querySelector('#new-title');
const add = document.querySelector('#add');
const leaveDialog = document.querySelector('#leave-dialog');
const ideasToggle = document.querySelector('#ideas-toggle');
const ideasPanel = document.querySelector('#ideas-panel');
const ideaList = document.querySelector('#idea-list');
const ideaBody = document.querySelector('#idea-body');
const ideaAdd = document.querySelector('#idea-add');
let library = null;
let selectedId = null;
let selectedIdeaId = null;
let panelOpen = false;
let baseline = { code: '', notes: '', idea: null };
let loaded = false;
let busy = '';
let lastError = '';
let saveFailed = false;
let pendingAction = null;
let chat;
// Retry a post-rename failure using the returned ID, never a first-line label.
const pendingIdeaAdds = new Map();
const code = new CodeEditor(document.querySelector('#code'), refresh);

function activeProblem() { return library.problems.find((problem) => problem.id === selectedId); }
function activeIdea() { return activeProblem().ideas.find((idea) => idea.id === selectedIdeaId); }
function draft() {
  return { id: selectedId, code: code.value, notes: notes.value, idea: selectedIdeaId ? { id: selectedIdeaId, body: ideaBody.value } : null };
}
function isDirty() {
  return loaded && (code.value !== baseline.code || notes.value !== baseline.notes ||
    (selectedIdeaId !== null && ideaBody.value !== baseline.idea?.body));
}
function showStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}
function refresh() {
  chat?.renderStatus();
  const disabled = !loaded || Boolean(busy);
  save.disabled = add.disabled = newTitle.disabled = ideasToggle.disabled = ideaAdd.disabled = disabled;
  code.setLocked(disabled);
  notes.disabled = !loaded;
  ideaBody.disabled = !loaded || selectedIdeaId === null;
  notes.readOnly = ideaBody.readOnly = Boolean(busy);
  for (const button of [...list.querySelectorAll('button'), ...ideaList.querySelectorAll('button')]) button.disabled = disabled;
  ideasPanel.hidden = !panelOpen;
  ideasToggle.textContent = panelOpen ? '아이디어 닫기' : '아이디어 열기';
  ideasToggle.setAttribute('aria-expanded', String(panelOpen));
  document.querySelector('.editors').classList.toggle('ideas-open', panelOpen);
  ideaAdd.textContent = pendingIdeaAdds.has(selectedId) ? '추가 확인 재시도' : '아이디어 추가';
  if (!loaded) return;
  const title = activeProblem().title;
  const scope = selectedIdeaId ? '코드·메모·선택 아이디어' : '코드·메모';
  document.querySelector('#save-scope').textContent = `저장 / Ctrl+S: 현재 문제의 ${scope}를 함께 저장합니다.`;
  if (busy) showStatus(busy === 'save' ? `‘${title}’ ${scope} 저장 중…` : '새 항목을 추가하는 중…', 'saving');
  else if (lastError) showStatus(lastError, 'error');
  else if (isDirty()) showStatus(`‘${title}’에 저장하지 않은 변경 사항이 있습니다.`, 'dirty');
  else {
    const hasSaved = Boolean(activeProblem().savedAt || activeIdea()?.savedAt);
    showStatus(hasSaved ? `저장 완료 · ‘${title}’의 ${scope} 변경 사항을 보관했습니다.` : `‘${title}’ · 아직 내용을 저장하지 않았습니다.`, hasSaved ? 'saved' : 'ready');
  }
}
function showTime() {
  const value = activeProblem().savedAt;
  savedAt.textContent = value ? `코드·메모 마지막 저장: ${new Date(value).toLocaleString('ko-KR')}` : '저장 버튼으로 현재 편집 내용을 보관하세요.';
  const idea = activeIdea();
  document.querySelector('#idea-saved-at').textContent = !idea ? '아이디어를 추가하거나 선택해 주세요.' :
    idea.savedAt ? `아이디어 마지막 저장: ${new Date(idea.savedAt).toLocaleString('ko-KR')}` : '아직 본문을 저장하지 않았습니다.';
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
function renderIdeas() {
  ideaList.replaceChildren();
  const problem = activeProblem();
  document.querySelector('#ideas-context').textContent = `‘${problem.title}’ · ${problem.ideas.length}개의 아이디어`;
  document.querySelector('#ideas-empty').hidden = problem.ideas.length > 0;
  problem.ideas.forEach((idea, index) => {
    const body = idea.id === selectedIdeaId ? ideaBody.value : idea.body;
    const firstLine = body.split(/\r?\n/, 1)[0].trim();
    const label = Array.from(firstLine).slice(0, 60).join('') || '새 아이디어';
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${index + 1}. ${label}`;
    button.dataset.ideaId = idea.id;
    if (idea.id === selectedIdeaId) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => requestAction({ type: 'selectIdea', problemId: selectedId, ideaId: idea.id }));
    item.append(button);
    ideaList.append(item);
  });
}
function setIdeaFields(id) {
  selectedIdeaId = id;
  ideaBody.value = activeIdea()?.body ?? '';
}
function showProblem(id, ideaId) {
  selectedId = id;
  const problem = activeProblem();
  code.show(id, problem.code);
  notes.value = problem.notes;
  setIdeaFields(panelOpen ? (ideaId ?? problem.ideas[0]?.id ?? null) : null);
  baseline = draft();
  lastError = '';
  saveFailed = false;
  document.querySelector('#problem-title').textContent = problem.title;
  document.title = `Algorithm Study Desk · ${problem.title}`;
  showTime();
  renderList();
  renderIdeas();
  chat?.show(id);
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
    pendingIdeaAdds.clear();
    showTime();
    return true;
  } catch (error) {
    saveFailed = true;
    lastError = `저장 확인 실패 · ${error.message} 편집 내용·선택·패널은 유지됩니다.`;
    return false;
  } finally {
    busy = '';
    renderList();
    renderIdeas();
    refresh();
  }
}

async function executeAction(action) {
  if (busy) return;
  if (action.type === 'select') { showProblem(action.id); return; }
  if (action.type === 'selectIdea') { showProblem(action.problemId, action.ideaId); return; }
  if (action.type === 'closeIdeas') {
    panelOpen = false;
    showProblem(selectedId);
    return;
  }
  const isIdea = action.type === 'createIdea';
  busy = 'create';
  refresh();
  try {
    const result = isIdea ? await window.studyRecord.createIdea(action.problemId, action.retryIdeaId) :
      await window.studyRecord.create(action.title);
    if (result.library) library = result.library;
    if (!result.ok) {
      if (isIdea && result.ideaId) pendingIdeaAdds.set(result.problemId, result.ideaId);
      const recovery = result.library ? (isIdea ? ' 추가된 아이디어가 목록에 보입니다. 추가 확인 재시도로 같은 항목을 확인해 주세요.' :
        ' 추가된 항목이 목록에 보입니다. 다시 추가하지 말고 해당 항목을 선택해 저장을 재시도해 주세요.') : '';
      throw new Error(result.message + recovery);
    }
    pendingIdeaAdds.clear();
    if (!isIdea) newTitle.value = '';
    showProblem(result.problemId, result.ideaId);
  } catch (error) {
    // A preceding full save may clear the map, but this retry action is not done.
    // Keep its original problem/idea pair even if the retry failed before rename.
    if (isIdea && action.retryIdeaId) pendingIdeaAdds.set(action.problemId, action.retryIdeaId);
    lastError = `${isIdea ? '아이디어' : '문제'} 추가 확인 실패 · ${error.message} 현재 편집 내용·선택·패널은 유지됩니다.`;
  } finally {
    busy = '';
    renderList();
    renderIdeas();
    refresh();
  }
}

function requestAction(action) {
  if (!loaded || busy || pendingAction || (action.type === 'select' && action.id === selectedId) ||
      (action.type === 'selectIdea' && action.ideaId === selectedIdeaId)) return;
  if (isDirty() || saveFailed) {
    pendingAction = action;
    document.querySelector('#leave-description').textContent = `‘${activeProblem().title}’의 코드·자유 메모·선택 아이디어 변경을 함께 저장하거나 버립니다. 계속 편집하면 모두 유지하며, 저장이나 추가가 실패하면 진행하지 않습니다.`;
    document.querySelector('#discard-move').textContent = action.type === 'closeIdeas' ? '버리고 닫기' : '버리고 이동';
    document.querySelector('#save-move').textContent = action.type === 'closeIdeas' ? '저장 후 닫기' : '저장 후 이동';
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
  // Only after creation succeeds may showProblem discard the previous snapshot.
  if (action) void executeAction(action);
});
document.querySelector('#save-move').addEventListener('click', async () => {
  const action = pendingAction;
  cancelAction();
  if (action && await persist()) await executeAction(action);
});
notes.addEventListener('input', refresh);
ideaBody.addEventListener('input', () => { renderIdeas(); refresh(); });
save.addEventListener('click', persist);
ideasToggle.addEventListener('click', () => {
  if (!loaded || busy || pendingAction) return;
  if (panelOpen) requestAction({ type: 'closeIdeas' });
  else {
    // Opening never discards an existing code/memo draft.
    panelOpen = true;
    setIdeaFields(activeProblem().ideas[0]?.id ?? null);
    baseline.idea = draft().idea;
    renderIdeas();
    showTime();
    refresh();
  }
});
ideaAdd.addEventListener('click', () => requestAction({ type: 'createIdea', problemId: selectedId, retryIdeaId: pendingIdeaAdds.get(selectedId) }));
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
  if (isDirty() || busy || saveFailed || chat.hasUnsaved()) { event.preventDefault(); event.returnValue = ''; }
});

chat = new ChatPanel(draft, activeProblem, () => Boolean(busy || pendingAction));

(async () => {
  try {
    const result = await window.studyRecord.load();
    document.querySelector('#storage-path').textContent = result.filePath || '경로를 불러오지 못했습니다.';
    if (!result.ok) throw new Error(result.message);
    library = result.library;
    loaded = true;
    showProblem(library.problems[0].id);
    await chat.load();
  } catch (error) {
    document.querySelector('#problem-title').textContent = '기록 확인 필요';
    showStatus(`기록을 열지 못했습니다 · ${error.message}`, 'error');
    savedAt.textContent = '원본과 .bak, study-record.v1.json, study-record.v2.json을 먼저 복사해 보존한 뒤 확인해 주세요. 복구 후 앱을 다시 열면 읽습니다.';
  }
})();
