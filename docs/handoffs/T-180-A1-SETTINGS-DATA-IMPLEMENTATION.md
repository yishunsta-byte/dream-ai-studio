# T180 A1 · 개인 관리 데이터·문구 연결

- 담당: Codex design / CX-DESIGN-01
- 배정: Master `msg_a93a3d6bcff8`의 “관리자 구현 / T180 A1구현”. A1 범위 착수 전달 `msg_0ea0b4b8d2ef`.
- 기준: `e7269adbb1bd814b4069bdea5fbce4fe12ab5df0`, 2026-11-17 Asia/Seoul
- 상태: ready_review. 구현자 자체 검증이며 독립 검수·제품 배포 완료가 아니다.

## 구현

T180 계획 7장의 **A1 데이터·문구 확정**을 구현했다. `/settings`와 기존 화면 제목은 유지했다. A2 개요 3카드·문제 요약 배치, A3 메뉴명·페이지 안 이동은 이번 배정으로 확대하지 않았다.

1. `app/(studio)/settings/page.tsx`에서 기존 `checkStartup()`을 한 번 호출하고, 실제 `checks`·`canStart`와 읽은 뒤의 ISO `checkedAt`을 `startupSummary`로 전달한다. 새 점검이나 점검 polling을 추가하지 않았다.
2. 시작 점검 실패 시 백업·처리기·백업 설정·복원 이력을 읽지 않는 경계를 유지했다. 어느 설정 읽기라도 실패하면 오류 안내를 반환하고, 가짜 빈 목록이나 정상 값으로 바꾸지 않는다.
3. 백업·처리기 등의 초기 읽기가 끝난 시각을 `initialReadAt`으로 별도 전달한다. 점검과 백업이 같은 시각의 원자적 전체 상태라고 표시하지 않는다.
4. `components/settings-panel.tsx`는 현재 백업 DTO와 `readAt`을 하나의 `snapshot` state로 소유한다. 수동 갱신·기존 queued/running 2초 polling 모두 성공적으로 JSON을 읽은 뒤에만 자료와 시각을 함께 바꾼다. 실패하면 기존 자료·시각·폴더 초안을 유지한다.
5. 저장 점검의 통과/확인 필요 문구와 점검 읽은 시각, 백업·처리기 상태를 마지막으로 읽은 시각을 표시한다. “작업 처리기 켜짐/꺼짐”은 **최근 응답 있음/최근 응답을 확인하지 못함**으로 바꾸고, 종료·작업 성공 판정이 아님을 안내한다.
6. polling이 복구되면 해당 polling 읽기 오류만 지운다. 다른 요청의 실패 메시지를 성공 polling으로 지우지 않는다. 복원 ticket·sessionStorage·검사/완료/초점 로직은 수정하지 않았다.

## 검증

- 관련 시험 **7파일·59개 통과**: 신규 A1 7개 및 maintenance-routes, startup, startup-storage, t177-button-reason, backup-origin, restore.
- 신규 시험: 점검 단일 호출과 직렬화 가능한 독립 시각, 시작 실패 때 DB 의존 읽기 차단, 네 읽기 단계별 실패/빈 상태 구별, warning·heartbeat 문구와 시간 의미.
- 전체 eslint, `tsc --noEmit --incremental false`, `git diff --check` 통과. `next typegen`이나 공유 `.next`를 생성하는 검사는 실행하지 않았다.
- Ego Browser TaskSpace 51: **격리된 실제 SettingsPanel 번들**에 가짜 fetch 응답을 주입해 10개 확인 통과. 수동 갱신 실패/성공, 서로 다른 두 시각, 초안 보존, polling 실패/복구, 오류 해소, 빈 상태·1280/390 가로 넘침0을 확인했다. [검증 JSON](T-180-A1-UI-AUDIT.json).
- 브라우저 검증은 임시 `tmp/t180-a1/`의 esbuild 번들·정적 서버 3184를 사용했다. 실제 `/api`·사용자 DB·운영 3013에 요청하지 않았다. 프레임워크가 주입하는 `process.env`는 이 독립 번들에서만 빈 객체로 제공했다. 앱 셸/실제 Next 라우팅·인증·운영 API·실제 백업/복원의 E2E 검증은 아니다.
- 캡처 `tmp/t180-a1/settings-1280.png`, `settings-390.png`를 직접 확인했다. 긴 경로를 넣어도 가로 넘침 없고 입력 초안이 남았다. 임시 번들·서버·캡처는 커밋에 포함하지 않으며 검증 서버와 브라우저 공간은 종료했다.
- 초기 브라우저 검증기의 “대기 중” 기대값은 실제 공통 상태 명칭 “대기”와 달랐다. 현재 DOM을 확인한 뒤 대기 행 존재로 검증 조건을 수정했고 최종 10개가 통과했다. 최초 독립 번들에는 Next가 보통 주입하는 `process`가 없어 뜨지 않았으며, 임시 검증 환경만 보완했다.

## 범위·제한·후속

제품 변경은 settings page와 panel 두 파일이다. 신규 시험 한 파일과 이 고유 보고서/감사 JSON만 추가했다. 서버 서비스·API·DB·인증·마이그레이션·공용 셸·시안·공유 문서·운영 배포는 변경하지 않았다. 착수 시 미추적 Master plan/T122/T137 문서를 보존했다.

현재 `readBackups()`의 반환 추론형은 빈 목록 때 실제로 반환하는 null과 배열 인덱스 추론에 차이가 있어, 신규 빈 목록 fixture에만 명시적 type assertion을 사용했다. 서비스 계약을 이번 UI 배정에서 변경하지 않았다. 화면은 기존 nullable 방어를 유지한다.

실제 데이터/실제 폰/스크린리더·전체 앱 셸·production build는 검증하지 않았다. 공유 3013이 `next start`이므로 운영 `.next`를 덮지 않았다. 이 작은 A1은 UI 단위·타입·회귀·격리 브라우저 검증까지이며, 운영 반영 전에는 Master의 통합·필요한 별도 빌드/검수가 남는다.

다음 A2는 이 `startupSummary`와 panel의 단일 `snapshot`을 사용해 T180의 개인 관리 개요를 배치하면 된다. 날짜는 점검 관찰 시각과 백업 응답 읽은 시각이며 백업 완료 시각/worker heartbeat 원시 시각을 대신하지 않는다. 백업 lastSuccess/lastFailure는 서비스가 제공한 이 환경 집계를 계속 사용한다.

복사용 전달 메시지: T180 A1 구현 반환합니다. settings의 기존 시작 점검 결과를 1회 읽어 startupSummary로 연결하고 점검/백업 읽은 시각을 분리했습니다. panel은 백업 DTO와 시각을 단일 snapshot으로 소유하며 실패 시 자료·시각·초안 유지, 성공 시 함께 갱신합니다. 처리기 켜짐/꺼짐을 최근응답 문구로 수정했고 polling 복구 때 그 오류만 해소합니다. 신규7 포함 관련59 시험·전체lint·tsc·격리브라우저10 확인 통과. 시작fail/읽기실패/restore ticket 경계 유지, 3013/DB/공유.next/배포 미실행. A2 개요와 A3 메뉴명은 별도 배정 범위로 남겼습니다.
