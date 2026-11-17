# T180 A2 · 개인 관리 개요 구현

- 담당: Codex design / CX-DESIGN-01
- 배정: Master `msg_01be37702c82` A2 구현. 수락·파일 범위 전달 `msg_f82d90c2bdfb`.
- 기준: `b54b68e` (A1 polling 복구 포함), 2026-11-17 Asia/Seoul.
- 상태: ready_review · 제작자 자체 검수. 독립 검수/운영 반영 완료가 아니다.

## 변경한 화면

기존 `/settings` 안에 **저장 점검·작업 처리기·이 환경의 백업** 세 개요 카드와 필요한 문제만 보여 주는 “먼저 확인할 것” 요약을 추가했다. 원래 남색/민트/크림 토큰과 공통 Card·Callout·StatusPill을 사용했다. 새 관리자 셸이나 계정·권한·원격 제어는 만들지 않았다.

- 실제 A1 `startupSummary`와 단일 `snapshot`을 읽는 상태 없는 `SettingsOverview`를 추가했다. 데이터 복제 store나 새 요청/polling은 없다.
- 저장 점검 warning/fail, 처리기 응답 없음, 백업 파일 없음, 마지막 성공보다 뒤의 백업 실패 기록, 읽기 실패를 해당 점검/작업/백업 영역 링크로 연결했다. 문제가 없으면 경고 요약을 숨긴다. 과거 실패를 미해결 장애로 합산하지 않는다.
- 시작 점검 통과와 전체 기능 검증, 처리기 응답과 작업 성공/프로세스 종료, 성공 백업 이력과 현재 파일 존재를 구분한다. 현재 환경의 lastSuccess/lastFailure는 서비스 집계를 그대로 사용한다. 이전 환경·출처 미확인 rows로 이를 채우지 않는다.
- 읽기 실패 시 개요의 처리기·백업 카드는 “마지막 읽은 상태”와 기존 관찰 시각을 표시한다. 새 정상 상태라고 표시하지 않는다. 성공 복구 후 실제 snapshot을 다시 표시한다.
- “한눈에 보기 / 백업 / 새 폴더 복원”은 일반 anchor다. 해당 영역을 키보드로도 직접 찾을 수 있게 id·제목 연결·`tabIndex=-1`을 붙였다. tab panel로 숨기거나 SettingsPanel을 재생성하지 않는다.
- 백업과 복원 폼은 같은 DOM/state 안에 유지했다. 전체 이력 목록도 잘라 숨기지 않았다. 중복 “지금 백업” 버튼을 개요에 만들지 않고 링크로 폼에 이동한다.
- 기존 모드/제공사 안내 카드는 백업·복원 다음으로 옮겼다. 실제 샘플/생성 잠김·P3 안내는 유지했다. 활동 기록 링크는 기존 `/history?type=activity`를 사용한다.
- PC는 개요3열, 390px은 고정된 점검→처리기→백업 순서의1열이다. 전용 CSS는 토큰만 사용한다. 페이지 안 링크·보조 조작은44px 이상, 폼 버튼은48px 이상이다.

주 메뉴명과 settings page 제목은 **A3 범위**로 남겼다. 이번에 studio shell/page/auth를 수정하지 않았다. 기존 앱 정보 카드는 그대로이며 앱 정보 영역까지의 페이지 안 이동 통합도 A3에서 마무리할 수 있다.

## 검증과 증거

| 검증 | 결과 |
|---|---|
| 신규 개요 의미 검증 | 8개 통과: 고정 순서/상세 링크, warning·heartbeat·파일 없음, 이전 환경/출처 미확인 분리, 이전/최근 실패 구별, queued/running, stale, startup fail |
| 관련 자동 시험 | **8파일·67개 통과** (기존59 + 신규8) |
| 전체 lint / TypeScript / diff check | 모두 exit0 |
| 정상·주의·빈 목록·이전 환경·진행 중 ×1280/390 | **10개 배치 확인 통과**, 넘침0·최소 조작 높이44px·입력 이름 누락0·중복id0·개요 순서 고정 |
| 키보드·anchor·초안·읽기 실패/복구·검사 ticket·복원 실패 유지 | **23개 확인 통과**, 주 복원 버튼48px 확인 |
| 자동 갱신 실패/복구 ×1280/390 | **4개 확인 통과**, 입력 초점·폴더 초안·개요 순서 유지 |

