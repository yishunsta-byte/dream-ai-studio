# T-063 · 타임라인 상세 명세를 P2-1 설계(T-060)에 맞춤

| 항목 | 내용 |
|---|---|
| 담당 / 지시 | Claude design (CC-DESIGN-01) / Master `msg_e858edd344fc` |
| 근거 | `docs/handoffs/T-060-TIMELINE-IMPLEMENTATION.md`(f8fe043) 2장·5.2·7장, Master 채택 D-1~D-10, T-033 U-1 |
| 바꾼 파일 | `docs/PLAN.md`(11.2 예시·규칙 표, 18장 P2-1 상태, 변경 이력), `docs/spec/text-presets.json`(specVersion, `migration.fromP1Values` 새 키, `secondsToFrames` 문장), 이 파일, 히스토리 |
| 안 바꾼 것 | 코드·SQL·0005·fixture, DESIGN, 시안, TEAM·REVIEW·PROGRESS, spec의 프리셋 값·`fromP1` 원래 문장 |
| 성격 | **P2-1 실제 착수 기록.** 완료·Remotion 시작 아님 |
| 상태 | ready_review · 사용자 결정 없음 |

## 1. 반영

| T-060 결정 | 반영 위치 |
|---|---|
| D-1 `durationFrames`, `sceneVersionId`·`assetId` null 빈 자리(렌더·최종 내보내기 거부) | PLAN 11.2 예시 + 규칙 표 "장면 길이"·"빈 자리" |
| D-2 글자 끝 상한 `max(영상 합계, 길이 초 × 30)`, 이관 때 자르지 않고 경고 | PLAN 11.2 표 + spec `fromP1Values.endFrameLimit` |
| D-4 열기만으로 버전 안 만듦 / D-10 명시 저장 API | PLAN 11.2 표 "저장" |
| D-5 깨진 포인터 이관 전체 실패, D-6 내용 버전·단계·검수 불변, D-7 r1 `content_revision` = 출처 스냅샷 | PLAN 11.2 표 "P1에서 옮기기" |
| D-3 P1 save-edit 410 전환, D-8 SOURCE/TIMEOUT, D-9 s5, source 동봉·CLI/production Next·오류 안내 | PLAN 18 P2-1 완료 조건 문장(세부는 T-061 검증) |
| U-1 실제 P1 값 | spec `fromP1Values`: box x 0.44, y top 0.16 · middle 0.5 · bottom 0.74, anchor center, widthRatio 0.76, rotation 0 / style 굵기 700, 외곽선·그림자·배경 null, 가운데, 자간 0, 줄 간격 1.3, maxLines = 그 kind 프리셋 값(경고용) / 그대로: id·kind·content·fontSize·color·locked / 움직임 none·0프레임. **프리셋 자동 적용 없음** |
| 초 → 프레임 | spec `secondsToFrames`: 0.5 올림, 정수 계산 권장(ms → floor((ms × 30 + 500)/1000)), 예 0.125초 → 4, 5.25초 → 158 |

## 2. 코드 근거 대조 (값을 지어내지 않음)

| 값 | 실제 P1 코드 |
|---|---|
| y 0.16 / 0.5 / 0.74 | `components/editing-panel.tsx` overlay `top: "16%" / "50%" / "74%"` |
| x 0.44, anchor center, widthRatio 0.76 | `components/finishing-panel.module.css` `.overlay { left:44%; transform:translate(-50%,-50%); width:76% }` |
| 가운데, 굵기 700, 줄 간격 1.3 | 같은 규칙 `text-align:center; font-weight:var(--weight-bold)`(tokens 700), `line-height:var(--lh-tight)`(tokens 1.3) |
| 외곽선·그림자·배경 없음 | `.overlay`에 text-shadow·stroke·background 없음 |

## 3. 구현 담당과 맞출 점 (기본 요구 추가 아님)

- spec 새 키 이름은 `migration.fromP1Values`. 0005 원문은 이 파일을 읽지 않고 값을 원문 안에 고정해도 된다(결정성·동기 전용 계약). 값만 같으면 된다.
- `maxLines`는 T-060 5.2 그대로 kind별 프리셋 값. 글자는 자르지 않는다.
- 정확한 필드 이름이 T-061 구현과 다르면 Master 경유로 공유하고 spec을 맞춘다.

## 4. 확인

- `text-presets.json` JSON 파싱 통과, specVersion 2026-11-16.1. 코드에서 이 파일을 읽는 곳 없음(grep) — 앱 동작 변화 없음.
- `git diff`: PLAN 11.2·18·이력, spec 두 곳만. 실행 시험 없음(문서만).
