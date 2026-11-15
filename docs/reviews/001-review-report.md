# 001 독립 기능 검토 보고

작성: 2026-11-15 / 검토 브랜치: `dheorb/review-study-record`

**판정: 첫 로컬 기능 인수 가능.** 저장·재실행 복원·권한 실패 처리·손상 파일 보존을 독립 실행으로 확인했고, 이번 범위의 필수 제품 수정은 발견하지 못했다. 현재 호스트에서 기본 `npm start`는 실패한다. OS sandbox를 끈 Electron 실행에서 기능을 확인했으므로 이 실행환경 제약을 완료 보고에 함께 명시해야 한다.

## 대상과 변경 범위

- 구현 대상: `dheorb/implement-study-record`, `f51e835a73e5c912aa31ecade5db9933846fb9d6`.
- 구현 위치: `/home/dheorb/orca/workspaces/algorithm-study-desk/implement-study-record`.
- 독립 실행 위치: `/home/dheorb/orca/workspaces/algorithm-study-desk/review-study-record`.
- 시작 시 `git status --short --branch`로 올바른 브랜치와 미커밋 변경 없음을 확인했다.
- 지시된 `git merge --no-edit f51e835a73e5c912aa31ecade5db9933846fb9d6`은 충돌 없이 성공했다. 병합 커밋은 `5bffeaeda5f4191e01bb24a91031b3486472224a`다.
- 준비 커밋 `9a56e7bb5f3dd15f1ac3ef681f80211928f9e143`과 [기존 체크리스트](001-checklist.md)는 그대로 보존했다. 체크리스트의 미실행 표기는 준비 당시 상태이며 실제 결과는 이 보고서에 기록한다.
- `AGENTS.md`, 작업 요구사항, 체크리스트, 대상 README와 구현 보고서를 읽고 제품 코드와 테스트를 검토했다. 구현 커밋 대비 제품 코드·테스트·패키지·README 차이는 없다. 검토자가 추가한 저장소 파일은 이 보고서뿐이다.

## 실제 실행과 결과

환경: Ubuntu 26.04.1 LTS, Node `v22.22.1`, npm `9.2.0`, 일반 사용자 UID `1000`. 프로젝트 의존성은 Electron `45.3.2`, Playwright `1.65.1`로 고정되어 있다.
로그와 별도 확인 자료는 `/tmp/study-desk-review-gHgsBR/`에 보관했다. 테스트 기록은 `/tmp/study-desk-unit-*`, `/tmp/study-desk-e2e-*` 및 위 검토 디렉터리만 사용했다. 기존 사용자 기록과 구현자가 열어 둔 앱 터미널에는 접근하지 않았다.

| 실행 명령 | 실제 결과 | 근거 파일 |
| --- | --- | --- |
| `npm ci` | 종료 코드 0, 16개 패키지 설치, 당시 npm 감사 결과 취약점 0개 | `npm-ci.log` |
| `npm test` | 종료 코드 0, 5/5 통과, 실패·건너뜀 0 | `unit.log` |
| `xvfb-run -a npm run test:e2e` | 종료 코드 0, 실제 Electron 통합 5/5 통과, 건너뜀 없음 | `e2e.log` |
| `STUDY_DESK_DATA_DIR=/tmp/study-desk-review-gHgsBR/default-start timeout 15s npm start` | 종료 코드 1, SUID sandbox helper 설정 오류 및 Electron SIGTRAP로 종료; timeout 만료가 아님 | `default-start.log` |
| `node /tmp/study-desk-review-gHgsBR/check-invalid-fields.cjs` | 종료 코드 0, 저장 파일의 메모 누락·숫자 타입 두 사례 모두 읽기 거부·저장 차단·파일 보존 통과 | `invalid-fields.log` 및 실행 스크립트 |

출력은 `set -o pipefail`과 `tee`로 기록해 원래 명령의 실패 상태를 보존했다. 기본 실행 재현 전에 시험 디렉터리를 만들고 해당 셸의 코어 덤프만 껐다. 시스템 보안 설정은 변경하지 않았다.

추가 검증은 기존 테스트가 직접 다루지 않은 **저장 파일 필드 누락·타입 오류** 두 사례에 한정했다. 저장소 테스트나 제품 코드를 수정하지 않았고 새 테스트 체계를 추가하지 않았다.