근거: [배치 JSON](T-180-A2-LAYOUT-AUDIT.json), [상호작용 JSON](T-180-A2-INTERACTION-AUDIT.json), [자동 갱신 JSON](T-180-A2-POLLING-AUDIT.json).

캡처: [정상 PC](T-180-A2-ASSETS/normal-1280.png), [정상390](T-180-A2-ASSETS/normal-390.png), [주의 PC](T-180-A2-ASSETS/warning-1280.png), [주의390](T-180-A2-ASSETS/warning-390.png). 네 이미지를 직접 확인했다. 가짜 데이터 검수 표기가 있는 실제 Panel 번들 캡처이며 현재 사용자 상태나 운영 앱 전체 캡처가 아니다.

시험 명령:

```text
node node_modules/vitest/vitest.mjs run tests/t180-a2-settings-overview.test.ts tests/t180-a1-settings-data.test.ts tests/maintenance-routes.test.ts tests/startup.test.ts tests/startup-storage.test.ts tests/t177-button-reason.test.ts tests/backup-origin.test.ts tests/restore.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js . --max-warnings 0
git diff --check
```

브라우저는 Ego TaskSpace12와 별도 정적 서버3185에서 실제 SettingsPanel·공통 UI·새 CSS를 esbuild로 묶어 검증했다. fetch만 가짜 성공/실패/검사 응답으로 대체했다. 검증 스크립트는 `tmp/t180-a2/round-04.mjs`(23개), `round-05.mjs`(10개), `round-06.mjs`(4개). 브라우저 공간과 검수 서버는 종료했다. 임시 번들/도구는 커밋하지 않는다.

자체 검수에서 전용 `.panel button` 규칙이 공통 large 버튼의48px을44px로 덮는 것을 발견했다. 전용 폼 버튼 최소값을48px로 고친 뒤 상호작용·전체 배치 검증을 다시 실행해 통과했다. 테스트 fixture의 origin 타입도 실제 BackupScreenData row형으로 명시해 타입 검사를 통과시켰다.

## 변경 범위와 남은 것

제품: `components/settings-panel.tsx`, 새 `settings-overview.tsx`·`settings-overview.module.css`. 신규 시험, 이 고유 보고서, 감사 JSON3개와 캡처4개를 추가했다. 기존 A1의 읽기/작업 오류 분리·요청 순번·복원 ticket/sessionStorage/검사·완료·초점 로직은 리팩터링하지 않았다.

서비스/API/DB/마이그레이션/권한·실제 백업/복원/3013/공유 `.next`·build·배포는 실행/변경하지 않았다. 실제 Next 전체 셸·인증·운영 API의 E2E·실제 폰·스크린리더는 미확인이다. 원본 시작 점검 실패 시 DB 읽기를 막는 page 경계는 유지되며 기존 A1 시험으로 확인했다. 현재 Vercel의 클라우드 준비 화면이 이 개요로 대체됐다고 주장하지 않는다.

동시 작업 중 나타난 인증/로그인 관련 파일과 착수 시 미추적 Master plan/T122/T137 문서는 보존하고 커밋에 포함하지 않는다. Master의 A2 수용/필요한 독립 검수 후 A3 주 메뉴명·제목·앱 정보 연결이 다음 범위다.

복사용 전달 메시지: T180 A2 개요 구현 반환합니다. 실제 A1 데이터 기반 점검/처리기/이환경백업3카드·문제요약·페이지 안 이동을 추가하고 기존 백업/복원 폼·전체 이력·초안/ticket/A1오류복구를 유지했습니다. 읽기실패는 마지막자료로 표시, 이전환경/파일없음/실패기록 의미를 구분했습니다. 신규8 포함67 시험·전체lint·tsc·양폭배치10·키보드/초안/ticket23·자동갱신초점4 확인 PASS, 캡처4장 포함. 서비스/API/DB/3013/.next/배포 변경 없음. 주메뉴/제목과 앱정보 anchor 통합은 A3로 남겼습니다.
