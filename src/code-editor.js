import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, undo, redo,
  undoDepth, redoDepth, temporarilySetTabFocusMode } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, SearchQuery, setSearchQuery, findNext, findPrevious, replaceNext, replaceAll } from '@codemirror/search';

// This adapter owns only the active problem. Programmatic loads are not edits.
export class CodeEditor {
  constructor(parent, onChange) {
    this.locked = true;
    this.problemId = null;
    this.raw = this.initial = '';
    this.separator = '\n';
    this.lock = new Compartment();
    this.find = document.querySelector('#code-find');
    this.replace = document.querySelector('#code-replace');
    this.feedback = document.querySelector('#search-status');
    this.searchBox = document.querySelector('#code-search');
    this.controls = [...document.querySelectorAll('.code-tools button, #code-search input, #code-search button')];
    this.onChange = onChange;
    this.view = new EditorView({ parent, state: this.createState('') });
    const command = (id, run) => document.querySelector(id).addEventListener('click', () => {
      if (!this.locked) { run(); this.updateControls(); }
    });
    command('#code-undo', () => { undo(this.view); this.view.focus(); });
    command('#code-redo', () => { redo(this.view); this.view.focus(); });
    command('#find-next', () => this.searchCommand(findNext));
    command('#find-previous', () => this.searchCommand(findPrevious));
    command('#replace-one', () => {
      const query = this.query();
      if (!query.valid) return this.emptyQuery();
      const selection = this.view.state.selection.main;
      if (this.view.state.sliceDoc(selection.from, selection.to) !== query.search && !findNext(this.view)) {
        this.feedback.textContent = '검색 결과가 없습니다.';
        return;
      }
      this.searchCommand(replaceNext, '한 곳을 바꿨습니다. Ctrl+Z로 취소할 수 있습니다.');
    });
    command('#replace-all', () => this.searchCommand(replaceAll, '모두 바꿨습니다. Ctrl+Z로 취소할 수 있습니다.'));
    for (const input of [this.find, this.replace]) input.addEventListener('input', () => {
      if (!this.locked) { this.query(); this.feedback.textContent = this.find.value ? '대소문자를 구분하는 현재 코드 문자열 검색' : '검색어를 입력하세요.'; }
    });
    this.searchBox.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); if (!this.locked) this.searchCommand(event.shiftKey ? findPrevious : findNext); }
      if (event.key === 'Escape') { event.preventDefault(); this.searchBox.open = false; this.view.focus(); }
    });
    this.updateControls();
  }
  createState(value) {
    return EditorState.create({ doc: value, extensions: [
      cpp(), lineNumbers(), drawSelection(), highlightActiveLine(),
      syntaxHighlighting(defaultHighlightStyle), bracketMatching(), closeBrackets(), indentOnInput(),
      indentUnit.of('    '), EditorState.tabSize.of(4), history(), search(),
      EditorView.cspNonce.of('study-editor-style'),
      EditorView.contentAttributes.of({ 'aria-label': '풀이 코드', 'aria-describedby': 'code-help', spellcheck: 'false' }),
      this.lock.of([EditorState.readOnly.of(this.locked), EditorView.editable.of(!this.locked)]),
      EditorState.changeFilter.of(() => !this.locked),
      EditorState.transactionExtender.of(tr => tr.isUserEvent('input.replace') || tr.isUserEvent('input.indent') ? { annotations: isolateHistory.of('full') } : null),
      keymap.of([
        { key: 'Mod-f', run: () => { if (!this.locked) { this.searchBox.open = true; this.find.focus(); } return true; } },
        { key: 'Escape', run: temporarilySetTabFocusMode },
        ...closeBracketsKeymap, indentWithTab, ...historyKeymap, ...defaultKeymap
      ]),
      EditorView.updateListener.of(update => {
        this.updateControls();
        if (update.docChanged) this.onChange();
      })
    ] });
  }
  get value() {
    const text = this.view.state.doc.toString();
    return text === this.initial ? this.raw : text.replaceAll('\n', this.separator);
  }
  show(problemId, value) {
    if (problemId === this.problemId && value === this.value) return;
    this.problemId = problemId;
    this.raw = value;
    this.separator = value.match(/\r\n|\r|\n/)?.[0] ?? '\n';
    const state = this.createState(value);
    this.initial = state.doc.toString();
    this.view.setState(state);
    this.view.scrollDOM.scrollTop = this.view.scrollDOM.scrollLeft = 0;
    this.feedback.textContent = '검색어를 입력하고 다음/이전을 누르세요.';
    this.updateControls();
  }
  setLocked(locked) {
    if (this.locked === locked) return;
    if (locked) this.restoreFocus = this.view.hasFocus;
    this.locked = locked;
    this.view.dispatch({
      effects: this.lock.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]),
      annotations: isolateHistory.of('full')
    });
    // Changing contenteditable during Ctrl+S blurs Chromium's active element.
    if (!locked && this.restoreFocus && document.activeElement === document.body) this.view.focus();
    this.updateControls();
  }
  updateControls() {
    for (const control of this.controls) control.disabled = this.locked;
    if (!this.view) return;
    document.querySelector('#code-undo').disabled = this.locked || !undoDepth(this.view.state);
    document.querySelector('#code-redo').disabled = this.locked || !redoDepth(this.view.state);
  }
  query() {
    const query = new SearchQuery({ search: this.find.value, replace: this.replace.value, literal: true, caseSensitive: true });
    this.view.dispatch({ effects: setSearchQuery.of(query) });
    return query;
  }
  emptyQuery() { this.feedback.textContent = '검색어를 입력하세요.'; }
  searchCommand(command, success = '일치하는 문자열을 선택했습니다.') {
    if (this.locked) return;
    if (!this.query().valid) return this.emptyQuery();
    this.feedback.textContent = command(this.view) ? success : '검색 결과가 없습니다.';
  }
}