재현 시 검토 작업공간에서 `npm ci`, `npm test`, `xvfb-run -a npm run test:e2e`를 순서대로 실행하면 된다. 수동 창 실행은 README의 별도 `/tmp` 데이터 경로와 `npm start -- --no-sandbox` 방법을 따른다. 이번 검토에서는 이 대체 npm 명령을 별도로 실행하지 않았으며, UI 증거는 아래의 Playwright가 실행한 Electron 창에서 확보했다.

## 필수 조건별 판정

| 조건 | 판정 | 독립 확인 근거 |
| --- | --- | --- |
| 1. 샘플·코드·메모를 표시하는 실행 가능한 한국어 앱 | 통과, 호스트 제약 있음 | E2E에서 제목 표시, 초기 코드와 지정 샘플의 완전 일치, 빈 메모를 확인했다. 실제 창 캡처 3장을 직접 열어 한국어 라벨·입력 영역·저장 버튼·상태가 읽히는지 확인했다. 기본 실행 실패와 OS sandbox 비활성 조건은 아래에 명시한다. |
| 2. 코드와 메모 저장 후 실제 종료·재시작 복원 | 통과 | 두 영역을 모두 변경하고 저장 버튼을 눌러 JSON의 두 값과 비교했다. Electron 주 프로세스에 SIGKILL을 보내 `exit` 이벤트를 기다린 뒤 새 프로세스를 실행했으며 PID가 달라졌다는 단언과 두 편집값 완전 일치가 통과했다. PID 숫자 자체는 기본 테스트 로그에 출력되지 않는다. 빈 코드·메모의 Ctrl+S 저장과 정상 종료 후 복원도 통과했다. |
| 3. 저장 실패 표시·편집 내용 유지·재시도 | 통과 | UID 1000에서 시험 디렉터리를 `chmod 500`으로 바꿔 실제 권한 오류를 발생시켰다. 오류 상태와 권한 메시지, 코드와 메모 유지, 기존 JSON의 바이트 단위 동일성이 통과했다. `chmod 700` 복구 후 재저장 성공, 기존 파일의 `.bak` 보존, 앱 재시작 후 메모 복원도 통과했다. 이 재시도 테스트의 마지막 복원 단언은 메모만 비교하며, 코드와 메모 동시 복원은 앞 행의 별도 테스트에서 확인했다. |
| 4. 원본 학습 파일 보존 | 지정 파일 범위 통과 | 허용된 원본 `sol1.cpp`와 샘플을 실행 전후 SHA-256으로 비교했고 모두 아래 해시와 일치했다. 구현자 보고의 해시와도 같다. 제품의 샘플 접근은 읽기이며 저장은 앱 데이터 경로를 사용한다. 원본 폴더 전체나 과거 중간 상태를 검증했다고 주장하지 않는다. |
| 5. README에 확인한 설치·실행·검증 방법 | 통과, 제한 명시 | 설치와 단위·통합 명령을 독립 실행했다. 기본 npm 실행 실패가 README의 환경 제약 설명과 일치하며, 대체 실행 조건·시험 데이터 분리·손상 파일 복구 지침이 있다. |
| 6. 구현 보고와 독립 보고 | 통과 | `docs/tasks/001-implementation-report.md`와 이 보고서가 함께 존재한다. |
| 추가 필수: 손상 파일을 조용히 초기화하지 않음 | 통과 | 깨진 JSON에서 화면에 손상 오류와 보존·복구 안내가 보이고 저장 버튼이 비활성화됐다. 직접 IPC 저장도 거부하며 파일 내용이 그대로임을 확인했다. 미지원 스키마는 단위 검증, 필드 누락·잘못된 타입은 별도 임시 검증으로 보존을 확인했다. |

원본 해시 대상: `/home/dheorb/workspace/study/algorithms/programers/level1/데이터분석/sol1.cpp`

```text
d97ee9ac785ca9b000d602ee2a823a8f98ffff4f204aec0bab819d14c5e952b8
```

