const code = document.querySelector('#code');
const notes = document.querySelector('#notes');
const save = document.querySelector('#save');
const status = document.querySelector('#status');
const savedAt = document.querySelector('#saved-at');
let baseline = { code: '', notes: '' };
let loaded = false;
let saving = false;
let lastError = '';
let hasSaved = false;

function draft() { return { code: code.value, notes: notes.value }; }
function isDirty() { return loaded && (code.value !== baseline.code || notes.value !== baseline.notes); }
function showStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}
function refresh() {
  save.disabled = !loaded || saving;
  if (saving) showStatus('저장 중…', 'saving');
  else if (lastError) showStatus(`저장 확인 실패 · ${lastError} 편집 내용은 이 화면에 유지됩니다.`, 'error');
  else if (isDirty()) showStatus('저장하지 않은 변경 사항이 있습니다.', 'dirty');
  else showStatus(hasSaved ? '저장 완료 · 모든 변경 사항을 보관했습니다.' : '샘플 코드 · 아직 저장하지 않았습니다.', hasSaved ? 'saved' : 'ready');
}
function showTime(value) {
  savedAt.textContent = value ? `마지막 저장: ${new Date(value).toLocaleString('ko-KR')}` : '저장 버튼을 누르면 코드와 메모를 함께 보관합니다.';
}

async function persist() {
  if (!loaded || saving) return;
  const snapshot = draft();
  saving = true;
  refresh();
  try {
    const result = await window.studyRecord.save(snapshot);
    if (!result.ok) throw new Error(result.message);
    baseline = snapshot;
    lastError = '';
    hasSaved = true;
    showTime(result.savedAt);
  } catch (error) {
    lastError = error.message || '앱과 통신할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    saving = false;
    refresh();
  }
}

code.addEventListener('input', refresh);
notes.addEventListener('input', refresh);
save.addEventListener('click', persist);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    persist();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (isDirty() || saving || lastError) { event.preventDefault(); event.returnValue = ''; }
});

(async () => {
  try {
    const result = await window.studyRecord.load();
    document.querySelector('#storage-path').textContent = result.filePath || '경로를 불러오지 못했습니다.';
    if (!result.ok) throw new Error(result.message);
    code.value = result.record.code;
    notes.value = result.record.notes;
    baseline = draft();
    loaded = true;
    hasSaved = Boolean(result.record.savedAt);
    code.disabled = notes.disabled = false;
    showTime(result.record.savedAt);
    refresh();
  } catch (error) {
    showStatus(`기록을 열지 못했습니다 · ${error.message}`, 'error');
    savedAt.textContent = '기록 보관 위치의 원본과 .bak 파일을 먼저 복사해 보존한 뒤 확인해 주세요. 복구 후 앱을 다시 열면 읽습니다.';
  }
})();
