# Issue #11 — 문제별 Codex 학습 대화

2026-11-16, 구현 담당. 기준 main `a97fbc72502eb83b31f1d941bb4301503dd04161`, 작업 브랜치 `dheorb/problem-ai-chat`. 최신 제출 head와 GitHub CI 결과는 PR에 기록한다. 독립 기능 검토·필수 CI 확인·병합·Issue/보드 완료는 총괄의 후속 단계다.

## 결과와 사용 방법

문제별 AI 패널, 전송 시점의 고정 맥락, 질문·답변의 별도 로컬 저장, 실패·취소·저장 재시도를 구현했다. 초기 read-only 후보의 파일 읽기 문제를 재현해 연결을 보류했고, 독립 기술 검토가 제안한 공식 실행별 권한 프로필을 적용한 뒤 경계 재검증과 실제 제품 응답 확인을 마쳤다. 과거 실패를 성공으로 바꾸지 않았으며 아래에 구분해 보존한다.

```bash
npm ci
npm run build
STUDY_DESK_TEST_DIR=$(mktemp -d /tmp/study-desk-ai-manual-XXXXXX)
STUDY_DESK_DATA_DIR="$STUDY_DESK_TEST_DIR" npm start -- --no-sandbox
# 종료 뒤 같은 디렉터리로 재실행
STUDY_DESK_DATA_DIR="$STUDY_DESK_TEST_DIR" npm start -- --no-sandbox
```

PATH의 Codex **0.169.0**, Codex 자체 로그인, **/usr/bin/timeout**이 필요하다. 이 환경의 timeout은 **uutils coreutils 0.10.0**이다. 앱은 인증 파일·토큰·사용자 config를 직접 읽거나 변경하지 않는다. 지원 밖 버전이면 추론을 시작하지 않고, 실행 파일 부재/설정 오류 뒤 권한을 낮추거나 다른 연결로 fallback하지 않는다. 기존 로그인은 Codex가 자체 관리한다. AI 없이도 기존 학습 기록 기능을 사용할 수 있다.

**AI 대화 열기 → 질문 입력 → 질문 보내기 / 다시 보내기**로 사용한다. **현재 요청 취소**는 질문 초안을 유지한다. **대화 저장 재시도**는 이미 받은 답변의 로컬 저장만 다시 하며 모델을 재호출하지 않는다. 패널을 닫거나 문제를 왕복해도 질문 초안을 유지한다. 답변은 일반 텍스트이며 실행하거나 코드에 적용하지 않는다.

## 전송과 저장 계약

- 클릭 시 문제 ID·요청 UUID·질문과 맥락을 고정한다. 제목·코드·자유 메모·선택 아이디어는 화면값(미저장 포함), 다른 아이디어는 저장값이다. 다른 문제·원본 자료·다른 앱 대화는 수집하지 않는다. 전송은 학습 기록 저장을 대신하지 않는다.
- 최근 완료 이력 최대 **6쌍·24 KiB**를 포함한다. 오래된 이력부터 제외하며 포함/제외 수를 각 시도에 표시한다. 질문 **4,000 UTF-16 단위**, 질문+현재 학습 스냅샷 **64 KiB** 초과는 잘라 보내지 않고 거부한다. 응답은 **48 KiB**까지다.
- 앱 전체에 활성 요청 하나다. 중복 클릭과 이미 처리한 UUID를 거부한다. 요청 중 다른 문제로 이동해도 원래 문제에 답변을 저장한다. 취소/종료 뒤 늦은 응답·중복 완료는 무시한다. 다시 보내기는 현재 맥락의 새 시도·새 UUID이고 이전 실패·취소 기록은 유지한다.
- `study-record.json` v1/v2/v3는 기존 저장 계층을 유지한다. 대화만 저장하면 이 파일을 쓰거나 이전하지 않는다. 코드·메모·아이디어 저장과 대화 저장은 서로 다른 파일이라 오래된 전체 library로 서로를 덮지 않는다.
- 대화는 앱 데이터 디렉터리의 **ai-chat.json**, `schemaVersion:1`, `entries` 배열이다. 항목은 요청/문제 ID, 질문, 답변, 상태, 안전한 오류 코드, 시각, 이력 포함/제외 수다. 전체 코드 스냅샷은 중복 저장하지 않는다. 문제당 200개/전체 1,000개/파일 8 MiB 제한이다.
- 대화 저장도 기존 파일시스템 원시 동작을 재사용해 임시 쓰기·fsync·원자 교체·한 세대 **ai-chat.json.bak**·외부 변경 감지를 수행한다. 초기 요청 기록 저장이 실패하면 모델 호출 전 멈춘다. 답변 저장 실패는 화면 Q/A와 원래 요청 ID를 유지한다. rename 후 sync 실패 → 별도 학습 저장 → 재확인 교체 전 실패 → 다음 재시도에서도 동일 요청 1개만 남는다.
- 손상/미지원 대화 파일은 원본을 자동 초기화하지 않고 AI만 차단한다. 원본과 .bak를 보존·복구한 뒤 다시 불러온다. 이미 연 뒤 외부 변경이 발생한 파일은 덮어쓰지 않으며 현재 화면 내용을 보관하고 앱을 다시 열어 확인한다.
- 새 프로세스는 이전 `running`을 `interrupted`로 읽고 무한 전송 중으로 복원하지 않는다. 보내지 않은 초안과 저장 실패 답변은 메모리 상태이므로 종료 보호 안내를 제공한다. 종료 취소는 요청과 편집을 유지한다.

