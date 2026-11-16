# C++ 코드 편집기 구현 보고

- 범위: [Issue #9](https://github.com/dheorb/algorithm-study-desk/issues/9), `AGENTS.md`, `docs/team-workflow.md` 및 [독립 검토 준비](https://github.com/dheorb/algorithm-study-desk/issues/9#issuecomment-6911751999).
- 작업공간: `/home/dheorb/orca/workspaces/algorithm-study-desk/implement-study-record`.
- clean 상태 확인·fetch 후 기준 main `b36582cf5155914997e0d6c7c488511ed8a9de7e`에서 `dheorb/cpp-editor` 생성. 기존 완료 브랜치와 보고서 보존.
- [기술·정책 댓글](https://github.com/dheorb/algorithm-study-desk/issues/9#issuecomment-6911800447)에 실제 선택을 기록했다. 최신 head와 실제 CI 결과는 PR 본문에 기록한다.

## 구현과 사용

풀이 코드 textarea를 CodeMirror 6 편집기로 바꾸고 C++ 구문 강조, 줄 번호, Enter 자동 들여쓰기, Tab/Shift+Tab, 대응 괄호·자동 닫기, undo/redo를 제공한다. Ctrl+F 또는 **코드 찾기·바꾸기**를 열어 현재 코드의 이전/다음 문자열, 한 곳/모두 바꾸기를 사용한다. 대소문자를 구분하고 정규식·이스케이프는 해석하지 않는다. 빈 검색어는 작업하지 않으며 빈 치환값은 삭제다. 검색창 Enter/Shift+Enter는 다음/이전, Esc는 닫고 코드로 돌아간다.

Ctrl+Z는 취소, Ctrl+Shift+Z/Ctrl+Y는 다시 실행이며 한국어 버튼도 제공한다. Tab/Shift+Tab은 새 공백 4칸 단위이고 기존 탭은 문자 그대로 보관하며 폭 4로 표시한다. **Esc 후 2초 안에 Tab**은 편집기 밖으로 이동한다. Ctrl+M은 Tab 이동 모드 토글이다. 저장/Ctrl+S는 기존처럼 코드·자유 메모·선택 아이디어 전체를 저장한다.

실제 A/B 문제 전환은 새 EditorState로 이력을 초기화한다. 같은 문제의 코드 값이 같으면 아이디어 선택/추가·패널 열기/닫기에서 기존 문서·커서·선택·이력을 유지한다. 높이 변경에 따라 스크롤은 가능한 범위로 조정된다. 취소/Esc는 문서나 이력을 바꾸지 않는다. 전체 버리기로 코드가 바뀌면 저장본과 빈 이력으로 돌아가 버린 코드를 undo로 되살리지 않는다. 저장 자체는 이력을 유지하고 저장 경계, 각 들여쓰기·바꾸기 명령의 undo 단위를 구분한다. 앱 재실행 후 이력 복원은 범위 밖이다.

내부 문서는 LF로 표시하되 최초 원문과 첫 개행 종류를 함께 보관한다. 코드 미편집 저장과 최초 문서로 돌아온 undo는 원래 문자열을 그대로 반환한다. 코드 편집 후에는 첫 개행 종류(LF/CRLF/CR, 없으면 LF)로 저장하며 혼합 개행은 이때 통일된다. 탭/공백·끝 개행은 임의로 제거하지 않는다. v3 저장 형식과 v1/v2 이전·복구 사본·저장 계층은 수정하지 않았다.

저장/추가 잠금은 editable과 readOnly facet, changeFilter, 버튼 비활성화를 함께 사용한다. DOM 잠금 외에도 undo/redo·치환·붙여넣기·잘라내기·드롭 경로를 막는다. Ctrl+S에서 contenteditable 변경으로 잃는 코드 포커스는 완료/실패 후 다른 컨트롤로 이동하지 않았을 때 복원한다. 저장 실패는 초안·현재 선택·패널·코드 이력을 보존한다.

## 의존성·빌드·보안

| 패키지 | 고정 버전 | 사용 |
| --- | --- | --- |
| @codemirror/state | 6.7.6 | 문서/상태, 잠금 compartment/filter |
| @codemirror/view | 6.43.15 | 편집 화면, 줄 번호, 선택, 키맵, CSP nonce |
| @codemirror/commands | 6.11.1 | 키보드 편집, 이력, 들여쓰기, Tab 탈출 |
| @codemirror/language | 6.13.1 | 구문 강조·들여쓰기·괄호 대응 |
| @codemirror/lang-cpp | 6.0.3 | 공식 C++ 언어 정보 |
| @codemirror/search | 6.7.2 | 문자열 검색·다음/이전·치환 |
| @codemirror/autocomplete | 6.20.4 | closeBrackets만 사용, 자동완성 미활성 |
| esbuild | 0.28.2 | 로컬 browser IIFE 빌드, 개발 의존성 |

모두 MIT이며 lockfile에 전이 버전과 무결성도 고정한다. 실제 번들에 들어간 전이 패키지의 LICENSE 전문은 빌드 시 `dist/THIRD_PARTY_NOTICES.txt`에 모은다. lang-cpp 공식 GitHub의 최신 소스 이전 안내를 확인했다. CodeMirror 문서 사이트는 403이어서 공식 npm 패키지 README·배포 소스·index.d.ts의 API 설명을 함께 읽었다. esbuild 공식 API도 확인했다. 링크는 README에 있다.

`scripts/build.cjs`는 로컬 `dist/renderer.js`를 생성한다. Chromium 150 대상으로 빌드했고 실제 실행은 Electron 45.3.2 / Chromium 156.0.8078.100이다. `npm run build` 외에 prestart/pretest:e2e에서 자동 빌드하며 dist는 Git 제외다. 기존 CI workflow는 수정하지 않았다.

`script-src 'self'`, Node 차단·context isolation·제한 preload/IPC·외부 탐색/권한 차단을 유지한다. CodeMirror의 런타임 스타일 태그에는 고정된 스타일 전용 nonce를 전달하고 해당 nonce만 CSP style-src에 추가했다. unsafe-inline/unsafe-eval·CDN·원격 스크립트·개발 서버는 없다. 테스트용 main 프로세스 관찰/오류 주입 외에 제품용 테스트 IPC나 편집기 디버그 API를 추가하지 않았다.

## 조건별 검증

| 완료 조건 | 실행·근거 |
| --- | --- |
| C++ 강조·줄 번호·키보드 | 실제 Electron에서 키워드 색과 줄 번호, 괄호 자동 닫기/대응 표시, Enter·여러 줄 Tab/Shift+Tab, undo/redo, Esc→Tab 탈출을 확인했다. 일반 화면 캡처도 직접 확인했다. |
| 현재 코드 문자열 찾기/바꾸기 | 다음/이전의 실제 선택 위치, `a.*`와 `$&` 리터럴, 한 곳/모두/빈 값 치환, 치환별 undo, 결과 없음/빈 검색어, A/B·메모·아이디어 분리를 파일과 전체 문서로 비교했다. |
| 최신 코드 저장·dirty·실패 | 실제 붙여넣기와 Ctrl+S, 저장 전후 undo/redo의 상태, 실제 chmod 권한 오류에서 파일·코드 위치·초안·이력 유지, 권한 복구 뒤 재시도와 새 PID를 확인했다. |
| 전환·코드 상태 | A/B 새 이력, 계속 편집/Esc 후 선택·커서·스크롤 그대로, 같은 문제 아이디어 전환/추가·패널 열기/닫기의 이력/위치 유지, 전체 버리기 후 이력 초기화, 740px 화면을 확인했다. |
| 진행 중 잠금·기존 회귀 | 저장·문제 추가·아이디어 추가의 실제 파일 I/O를 지연해 타이핑·괄호·Enter·Tab·붙여넣기·잘라내기·드롭·undo/redo·바꾸기·선택·중복 Ctrl+S를 시도하고 최초 코드/메모/아이디어 스냅샷을 확인했다. #8의 연속 실패 재확인 ID 보존, 다른 문제 pending ID와 별도 저장 후 새 추가 회귀도 유지했다. |
| v1/v2/v3·개행·재시작 | 합성 CRLF 기록에서 읽기 무변경/깨끗한 상태, 아이디어만 저장 시 코드·기존 시각 보존, v1/v2 원래 바이트 복구 사본, 한글/이모지·탭/공백·여러 줄 실제 붙여넣기·끝 개행·빈 코드·SIGKILL/정상 종료 후 새 PID를 확인했다. LF 기록은 기존/새 편집 테스트, 혼합 개행은 원문 유지와 편집 후 통일·undo·실패 재시도로 확인했다. |
| 기존 저장 방어 | 저장 계층 19개를 그대로 실행해 입력/개수/전체 파일 크기·손상/미지원 구조·외부 변경·원자 교체·백업·이전 실패를 확인했다. 저장 계층 제품/단위 테스트는 변경하지 않았다. |
| 설치·실행·문서 | clean npm ci와 dist 없는 build, dist 없는 npm start와 e2e 자동 빌드, 임시 데이터 실행, 라이선스 파일 생성을 확인했다. 정책/단축키/미확인 범위를 Issue 댓글·README·이 문서에 기록했다. |
| 독립 실제 검토·병합 | 구현자 제출 이후 총괄과 검토 담당이 진행할 후속 단계다. |

기존 textarea 단언은 실제 포커스·Ctrl+A·클립보드 붙여넣기로 바꿨고, 내용 단언은 가상 스크롤 바깥을 포함한 전체 CodeMirror 문서를 읽는다. 현재 고정된 view 버전의 DOM 소유 view를 **읽기 전용 관찰**에 사용하며 문서/선택/이력을 API로 직접 조작하지 않는다. 파일/복원/실패 단언을 삭제하지 않았다. 클립보드는 Xvfb 테스트 디스플레이에서만 사용한다.

## 명령과 실제 결과

환경: Ubuntu 26.04.1 LTS, Node 22.22.1, npm 9.2.0, Electron 45.3.2, Playwright 1.65.1.

```bash
npm ci
npm run build
npm test
xvfb-run -a npm run test:e2e
git diff --check
```

- npm ci: 종료 0, 34개 설치, 감사 취약점 0개. 생성된 dist를 지운 뒤 build도 종료 0.
- npm test: **19/19 통과**, 실패·건너뜀 0.
- dist를 다시 지운 뒤 `xvfb-run -a npm run test:e2e`: pretest:e2e의 자동 빌드 후 **32/32 통과**, 실패·건너뜀 0.
- diff 검사: 오류 없음.

별도 `/tmp/study-desk-editor-start-nguP14/start-smoke.cjs`에서 dist를 지운 뒤 `npm start -- --no-sandbox --remote-debugging-port=0`을 실제 실행했다. prestart가 번들을 생성했고 임시 데이터의 편집기·줄 번호·ready 상태를 CDP로 관찰했다. 읽기만 해서 study-record.json은 생성되지 않았으며 테스트 앱 창을 닫아 npm 프로세스가 종료 0인 것을 확인했다. 디버깅 포트는 이 테스트 프로세스의 관찰용이며 제품 실행 스크립트에 추가하지 않았다. 사용자 Orca 작업 창은 유지한다.

사용자 기록과 분리한 일반 실행:

```bash
STUDY_DESK_TEST_DIR=$(mktemp -d /tmp/study-desk-editor-manual-XXXXXX)
STUDY_DESK_DATA_DIR="$STUDY_DESK_TEST_DIR" npm start -- --no-sandbox
# 저장하고 종료한 뒤 같은 경로로 다시 실행
STUDY_DESK_DATA_DIR="$STUDY_DESK_TEST_DIR" npm start -- --no-sandbox
```

실제 캡처는 test-results의 `cpp-editor.png`, `cpp-narrow.png` 및 임시 시작 검증의 `npm-start.png`를 직접 확인했다. 기존 실패/이전/재시도 캡처도 테스트 실행 시 계속 생성된다. 결과와 번들은 Git에 넣지 않는다.

## 제한과 남은 작업

- OS sandbox 비활성 상태에서 검증했다. OS sandbox 활성, 직접 한글 IME 조합 입력, 네이티브 종료 대화상자 수동 조작은 미확인이다. Unicode 자동 붙여넣기/키 입력을 직접 IME 검증으로 간주하지 않는다.
- CDP의 insertText로 구문 색이 있는 선택 영역을 한 번에 교체할 때 Chromium이 색상 인라인 스타일을 보존하려다 기존 CSP에 차단되는 진단을 관찰했다. CSP를 완화하지 않았고 실제 키보드/일반 텍스트 클립보드 붙여넣기로 검증했다. 이 자동 입력 진단을 일반 IME 동작으로 확대 해석하지 않는다.
- 실제 전원 차단·하드웨어 오류·외부 프로그램과의 모든 쓰기 경쟁은 미확인이다. 사용자 실제 앱 데이터·원본 학습 폴더·인증 파일은 읽거나 수정하지 않았다.
- CodeMirror 문서/이력·검색 상태는 실행 중 메모리에만 있다. 이력 앱 재실행 복원, 자동완성/LSP, 컴파일/실행/채점, AI, 외부 서비스/배포는 이번 범위 밖이다.
- 최신 head 독립 실제 검토·필요한 수정·정상 병합·Issue/Projects 완료는 총괄이 조율한다. GitHub CI는 실제 run/check 결과를 PR에 기록하며 #4 임시 예외와 로컬 성공을 CI 통과로 표현하지 않는다.
