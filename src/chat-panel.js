const labels = { running: '전송 중', completed: '답변 완료', failed: '연결 실패', cancelled: '취소됨', interrupted: '이전 실행에서 중단됨' };
export class ChatPanel {
  constructor(getDraft, getProblem, isBusy) {
    this.getDraft = getDraft; this.getProblem = getProblem; this.isBusy = isBusy;
    this.drafts = new Map(); this.id = null; this.open = false; this.sending = false;
    this.state = { revision: -1, entries: [], loaded: false, active: null }; this.error = '';
    this.input = document.querySelector('#chat-question');
    this.status = document.querySelector('#chat-status');
    this.list = document.querySelector('#chat-history');
    this.send = document.querySelector('#chat-send');
    this.toggle = document.querySelector('#chat-toggle');
    this.input.addEventListener('input', () => { this.drafts.set(this.id, this.input.value); this.error = ''; this.renderStatus(); });
    this.toggle.addEventListener('click', () => { this.open = !this.open; this.renderStatus(); });
    this.send.addEventListener('click', () => this.submit());
    document.querySelector('#chat-cancel').addEventListener('click', () => window.studyChat.cancel(this.state.active?.id));
    document.querySelector('#chat-retry-save').addEventListener('click', () => window.studyChat.retrySave(this.state.active?.id));
    document.querySelector('#chat-reload').addEventListener('click', () => this.load());
    window.studyChat.onState(state => this.update(state));
  }
  async load() {
    try { this.update(await window.studyChat.load()); }
    catch { this.error = '대화 기록을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.'; this.renderStatus(); }
  }
  update(state) {
    if (typeof state?.revision !== 'number' || state.revision < this.state.revision) return;
    const old = this.state;
    this.state = state;
    for (const entry of state.entries) {
      if (entry.status === 'completed' && state.active?.id !== entry.id && old.active?.id === entry.id &&
          this.drafts.get(entry.problemId) === entry.question) this.drafts.set(entry.problemId, '');
      if ((!old.loaded || !this.drafts.has(entry.problemId)) && ['interrupted', 'failed', 'cancelled'].includes(entry.status)) this.drafts.set(entry.problemId, entry.question);
    }
    if (this.id) this.input.value = this.drafts.get(this.id) ?? '';
    this.renderHistory(); this.renderStatus();
  }
  show(id) {
    if (this.id !== id) { this.id = id; this.input.value = this.drafts.get(id) ?? ''; this.error = ''; }
    this.renderHistory(); this.renderStatus();
  }
  renderHistory() {
    this.list.replaceChildren();
    for (const entry of this.state.entries.filter(item => item.problemId === this.id)) {
      const item = document.createElement('li'); item.dataset.requestId = entry.id;
      const title = document.createElement('strong'); title.textContent = labels[entry.status];
      const context = document.createElement('p'); context.textContent = `전송 이력: 최근 ${entry.historyCount}쌍 포함 · 오래된 ${entry.omittedHistory}쌍 제외`;
      const question = document.createElement('p'); question.textContent = `나: ${entry.question}`;
      const answer = document.createElement('p'); answer.textContent = entry.answer ? `Codex: ${entry.answer}` : '';
      item.append(title, context, question, answer);
      if (entry.status !== 'completed' && entry.status !== 'running') {
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '질문을 초안으로 복사';
        retry.addEventListener('click', () => {
          // Never replace an already edited question while recovering an older attempt.
          if (this.input.value && this.input.value !== entry.question) {
            this.error = '현재 질문 초안을 먼저 보관하거나 비운 뒤 복사해 주세요.'; this.renderStatus(); return;
          }
          this.input.value = entry.question; this.drafts.set(this.id, entry.question); this.renderStatus();
        }); item.append(retry);
      }
      this.list.append(item);
    }
  }
  renderStatus() {
    const active = this.state.active;
    document.querySelector('#chat-panel').hidden = !this.open;
    document.querySelector('.editors').classList.toggle('chat-open', this.open);
    this.toggle.textContent = this.open ? 'AI 대화 닫기' : 'AI 대화 열기';
    this.toggle.setAttribute('aria-expanded', String(this.open));
    this.toggle.disabled = !this.id;
    document.querySelector('#chat-context').textContent = this.id ? `‘${this.getProblem().title}’의 학습 대화` : '문제를 먼저 불러와 주세요.';
    this.input.disabled = !this.id || !this.state.loaded;
    this.send.disabled = !this.state.loaded || !this.id || Boolean(active) || this.sending || this.isBusy() || !this.input.value.trim();
    const cancel = document.querySelector('#chat-cancel');
    cancel.hidden = !active || this.state.entries.find(entry => entry.id === active.id)?.status !== 'running';
    const retry = document.querySelector('#chat-retry-save'); retry.hidden = active?.phase !== 'save-failed';
    document.querySelector('#chat-reload').hidden = this.state.loaded;
    const last = this.state.entries.filter(entry => entry.problemId === this.id).at(-1);
    let message = this.error || this.state.loadError || '';
    if (!message && active?.saveError) message = `‘${active.title}’ · ${active.saveError}`;
    if (!message && active) message = `${active.problemId === this.id ? '이 문제' : '다른 문제'}의 ${active.phase === 'running' ? 'Codex 응답을 기다리는 중' : '대화 기록 저장 중'}… 최근 ${active.historyCount}쌍 포함, 오래된 ${active.omittedHistory}쌍 제외. 문제를 바꿔도 원래 문제에 기록합니다.`;
    if (!message && last?.error) message = this.errorText(last.error);
    if (!message) message = last?.status === 'completed' ? '답변과 질문을 이 문제에 저장했습니다.' : '질문을 입력해 전송하세요. 실패·취소 후 다시 보내기는 현재 화면 맥락의 새 시도입니다.';
    this.status.textContent = message;
    this.status.dataset.state = this.error || this.state.loadError || active?.saveError || last?.error ? 'error' : active ? 'busy' : 'ready';
  }
  errorText(code) {
    const messages = {
      boundary: 'Codex의 파일·도구 제한이 충족되지 않아 AI 연결을 보류했습니다. 기존 학습 기록은 계속 사용할 수 있습니다.',
      unavailable: 'Codex CLI를 실행할 수 없습니다. 설치와 실행 경로를 확인하세요.',
      version: '검증한 Codex 0.169.0만 연결합니다. 다른 버전의 도구 제한은 확인이 필요합니다.',
      connection: '연결 실패: Codex 로그인 상태·네트워크·사용량 제한을 확인하고 다시 보내 주세요.',
      configuration: 'Codex 설정·도구 제한을 확인하지 못했습니다. 검증한 연결 설정을 확인하세요.',
      timeout: '60초 응답 대기 시간이 지났습니다. 질문을 유지했으니 다시 보내 주세요.',
      output: '응답 크기 제한을 넘었습니다. 질문을 줄여 다시 보내 주세요.',
      protocol: '응답 형식 오류입니다. 질문은 유지됩니다. 다시 보내 주세요.',
      empty: '완성된 답변 없이 종료됐습니다. 다시 보내 주세요.',
      cancelled: '요청을 취소했습니다. 질문 초안은 유지됩니다.'
    };
    return messages[code] || '요청을 완료하지 못했습니다. 질문을 확인한 뒤 다시 보내 주세요.';
  }
  async submit() {
    if (this.send.disabled || this.sending) return;
    const draft = this.getDraft();
    const input = { ...draft, id: crypto.randomUUID(), problemId: draft.id, question: this.input.value };
    this.sending = true; this.error = ''; this.renderStatus();
    try {
      const result = await window.studyChat.send(input);
      if (!result.ok) this.error = result.message;
    } catch { this.error = '전송 요청을 처리하지 못했습니다. 질문은 유지됩니다. 다시 시도해 주세요.'; }
    finally { this.sending = false; this.renderStatus(); }
  }
  hasUnsaved() { return this.sending || Boolean(this.state.active) || [...this.drafts.values()].some(value => value.length); }
}