## 연결 방식과 실제 제한

`src/codex-provider.cjs`는 고정 모델 **gpt-6.1-sol**과 `exec --json --ephemeral --ignore-user-config --ignore-rules --strict-config`를 선택했다. 요청은 셸 문자열 대신 argv와 stdin JSON이다. app-server의 확인한 시작 도움말에는 `--ignore-user-config` 대응 옵션이 없고 `dynamicTools:[]`도 내장 handler 제거의 근거가 되지 않아 사용하지 않았다.

매 요청은 앱 소유의 빈 /tmp 디렉터리에서 실행한다. HOME/CODEX_HOME은 기존 값을 유지하고 PATH/LANG/LC_ALL/TMPDIR 외 앱·Orca 환경을 상속하지 않는다. CLI 자신의 임시 로그/상태 경로만 그 디렉터리에 지정하고 그 내용을 수집하지 않는다. 정상 완료/오류 뒤 폴더를 제거하지만 강제 종료로 남은 폴더는 자동 복구하지 않는다.

공식 명명 프로필을 실행별 인자로 적용한다. **--sandbox read-only, sandbox_mode, sandbox_workspace_write와 혼용하지 않는다.**

```text
-c default_permissions="study-deny"
-c permissions.study-deny={filesystem={"/"="deny"},network={enabled=false}}
```

shell/이미지/앱·MCP/플러그인/브라우저·검색/스킬/메모리/하위 에이전트/Code Mode host 등을 개별 제한한다. 프로젝트 지침 예산 0, 자동 스킬/환경/앱/협업/권한 맥락 제외, 앱 지정 tutor 안내를 사용한다. tutor는 문제 원문·제약·채점 결과가 없음을 알리고 부족한 조건을 질문하도록 한다. 프롬프트만으로 권한을 막았다고 주장하지 않는다.

**functions.exec/wait 이름과 숨은 apply_patch handler는 남는다.** exec/wait는 host-disabled, 다른 직접 호출은 unsupported, patch는 프로필의 읽기/쓰기 거부로 제한한다. 모델 통신·CLI 자체 인증·앱 소유 임시 상태 생성은 이 도구 권한과 별개다. 네트워크 false만으로 hosted search나 MCP를 막았다고 주장하지 않는다. 이 설치 버전/구성의 관찰이며 모든 OS의 완전 격리나 도구 0개를 의미하지 않는다.

`/usr/bin/timeout --signal=TERM --kill-after=1s`를 통해 버전 확인은 5초, 추론은 60초로 제한한다. 앱이 SIGKILL로 종료돼도 별도 deadline이 자기 자식을 종료하도록 합성 프로세스로 확인했다. 정상 취소는 자신의 프로세스 그룹에 TERM 후 KILL을 보낸다. stdout/stderr 합계 256 KiB 초과, 깨진 JSONL, 마지막 개행 없음, 응답 없는 종료, nonzero exit를 처리한다. UTF-8 청크는 경계에서 결합한다. raw stderr·원시 진단·인증정보는 UI/기록에 저장하지 않는다. 설치된 버전에서 확인한 두 고정 item.error 경고만 정상 완료와 함께 허용하고 다른 오류를 성공으로 숨기지 않는다.

