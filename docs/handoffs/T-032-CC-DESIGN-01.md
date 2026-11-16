# T-032 · DESIGN 6.7 · PLAN 13장을 P1 실제 구현에 맞춤

| 항목 | 내용 |
|---|---|
| 담당 / 지시 | Claude design (CC-DESIGN-01) / Master `msg_8f259b0929e3` |
| 기준 | HEAD `164ee8b` 코드(T-016 `500cd9d`, T-020 `51a3df4`, T-021 `75c023c`, T-022 `bc895cf`, T-023 `8808928`) |
| 바꾼 파일 | `docs/DESIGN.md` 6.7 + 변경 기록 1줄, `docs/PLAN.md` 13장 + 변경 이력 1줄, 이 파일 |
| 안 바꾼 것 | 코드, 캡처, TEAM, 시안(`prototype.html` 설정 화면은 예전 모양 그대로 — DESIGN이 우선) |
| 상태 | ready_review · 사용자 결정 없음 |

## 1. 요구 → 문서 → 코드 근거

| 문서에 쓴 규칙 | 코드 근거 |
|---|---|
| 마지막 성공·실패는 출처 local만, 복원으로 멈춤 제외 | `lib/services/backups.ts:39` `list()` — `local=rows.filter(origin==="local")`, `lastFailure`에 `!interruptedByRestore` |
| 출처 3종 판정(local/inherited/unconfirmed), 시계 비교 없음 | `backups.ts:21` `BackupOrigin`, `:38` `origin()` (restore.info `inheritedBackupIds`, 출처 표시 설정) |
| 출처 Badge 글자·설명 문장 | `components/settings-panel.tsx:23` `sourceLabel`, `:30` 목록 행 |
| StatusPill 판정 순서, "복원으로 멈춤" | `settings-panel.tsx:30` (interruptedByRestore → succeeded → canceled → failed → queued → running), `backups.ts:39` 오류 문장 순서 |
| 파일 없음 = 존재만 확인(해시 없음), "검증 이력" | `backups.ts:23` `fileAvailable`(lstat), `:39` `available`·`restorable`, 패널 Badge "검증 이력 · …" |
| 마지막 성공 " · 이 PC에 파일 없음" (설정·작업실) | `settings-panel.tsx:27`, `app/(studio)/page.tsx` 백업 칸 |
| 복원 고르기 비활성·안내·잠김 이유 | `settings-panel.tsx:32-33` |
| 검사 때만 재검증, `BACKUP_NOT_FOUND` 문장 | `lib/services/restore.ts:32` (lstat → fileDigest → zipSha256·size 대조 → manifest) |
| 목적지 경계 두 문장 | `lib/backup/paths.ts:51`, `:58` |
| 복원본 Callout 문장, 앱 정보에 날짜 없음 | `app/(studio)/settings/page.tsx` (T-016 · T-020) |
| 현재 날짜 표기 | `settings-panel.tsx:13` `date()` = `toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})` |
| 정보 카드 = Badge "앱 0.1.0 · 템플릿 {버전}" | `settings/page.tsx` |
| PLAN 13: `editing-{id}[_SAMPLE].zip`, 상위 폴더 없음 | `lib/services/exports.ts:31` `bundleFileName` |
| 장면 파일 이름 `{nn}_{장면ID}_v{n}[_SAMPLE].{ext}` | `exports.ts:38` `scenePath` |
| README·script·edit·subtitles(있을 때만)·provenance·review·fonts·LICENSES | `exports.ts:41-55` `bundleLayout` |
| 미리보기와 실제가 같은 경로 함수 | `exports.ts:40` 주석·`:72` 미리보기가 `bundleLayout` 사용 |
| 압축 없이(stored ZIP64), 15개(자막 없으면 14개)·약 2.4MB | `exports.ts:59-61`, R-017 ZIP 14/14·15/15, 캡처 `flow-08-v2.png` |

## 2. 일부러 하지 않은 것

- **미구현 제안을 현재 기준으로 올리지 않음:** 출처 백업 전용 칩, 복원본 칩·작업실 알림(T-017 4장), 날짜 함수 통일(T-017 5장), 백업 카드 간격(T-022), 390 실패 상자 폭·`/jobs` 순서(T-026 m1·m2) → DESIGN 6.7 "후속 권장" 줄에 모아 "현재 기준이 아니다"로 표시.
- 6.7의 작업 모드·제공사 연결·예산·보관함 줄은 이번 범위(백업·복원)가 아니어서 그대로 두었다.
- PLAN 13의 E-1~E-5 규칙, 13장 첫 문장은 그대로. `final/`·`captions/`는 이후 단계 표시로 남김.

## 3. 확인

- `git diff`로 두 문서의 바뀐 줄만 확인(DESIGN +8/−3 안팎, PLAN +13/−6 안팎). 6.7 표의 줄 수·구분선이 깨지지 않았는지 원문으로 확인.
- 문서 안 링크·경로 추가 없음(코드 경로는 글자로만). 앱 실행·브라우저 확인 없음(문서만 바꿈).
- 문장은 코드의 실제 화면 문구를 그대로 옮겼다(따옴표 안 글자).

## 4. 한계

- 코드는 읽기만 했고 화면을 새로 띄워 보지 않았다. 문구는 HEAD `164ee8b` 기준이며 이후 코드가 바뀌면 다시 맞춰야 한다.
- 시안(`prototype.html`) 설정 화면은 이번 허용 범위가 아니어서 예전 모양이다. 필요하면 별도 작업으로 맞춘다.
