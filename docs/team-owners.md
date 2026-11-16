# 기능별 책임과 실제 인수 현황

확인 시점: **2026-11-17 KST**, [Issue #13](https://github.com/dheorb/algorithm-study-desk/issues/13). 인수 기준 main: `cfbebe10d9c2e4ff9cfd7c613a34fea2c21eae0f`([PR #12](https://github.com/dheorb/algorithm-study-desk/pull/12) 병합). 이 문서는 책임과 확인 시점의 준비 상태를 기록하며 항상 실행 중인 세션 목록은 아니다. 재개할 때 총괄이 실제 Orca 연결과 Issue의 최신 배정을 확인한다. 일시적인 handle·Task/Dispatch ID는 영구 주소로 싣지 않는다.

## 책임 영역

| 도메인 | 기본 책임 | 공유 계약 |
| --- | --- | --- |
| 코드 편집기 | [code-editor.js](../src/code-editor.js), CodeMirror 편집·찾기/바꾸기·undo/redo·키보드, 문제 전환 시 편집 상태 연결 | 문제 ID·초안, 전환 취소/확정·저장 잠금, 같은 문제의 문서/선택/이력 보존 |
| AI 대화 | [chat-panel.js](../src/chat-panel.js), [chat-service.cjs](../src/chat-service.cjs), [chat-store.cjs](../src/chat-store.cjs), [codex-provider.cjs](../src/codex-provider.cjs), [ai-tutor.txt](../src/ai-tutor.txt), [process-supervisor.cjs](../src/process-supervisor.cjs) | 선택 문제·전송 시점 초안, 제한된 chat IPC, 별도 대화 저장, 앱 종료와 요청 취소 |
| 학습 데이터·추천 | 향후 문제 출처/정규화, 학습 이력 의미, 추천 로직·결과 계약 | 안정된 문제 ID, 날짜·추천 근거·부족/실패 상태; 세부 정책은 미래 Issue에서 결정 |
| 앱 기반·실행 자동화 | Electron 시작/종료, 공통 저장·IPC, 앱 자동실행·스케줄, 빌드/패키징 | 공통 생명주기·저장 형식·프로세스와 화면 전달 |
| 독립 검토 | 각 영역 변경 및 공유 계약·통합 사용자 흐름을 최신 head에서 독립 검증 | 대상 SHA, 실제 실행/관찰, 미확인 범위, 필수 수정 여부 |

기본 책임은 변경 요청 창구다. 공유 `renderer.js`/`index.html`/`styles.css`는 화면 연결, `main.cjs`/`preload.cjs`는 IPC·생명주기, `store.cjs`는 ChatStore가 상속하는 공통 저장 기반이다. 다른 전문가도 공유 변경을 요청할 수 있으며 총괄이 **Issue별 실제 작성자·입출력/오류/상태 계약·병합 순서·통합 책임자**를 배정한다. 다른 담당의 브랜치를 직접 덮지 않는다. `process-supervisor.cjs`는 **Codex 요청 수명 관리의 AI 영역**이며 일반 앱 로그인 후 자동실행/스케줄 기능이 아니다.

## 실제 구현 전담 인수

표시 이름은 사람이 창을 구별하는 이름이며 역할/공간/브랜치와 별개다. 공간이 생성됐거나 담당이 착수했다는 사실을 인수 완료로 바꾸지 않는다.

| 역할 / 작업창 표시 이름 | 실제 작업공간 | 확인한 브랜치 / 기준 | 생성·착수·인수 상태와 근거 |
| --- | --- | --- | --- |
| AI 대화 담당 / **AI 대화 · 구현** | `/home/dheorb/orca/workspaces/algorithm-study-desk/implement-study-record` | 이번 임시 문서 작업: `dheorb/domain-team-workflow`, 위 main 기준; 이전 `dheorb/problem-ai-chat` 보존 | 기존 공간/담당 유지, 이번 착수 확인, **AI 인수 준비 완료**: [인수 댓글](https://github.com/dheorb/algorithm-study-desk/issues/13#issuecomment-6929421391) |
| 코드 편집기 담당 / **코드 편집기 · 구현** | `/home/dheorb/orca/workspaces/algorithm-study-desk/code-editor-domain` | `dheorb/code-editor-domain`, 위 main 기준 | 총괄이 별도 Codex 생성·keep-open·착수를 확인, **편집기 인수 준비 완료**: [인수 댓글](https://github.com/dheorb/algorithm-study-desk/issues/13#issuecomment-6929493230) |

생성·표시 이름·착수의 총괄 확인은 [배정 기록](https://github.com/dheorb/algorithm-study-desk/issues/13#issuecomment-6929446345), 읽은 코드·계약·한계의 확인은 각 인수 댓글이 근거다. 두 담당 모두 이번 인수에서 제품 시험이나 실제 모델 호출을 반복하지 않았다. 인수 준비 완료는 이번 운영 문서 PR의 검토·병합이나 새 제품 기능 완성과 구분한다.

AI 담당의 운영 문서 작성은 Issue #13의 임시 배정이다. 후속 AI 기능은 해당 Issue에서 작업 브랜치를 정하며 이전 완료 브랜치를 강제 초기화하지 않는다. 같은 도메인은 기존 담당을 우선 이어 쓰되 총괄은 독립 작업/새 영역에 필요하면 추가 배치한다. 기존 총괄 Run은 유지한다.

| 지원/미래 역할 | 작업창과 공간 | 확인 시점의 배정 상태 |
| --- | --- | --- |
| 총괄 | **총괄 · Algorithm Study Desk**, 기존 `main` 공간 / `main` 브랜치 | 요구 분해·담당 선택/추가·계약 합의·통합/병합 순서·Issue/보드 상태 책임; 위 표시명은 총괄 확인 |
| 독립 검토 | **독립 검토 · 전체 흐름**, 기존 `review-study-record` 공간 | 기존 담당 유지; 이번 문서 PR의 대상 head/검토 브랜치는 검토 배정에서 확인. 두 전담 인수 근거와 최신 문서를 독립 검토 |
| 학습 데이터·추천 | 아직 작업창/공간/브랜치 없음 | **실제 전담자 미배정**, 관련 기능 Issue 착수 때 배치 |
| 앱 기반·실행 자동화 | 아직 작업창/공간/브랜치 없음 | **실제 전담자 미배정**, 관련 기능 Issue 착수 때 배치; 현존 공통 코드 변경도 총괄이 Issue별 작성자를 정함 |

## AI 인수에서 이어받은 계약과 근거

- 화면은 현재 문제·코드·메모·선택 아이디어 초안을 전송 시점에 고정한다. 대화 갱신으로 편집기의 문서/선택/이력을 초기화하지 않는다. `studyChat.load/send/cancel/retrySave/onState`는 제한된 preload API이며 main이 sender/frame을 검증한다. renderer에 실행 파일/명령/경로 권한을 주지 않는다.
- `ai-chat.json`은 기존 학습 파일과 별도다. 학습 v1/v2/v3와 원자 저장·복구 사본·외부 변경 감지를 유지한다. 초안/저장 실패 답변은 메모리 상태다. 한도 사전 거부는 전역 잠금을 만들지 않고, post-rename 불확실 기록/받은 답변은 같은 ID 저장 재시도로 보호한다.
- Codex **0.169.0**의 실행별 study-deny와 자동 맥락 제한을 유지한다. exec/wait 이름과 patch handler가 남으므로 도구 0개/모든 환경의 완전 격리를 주장하지 않는다. 감독은 같은 그룹 자손의 취소/deadline/부모 IPC 단절을 처리한다. 별도 그룹 이탈 자손·감독 자체 SIGKILL/SIGSTOP·OS 정지는 보장 밖이다.
- [011 구현 보고서](tasks/011-ai-chat-report.md)는 당시의 실패와 미확인 범위를 보존한다. 이후 [PR #12 최종 독립 검토](https://github.com/dheorb/algorithm-study-desk/pull/12#issuecomment-6914839343)는 검토 head `0f69723a2125ac56eb469fd1cfb7bf794622103a`에서 단위 35/35·Electron 41/41·권한 경계 19+설정 실패 2·P2 단언 2/2와 **새 감독 경로의 실제 합성 질문 1회/저장**을 확인했다. 구현 보고서 당시의 실제 응답 공백은 이 후속 근거로 해소됐으며 이번 인수에서 새로 호출한 것은 아니다.
- OS sandbox 활성, 직접 한글 IME, 네이티브 종료창 수동 클릭, 다른 OS/CLI와 실계정 장애별 재현은 여전히 미확인이다. 종료창 자동 시험의 반환값 대체와 알려진 비차단 CSP 진단을 구분한다.

## 편집기 인수에서 이어받은 계약과 근거

- [편집기 인수 댓글](https://github.com/dheorb/algorithm-study-desk/issues/13#issuecomment-6929493230)은 위 병합 main·실제 공간/브랜치·clean 상태와 읽은 코드/기록을 보고했다. 이번에는 읽기·인수만 했으며 제품·테스트·공유 운영문서 수정이나 설치/앱 실행을 하지 않았다.
- `CodeEditor.value`가 저장/AI에 전달할 문자열이다. 보이는 DOM 줄로 대체하지 않는다. 프로그램 `show`는 거짓 dirty를 만들지 않고, 같은 문제/같은 값은 문서·선택·이력을 유지한다. 실제 문제 전환·값이 바뀐 전체 버리기에는 이력을 초기화하며 재시작 뒤 undo는 복원하지 않는다. 편집 후 최초 개행 종류로 직렬화하고 최초 문서까지 undo하면 원래 혼합 개행을 반환한다.
- `renderer`의 draft/baseline/busy·전환 보호, 제한된 학습 IPC, post-rename 실패의 새 library/ID 반영과 초안 보존을 공유한다. AI 스냅샷은 학습 초안의 소비자이며 대화 갱신으로 에디터/학습 baseline을 덮지 않는다. 학습 저장 가능한 큰 코드도 AI의 별도 맥락 한도를 넘을 수 있으므로 자동으로 잘라 보내거나 수정하지 않는다.
- 후속 검증은 로컬 build, 단위, 실제 Electron 키보드/일반 텍스트 붙여넣기·검색/치환 undo·A/B·미저장 전환 취소·선택/스크롤·지연 잠금·연속 저장 실패·LF/CRLF/혼합 개행·새 PID 복원을 포함한다. [009 보고서](tasks/009-cpp-editor-report.md)의 당시 19/32와 PR #12 최종 검토의 35/41은 기존 근거다. 직접 IME·OS sandbox·네이티브 종료창 수동 확인과 알려진 CSP 진단의 제한은 유지한다.

## 후속 변경의 검증과 기록

AI 상태/저장/프로세스 변경은 `npm test`의 chat/process 회귀, UI/저장 접점 변경은 `xvfb-run -a npm run test:e2e`의 A/B·초안·새 PID·연속 저장 실패·편집기 상태·취소 시험을 선택한다. provider/권한/자동 맥락 변경은 `node scripts/verify-codex-boundary.cjs`로 합성 경계를 검증하고 실제 모델 요청과 분리한다. 편집기 변경은 [009 보고서](tasks/009-cpp-editor-report.md)와 해당 인수 댓글의 후속 검증 범위를 따른다. 시험은 작업별 합성 `/tmp`·`STUDY_DESK_DATA_DIR`와 자기 시험 자식만 사용한다.

이번 Issue는 코드/계약 읽기와 운영 문서·템플릿 검증이다. 위 제품 검증 수치는 **병합 기준의 기존 근거**이며 인수 담당이 이번에 제품 시험을 재실행했다는 뜻이 아니다. 문서 PR은 링크·YAML/구조·용어·운영 가능성·diff와 최신 head 필수 GitHub `unit-tests`를 확인한다. 독립 검토·정상 병합·Issue/보드 완료는 총괄이 조율한다. 자세한 절차와 자동실행/추천의 미구현 예시는 [팀 운영 규칙](team-workflow.md)을 따른다.