공식 자료: [비대화형 CLI](https://learn.chatgpt.com/docs/non-interactive-mode), [설정](https://learn.chatgpt.com/docs/config-file/config-reference), [0.169.0 schema](https://raw.githubusercontent.com/openai/codex/rust-v0.169.0/codex-rs/core/config.schema.json), [app-server](https://learn.chatgpt.com/docs/app-server), [독립 기술 검토](https://github.com/dheorb/algorithm-study-desk/issues/11#issuecomment-6913535499).

## 경계 재현과 과거 실패 보존

```bash
node scripts/verify-codex-boundary.cjs
# 과거 read-only 후보 비교: 격리 미충족으로 종료 1이 예상됨
node scripts/verify-codex-boundary.cjs --legacy-read-only
```

재현은 인증 불필요한 loopback 모의 provider만 사용하며 실제 모델 요청은 없다. 제품의 buildArgs/childEnvironment/runProcess/tutor/model을 직접 가져오고 목적지와 인증 불필요 provider만 시험용으로 바꾼다. 요청 헤더는 수집하지 않는다. 초기 입력은 별도 도구 정의 + 정확한 tutor developer 문자열 + 합성 user JSON으로 단언한다. 그 외 입력은 없어야 하며 후속에는 주입 tool/result 한 쌍만 허용한다. 원래 조사의 모호한 `instructionsMatch:false/inputOnlySynthetic:false/unexpectedMarkers:[token]` 검사식은 developer 메시지와 도구 설명을 분리하지 못한 것으로, 현재 검증에는 사용하지 않는다.

모든 대상은 본인이 만든 /tmp canary와 PNG다. 기존 파일의 atime을 2000년으로 설정하고 도구 호출 후 **검증 코드의 내용 읽기 전에 stat**하여 접근 시각을 비교한다. 이후 원래 바이트 불변과 새 파일 미생성도 확인한다.

| 구성/시점 | 실제 결과 | 근거 |
| --- | --- | --- |
| 최초 read-only 후보 | 13개 경우에서 숨은 patch의 내용 검사/없는 파일 읽기 오류, 쓰기 거부; **isolationSatisfied:false·종료 1** | `/tmp/study-desk-codex-boundary-p5QAm8/summary.json` |
| 독립 기술 검토 | 기존 읽기를 atime 변화로 재현, 명명 프로필 4개 좁은 후보 확인 | `/tmp/study-desk-boundary-review-011-7xvrugqr/review.md` |
| 제품 명명 프로필, timeout 보완 전 | 19개 경우 읽기/변경 없음, 설정 오류 2개는 모델 요청 0 | `/tmp/study-desk-codex-boundary-3a2g6O/summary.json` |
| 최종 제품 명명 프로필 + timeout | **19개 + 설정 오류 2개, isolationSatisfied:true·종료 0** | `/tmp/study-desk-codex-boundary-tbCXJH/summary.json` |

최종 행렬은 도구 없는 대조군, exec/wait, exec_command/shell_command/shell/read_file, patch add·cwd 안팎 update·delete·없는 fixture, view_image, web_search, 합성 MCP 이름, spawn_agent, 미등록 도구다. patch update/delete는 기존 파일이 있어도 읽기 전 접근 거부와 atime 불변을 확인했다. 존재하지 않는 프로필·잘못된 permission 값은 모델 요청 없이 실패했다. 초기 read-only 문제를 사후 kill 또는 프롬프트로 해결하지 않았다.

## 실제 모델 시험과 파일 동일성

실제 질문은 두 단계에서 각 1회였다. 최소 연결 가능성 시험과 최종 제품 연결 시험을 구분한다.

1. 초기 조사(이전 tutor·read-only·timeout 보완 전): 종료 0, `turn.completed`, `1 + 1은 2입니다.`. `/tmp/study-desk-ai-probe-evxoir1y/real-summary.json`. 이는 과거 연결만 증명하며 당시 격리 실패를 무효화하지 않는다.
2. **최종 명명 프로필 및 timeout 보완 후**, 실제 Electron main → ChatService → CodexProvider → CLI 경로, 새 합성 문제에서 질문 `합성 확인: 1 + 1의 값만 한 문장으로 답하세요.`를 1회 전송했다. `1 + 1의 값은 2입니다.`가 completed로 ai-chat.json에 저장됐고 study-record.json 바이트는 그대로였다. PID **904964**, 요청 시각 **2026-11-16T10:24:07.410Z**, `/tmp/study-desk-real-product-SnlhLX/result.json`, `real-product.png`이며 캡처를 직접 확인했다. 가짜 provider를 끼우지 않았다. 추가 실제 호출은 하지 않았다.

아래 SHA-256은 최종 경계 재현 및 실제 제품 질문에 사용한 파일과 같다. timeout 보완은 실제 질문 **이전**에 적용됐고 이후 제품 provider/tutor/경계 스크립트는 변경하지 않았다. 검토자는 PR 파일 해시와 비교할 수 있다.

| 파일 | SHA-256 |
| --- | --- |
| src/codex-provider.cjs | `271f96989768e38daa69f054ead8ba4817a1d3c374fd326a2574b27c6badbd79` |
| src/ai-tutor.txt | `75f07f6ea5e2ea823fa758bdd47c7d72fc014459778532fb997e453a30859fe0` |
| scripts/verify-codex-boundary.cjs | `0407752b739dee3012c8d8f717cfa8d7ce8d98204aa2f06ea60f8f4d2f7fd5dd` |
| 실행 Codex 0.169.0 바이너리 | `b452ca20f838a8855a88a41050ee4a694033fff4ea3ecdad5633e6e0e8d13f2b` |

## 기능 검증과 남은 범위

- `npm run build`: 통과. 로컬 번들과 기존 CSP 유지, 추가 npm 의존성 없음.
- `npm test`: **29/29 통과**, 건너뜀 없음. 기존 저장 19개와 대화 스냅샷/이력 제한/소속, 동시 요청·ID 중복, 취소·늦은 응답, 응답 저장 연속 실패, 초기 저장 실패, v1/v2/v3 보존, 손상/권한/외부 변경, UTF-8 분할/JSONL/출력 제한/시간초과/버전·설정 실패 및 caller 강제 종료 뒤 자식 종료를 검증했다.
- `xvfb-run -a npm run test:e2e`: **38/38 통과(41.4초)**, 기존 32개 회귀 유지. AI 응답은 fake provider다. A/B·미저장 스냅샷·답변 귀속·새 PID 복원, HTML 안전 표시, 질문 초안/취소/늦은 응답, post-rename→학습 저장→pre-rename 실패→같은 ID 재시도, 권한 오류, 손상 대화와 학습 저장 분리, 지연 학습 저장 중 답변 도착, 편집기 이력 유지, 종료 취소, 지원 밖 CLI UI 오류를 확인했다.
- 기존 #8 아이디어 연속 실패 재시도와 #9 CodeMirror/개행/이력/미저장 보호를 그대로 통과했다. v1/v2 합성 기록은 코드·메모·시각·원래 복구 바이트를 유지하고, 대화만 기록할 때 학습 원본을 쓰지 않는 별도 검증도 통과했다.
- 넓은 화면/740px 대화 화면, 최종 실제 응답 화면을 직접 확인했다. 캡처는 test-results와 위 /tmp에 있고 Git에는 포함하지 않는다. 테스트/미리보기는 합성 /tmp + STUDY_DESK_DATA_DIR만 사용했다.
- `git diff --check`: 통과. 실제 사용자 앱 데이터·원본 학습 자료·인증 파일·계정/보호 설정을 변경하지 않았다. GitHub CI의 실제 결과는 PR에서 따로 확인하며 로컬 성공을 CI 성공으로 바꾸지 않는다.

OS sandbox 활성 실행, 직접 한글 IME 조합, 네이티브 종료창 수동 클릭, 실제 전원 차단/하드웨어 고장, 다른 OS·다른 Codex 버전은 미확인이다. 종료창 자동 검증은 반환값을 대체했다. PR #10의 알려진 비차단 CSP 진단은 완화하지 않았다. 학습 답변 정확도/정답 통과 보장, 실제 네트워크·사용량 장애의 원인별 실계정 재현은 범위 밖이며 합성 오류 처리와 구분한다. 최종 독립 기능 검토와 필수 CI·정상 병합은 총괄이 진행한다.
