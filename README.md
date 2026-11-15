# Algorithm Study Desk

개인용 코딩테스트 학습 앱. 이 저장소는 Orca의 총괄·구현·검토 에이전트가 작은 작업을 나눠 개발하는 첫 실습이다.

## 첫 기능

문제 하나의 연습용 코드를 열고, 코드와 학습 메모를 수정·저장한 뒤 앱 종료 후 재실행해도 같은 내용을 복원한다.

첫 문제는 사용자의 기존 `데이터분석/sol1.cpp`를 복사해 사용한다. 원본은 수정하지 않는다. 문제 설명 원문과 프로그래머스 채점 결과는 포함하지 않는다.

## 역할

- 총괄: 프로젝트 `main`의 총괄 대화. 작업 정의, 구현·검토 담당 배정, 결과 취합.
- 구현: 첫 기능 구현과 검증, 실행 방법 작성.
- 검토: 요구사항과 실제 동작을 독립적으로 확인하고 수정 필요 사항 보고.

상세 요구사항: [첫 작업](docs/tasks/001-study-record.md)

## 팀의 작업 진행 보기

- [작업 목록](https://github.com/dheorb/algorithm-study-desk/issues): 요구사항, 완료 조건, 담당 역할과 진행 보고.
- [작업 보드](https://github.com/dheorb/algorithm-study-desk/projects): 대기·진행 중·검토 중·막힘·완료 상태.
- [검토할 변경](https://github.com/dheorb/algorithm-study-desk/pulls): 코드 차이, 테스트와 독립 검토 결과.
- [팀 운영 규칙](docs/team-workflow.md): Issue를 먼저 기록하고 배정하는 절차와 상태 변경 책임.

사용자는 총괄에게 대화로 요청한다. 총괄은 Issue를 작성하고 담당자에게 링크를 전달하며, 구현·검토 담당은 같은 Issue를 기준으로 작업한다. 총괄이 결과를 확인해 PR을 병합한다. 첫 기능은 GitHub 연결 전에 로컬에서 검토·병합했으며 기존 커밋 이력을 그대로 보존했다.

GitHub Actions의 `unit-tests`는 저장 계층 테스트만 실행한다. 앱 화면과 재시작 동작은 관련 변경의 PR에서 별도 통합 검증 근거를 남긴다.

## 설치와 실행

2026-11-15에 Ubuntu 26.04.1 LTS, Node **22.22.1**, npm **9.2.0**, Electron **45.3.2**, Playwright **1.65.1**에서 확인했다. Node 22.12 이상이 필요하다. 버전은 `package-lock.json`에 고정되어 있다.

```bash
npm ci
npm start
```

Electron 바이너리는 첫 실행 때 내려받을 수 있으므로 첫 설치·실행에는 인터넷이 필요하다. 앱에는 별도 빌드나 서버가 없고, 실행 후에는 네트워크 없이 동작한다.

**현재 작업 컴퓨터의 실행 제한:** 이 Ubuntu 환경에서는 위 `npm start`가 Chromium의 `SUID sandbox helper` 오류로 종료된다. 사용자 네임스페이스도 허용되지 않아 `--disable-setuid-sandbox`만으로 해결되지 않았다. OS 설정은 변경하지 않았다. 이 컴퓨터에서 실제 실행을 확인한 로컬 개발 명령은 다음과 같다.

```bash
npm start -- --no-sandbox
```

이 옵션은 Chromium의 **OS 프로세스 샌드박스를 끈다**. 개인 로컬 개발을 위한 임시 실행 방법이며, 기본 스크립트에는 넣지 않았다. renderer의 Node 접근 차단, context isolation, 제한된 preload/IPC는 유지된다. 일상 사용·배포 전에는 시스템 관리자가 [Chromium의 Ubuntu 샌드박스 안내](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)를 참고해 해당 실행 파일의 샌드박스를 정상 구성해야 한다. 이 환경에서 샌드박스가 켜진 실행은 확인하지 못했다.

앱에서 **풀이 코드**와 **생각해볼점**을 편집하고 **저장** 또는 **Ctrl+S**를 누른다. `저장 완료`가 표시된 후 종료하고 같은 명령으로 다시 열면 복원된다. 저장 중 추가 편집한 내용은 미저장으로 남으며, 미저장 변경을 닫으려 하면 확인 대화상자를 표시한다. 자동 저장은 하지 않는다.

## 기록 보관과 실패 처리

- 기본 기록: Electron `appData` 아래 고정 폴더 `algorithm-study-desk/study-record.json`. 일반 Linux에서는 `~/.config/algorithm-study-desk/study-record.json`이며 `XDG_CONFIG_HOME` 설정에 따라 달라질 수 있다. 화면의 **기록 보관 위치**에서 실제 경로를 확인한다.
- 앱 버전이나 worktree 이름을 경로에 포함하지 않는다. 여러 작업공간에서 실행해도 같은 사용자 기록을 읽고, 같은 데이터 폴더를 사용하는 앱은 하나만 실행한다.
- 파일에는 스키마 버전, 고정 문제 ID, 코드, 메모, 저장 시각을 기록한다. 기존 기록이 있으면 샘플로 덮어쓰지 않는다. 빈 코드·빈 메모도 유효한 기록이다.
- 같은 폴더에 권한 `0600`인 임시 파일을 만들고 내용을 동기화한 후 원자적으로 교체한다. 교체 전 정상 기록은 `study-record.json.bak`에 한 세대 보관한다. 저장 성공은 파일과 디렉터리 동기화가 끝난 뒤에만 표시한다.
- 권한·용량·쓰기 오류 시 성공으로 표시하지 않고 편집 내용과 재시도 버튼을 유지한다. 파일 교체 후 동기화가 실패한 경우 디스크에는 새 내용이 있을 수 있으므로 상태는 **저장 확인 실패**로 표시한다.
- 손상된 JSON, 지원하지 않는 스키마, 잘못된 필드, 너무 큰 파일은 저장을 차단한다. 앱을 연 뒤 외부에서 기록이 변경·삭제된 경우도 덮어쓰지 않는다.
- 손상 파일을 자동으로 초기화하거나 백업으로 자동 복구하지 않는다. 앱을 닫고 원본과 `.bak`을 **다른 이름으로 복사해 보존**한 후 내용을 확인한다. 복구할 정상 백업을 선택해 `study-record.json`으로 복사하고 앱을 다시 연다. 저장 오류 화면에 편집 내용이 있다면 먼저 별도로 복사해 둔다.

일반 로컬 파일시스템을 대상으로 한다. 저장 도중 외부 프로그램이 같은 파일을 고치는 경쟁, 실제 전원 차단·하드웨어 고장까지 보장하지 않는다. `.bak`은 전체 변경 이력이 아니다. 비정상 종료로 남은 `.tmp` 파일을 자동 복원하거나 삭제하지 않는다.

## 검증

```bash
npm test
xvfb-run -a npm run test:e2e
```

실제로 저장 계층 **5개**, Electron 통합 **5개**가 통과했다. GUI가 있는 환경에서는 `npm run test:e2e`로도 실행할 수 있다. `xvfb-run`이 없는 환경은 별도로 Xvfb를 설치해야 한다. Playwright는 설치된 Electron을 사용하므로 별도의 Playwright 브라우저 설치는 필요 없다.

통합 테스트는 Linux에서 Playwright의 기본 설정인 OS 샌드박스 비활성 상태로 실행한다. 샌드박스를 구성한 시스템에서는 `STUDY_DESK_TEST_SANDBOX=1 xvfb-run -a npm run test:e2e`로 활성화할 수 있지만, 이 명령은 현재 컴퓨터에서 통과를 확인하지 않았다.

검증 내용:

1. 샘플 코드 표시, 한국어 메모 입력, IPC 저장 후 JSON 파일의 실제 값 확인.
2. 저장 완료 후 Electron **주 프로세스 SIGKILL** 및 새 PID 재실행으로 코드·메모 복원 확인. 빈 문자열 저장과 정상 종료 후 복원도 확인.
3. 테스트 폴더를 `chmod 500`으로 바꾸어 실제 쓰기 권한 오류 유발. 오류 상태, 편집 내용·기존 파일 보존, 권한 복구 후 재저장·재실행을 확인. root로 실행하면 이 검증은 건너뛰므로 일반 사용자로 실행한다.
4. 손상·미지원 버전·잘못된 입력·외부 변경·삭제를 덮어쓰지 않는지, 백업 실패 시 이전 파일과 임시 파일 정리가 안전한지 확인.
5. renderer에서 `require`·`process`가 없고 `load`·`save` 두 API만 노출되는지 확인. 미저장 종료는 네이티브 대화상자의 반환값을 테스트에서 '돌아가기'로 대체해 편집 내용 유지 확인.

통합 검증은 매번 `/tmp/study-desk-e2e-*`를 만들고 끝나면 제거한다. 사용자 기록을 건드리지 않는다. 화면 캡처는 `test-results/`에 남으며 저장 완료, 권한 실패, 손상 파일 화면을 직접 확인했다. 테스트 결과와 캡처는 Git에서 제외한다.

수동 확인도 사용자 기록과 분리할 수 있다. 같은 임시 경로를 다시 사용해야 재시작 복원을 확인할 수 있다.

```bash
STUDY_DESK_TEST_DIR=$(mktemp -d /tmp/study-desk-manual-XXXXXX)
STUDY_DESK_DATA_DIR="$STUDY_DESK_TEST_DIR" npm start -- --no-sandbox
# 앱에서 저장 후 종료하고, 같은 셸에서 다시 실행
STUDY_DESK_DATA_DIR="$STUDY_DESK_TEST_DIR" npm start -- --no-sandbox
```

샌드박스가 정상 구성된 시스템에서는 `--no-sandbox`를 빼고 실행한다. `STUDY_DESK_DATA_DIR`는 저장소 밖의 절대 경로여야 한다. 이 환경변수를 사용하면 기록뿐 아니라 Electron의 사용자 데이터·캐시·실행 잠금도 분리된다.

## 구성과 참고 문서

- `src/main.cjs`: 창, 데이터 경로, 단일 실행 잠금, IPC 발신자 검증. 외부 탐색·새 창·권한 요청 차단.
- `src/preload.cjs`: 고정된 `load()`와 `save({code, notes})` API만 공개. 임의 파일 경로나 IPC 채널을 받지 않는다.
- `src/store.cjs`: 스키마 검사, 변경 감지, 백업·원자적 저장. renderer에는 파일시스템이나 프로세스 API를 노출하지 않는다.
- `src/renderer.js`, `src/index.html`, `src/styles.css`: 한국어 편집 화면, 저장·오류·미저장 상태. 외부 스크립트·폰트·네트워크 요청 없음.

구현 시 확인한 공식 문서: [Electron 보안](https://www.electronjs.org/docs/latest/tutorial/security), [preload와 IPC](https://www.electronjs.org/docs/latest/tutorial/ipc), [앱 데이터 경로와 실행 잠금](https://www.electronjs.org/docs/latest/api/app), [Node 파일시스템](https://nodejs.org/api/fs.html), [Playwright Electron](https://playwright.dev/docs/api/class-electron), [Ubuntu AppArmor](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).

첫 기능에는 C++ 실행·채점, 여러 문제, AI 대화, 추천, 외부 제출을 포함하지 않는다. 샘플 알고리즘의 정답 여부는 검증하지 않았다. 조건별 구현 결과는 [구현 보고서](docs/tasks/001-implementation-report.md)에 기록하며, 독립 검토는 별도 검토 담당의 작업이다.
