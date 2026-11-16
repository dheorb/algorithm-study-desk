const { errors } = require('./codex-provider.cjs');
const { uuid } = require('./chat-store.cjs');
const MAX_SNAPSHOT = 64 * 1024;
const HISTORY_PAIRS = 6;
const HISTORY_BYTES = 24 * 1024;
const SAVE_ERROR = '대화 저장 확인에 실패했습니다. 질문·답변은 화면에 유지됩니다. 저장 경로의 권한·공간·외부 변경 또는 대화 한도를 확인하고 대화 저장 재시도를 눌러 주세요.';

function makeSnapshot(input, library, entries) {
  const problem = library?.problems.find(item => item.id === input?.problemId);
  if (!problem || !uuid(input?.id) || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 4000 ||
      typeof input.code !== 'string' || typeof input.notes !== 'string') throw new Error('질문은 공백을 제외해 1~4,000자여야 하며 현재 문제를 확인할 수 있어야 합니다.');
  const ideas = problem.ideas.map(idea => ({ id: idea.id, body: idea.body }));
  if (input.idea !== null && input.idea !== undefined) {
    const selected = ideas.find(idea => idea.id === input.idea.id);
    if (!selected || typeof input.idea.body !== 'string') throw new Error('선택 아이디어가 현재 문제에 속하지 않습니다.');
    selected.body = input.idea.body;
  }
  const snapshot = { title: problem.title, code: input.code, notes: input.notes, ideas, question: input.question };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT) throw new Error('질문·제목·코드·메모·아이디어가 64 KiB를 넘습니다. 전송하지 않았으며 초안은 유지됩니다.');
  const completed = entries.filter(entry => entry.problemId === problem.id && entry.status === 'completed');
  const history = [];
  for (const entry of completed.slice(-HISTORY_PAIRS).reverse()) {
    const pair = { question: entry.question, answer: entry.answer };
    if (Buffer.byteLength(JSON.stringify([pair, ...history])) > HISTORY_BYTES) break;
    history.unshift(pair);
  }
  return { ...snapshot, history, omittedHistory: completed.length - history.length };
}

class ChatService {
  constructor(store, studyStore, provider, publish = () => {}) {
    this.store = store; this.studyStore = studyStore; this.provider = provider; this.publish = publish;
    this.active = null; this.revision = 0; this.loadError = ''; this.loaded = false; this.closed = false;
  }
  state() {
    const entries = this.store.entries.filter(entry => entry.id !== this.active?.entry.id);
    if (this.active) entries.push(this.active.entry);
    return structuredClone({ revision: this.revision, loaded: this.loaded, loadError: this.loadError, entries,
      active: this.active ? { id: this.active.entry.id, problemId: this.active.entry.problemId,
        title: this.active.snapshot.title,
        phase: this.active.phase, saveError: this.active.saveError, omittedHistory: this.active.snapshot.omittedHistory,
        historyCount: this.active.snapshot.history.length } : null });
  }
  emit() { this.revision++; if (!this.closed) this.publish(this.state()); }
  async load() {
    try { await this.store.load(); this.loaded = true; this.loadError = ''; }
    catch { this.loadError = '대화 파일을 읽지 못했습니다. 손상·미지원 형식·권한을 확인해 주세요. 원본과 .bak를 보존하며 전송을 중단했습니다.'; }
    this.emit(); return this.state();
  }
  async send(input) {
    if (!this.loaded || this.closed) return { ok: false, message: this.loadError || '대화를 먼저 불러와 주세요.' };
    if (this.active) return { ok: false, message: '다른 요청 또는 대화 저장이 진행 중입니다.' };
    if (this.store.entries.some(entry => entry.id === input?.id)) return { ok: false, message: '이미 처리한 요청입니다. 새 시도는 새 요청으로 보내 주세요.' };
    let snapshot;
    try { snapshot = makeSnapshot(input, this.studyStore.library, this.store.entries); }
    catch (error) { return { ok: false, message: error.message }; }
    this.active = { entry: { id: input.id, problemId: input.problemId, question: snapshot.question, answer: '',
      status: 'running', error: null, createdAt: new Date().toISOString(),
      historyCount: snapshot.history.length, omittedHistory: snapshot.omittedHistory }, snapshot,
      phase: 'preparing', saveError: '', controller: new AbortController(), cancelled: false, next: 'start' };
    this.emit();
    void this.flush();
    return { ok: true };
  }
  async flush() {
    const request = this.active;
    if (!request || request.flushing || this.closed) return;
    request.flushing = true; request.saveError = ''; request.phase = 'saving'; this.emit();
    try {
      await this.store.put(request.entry);
      if (this.closed || this.active !== request) return;
      if (request.next === 'start') {
        request.flushing = false;
        if (request.cancelled) { await this.finish(request, 'cancelled', '', 'cancelled'); return; }
        request.phase = 'running'; request.next = 'finish'; this.emit();
        void this.provider.answer(structuredClone(request.snapshot), request.controller.signal)
          .then(answer => this.finish(request, 'completed', answer, null), error => this.finish(request, 'failed', '', Object.hasOwn(errors, error.code) ? error.code : 'connection'));
      } else { this.active = null; this.emit(); }
    } catch {
      request.phase = 'save-failed'; request.saveError = SAVE_ERROR; this.emit();
    } finally { request.flushing = false; }
  }
  async finish(request, status, answer, error) {
    if (this.closed || this.active !== request || request.finished) return;
    if (status === 'completed' && (typeof answer !== 'string' || !answer.trim() || Buffer.byteLength(answer) > 48 * 1024)) {
      status = 'failed'; error = typeof answer === 'string' && answer.trim() ? 'output' : 'empty'; answer = '';
    }
    request.finished = true;
    request.entry = { ...request.entry, status: request.cancelled ? 'cancelled' : status,
      answer: request.cancelled ? '' : answer, error: request.cancelled ? 'cancelled' : error };
    request.next = 'finish';
    await this.flush();
  }
  cancel(id) {
    const request = this.active;
    if (!request || request.entry.id !== id || request.finished) return { ok: false };
    request.cancelled = true; request.controller.abort();
    // Invalidate the response immediately, even if the provider ignores abort.
    if (request.phase === 'running' || request.phase === 'save-failed') void this.finish(request, 'cancelled', '', 'cancelled');
    this.emit(); return { ok: true };
  }
  retrySave(id) {
    if (this.active?.entry.id === id && this.active.phase === 'save-failed') void this.flush();
    return { ok: true };
  }
  close() { this.closed = true; this.active?.controller.abort(); }
}
module.exports = { ChatService, makeSnapshot, MAX_SNAPSHOT, HISTORY_PAIRS, HISTORY_BYTES, SAVE_ERROR };