체크리스트 대응: M1~M5는 위 UI·E2E·저장 계층 근거로 확인했다. M7은 지정 파일 해시와 쓰기 경로·문서 검토 범위에서 통과했다. A1~A3은 기존 단위·E2E와 두 필드 오류 추가 확인으로 충족한다. M6은 **코드 검토 통과 / 작업공간·버전 간 실제 전환 미확인**이다. `src/main.cjs`의 기본 경로가 `appData/algorithm-study-desk`, 파일명이 `study-record.json`으로 고정되고 버전·작업공간을 포함하지 않음을 읽었으나, 사용자 기본 기록이나 다른 버전 앱으로 전환하는 실험은 하지 않았다.

## 직접 확인한 UI 근거

아래는 이번 독립 E2E 실행에서 생성한 실제 Electron 렌더링이다. 테스트 코드의 DOM 단언과 별개로 이미지 자체를 직접 열어 확인했다. 캡처와 로그는 Git에서 제외되며 `/tmp` 자료는 임시 증거다.

| 화면 | 직접 관찰한 내용 | 보관 사본 |
| --- | --- | --- |
| 저장 후 재실행 | 데이터분석 제목, 코드 편집 영역, 두 줄 한국어 메모와 이모지, `저장 완료` 상태가 보인다. 화면 밖 코드 전체의 일치는 테스트 단언으로 확인했다. | [restored.png](/tmp/study-desk-review-gHgsBR/ui/restored.png) |
| 권한 실패 | `// 저장 실패에도 보존할 코드`와 `사라지면 안 되는 메모`가 남아 있고, 붉은 권한 오류·편집 내용 유지 안내와 저장 버튼이 보인다. | [save-failure.png](/tmp/study-desk-review-gHgsBR/ui/save-failure.png) |
| 손상 파일 | 붉은 손상·지원하지 않는 형식 오류, 원본과 `.bak` 복사 보존 및 재시작 안내, 비활성 저장 버튼이 보인다. | [corrupt-record.png](/tmp/study-desk-review-gHgsBR/ui/corrupt-record.png) |

원래 캡처 위치는 검토 작업공간의 `test-results/study-record-edits-save-vi-8b37e-ctual-process-exit-relaunch/restored.png`, `test-results/study-record-real-permissi-5e7ca-tor-and-disk-retry-succeeds/save-failure.png`, `test-results/study-record-corrupt-data--9163a-ins-byte-for-byte-unchanged/corrupt-record.png`다.

## 남은 문제와 수정 필요 여부

- **알려진 호스트 실행 제약:** 기본 `npm start` 실패를 독립 재현했다. 단위 5개와 Electron 통합 5개가 통과했으며, Playwright는 이 실행에서 `chromiumSandbox: false`로 OS sandbox를 끈 상태였다. 첫 로컬 기능의 저장·복원 검토를 막는 사유로 보지 않으며, 기본 명령 실행과 샌드박스 활성 상태의 검증은 남아 있다. 일상 사용·배포 준비를 판단하려면 적절히 구성된 호스트에서 별도 확인해야 한다.
- **보안 설정과 검증을 구분:** E2E는 renderer의 `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` 설정값과 `require`·`process` 미노출, `load`·`save` 두 API를 확인한다. 이 설정값 통과가 OS sandbox 활성 실행의 증거는 아니다. 시스템 권한·소유자·AppArmor 설정을 변경하지 않았다.
- **수동 미확인:** OS 창 장식, 한국어 IME로 직접 타이핑, 네이티브 종료 확인 대화상자의 실제 마우스 선택은 확인하지 않았다. 종료 확인 테스트는 대화상자 반환값을 `돌아가기`로 대체하므로 해당 수동 동작의 증거로 사용하지 않는다. 코드·메모 입력과 저장 클릭은 실제 Electron의 Playwright 조작으로 확인했다.
- **검증 범위:** 다른 버전·작업공간의 동일 기록 공유는 소스 검토만 수행했다. 실제 전원 차단·디스크 고장·외부 동시 쓰기, C++ 정답·실행·채점, 패키징·배포는 이번 검토 밖이다.
- **구현자에게 필요한 수정:** 이번 필수 기능 인수를 막는 제품 수정 요청은 없다. 기본 실행의 환경 제약과 미확인 항목을 최종 사용자 안내에 유지해야 한다. 원본 폴더 수정, 실제 사용자 기록·인증 정보 접근, 외부 게시·푸시·배포, 다른 에이전트 시작은 수행하지 않았다.
