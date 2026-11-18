# T-240-FIX F240-1 공개 메인 hero 작은 문구 대비 보완

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_d356f01d9e7c` · 근거: Tester `msg_826a912a2bef`, 최종 FAIL `84083f9`(T-240-R)
- 기준: `313c16d`(T241) 위. 이번 커밋은 T241 route·Auth 파일을 건드리지 않아요.
- 상태: **ready_review(작성자 자체 검증)**

## 1. 원인과 고친 것
- **원인:** 390px에서 10px 문구 "THE NIGHT IS JUST BEGINNING."이 사진의 밝은 건물 위에 걸렸어요. 실제 글자 픽셀 대비는 2.92:1이었어요.
- **고친 것:** `neon-showcase.module.css`의 `.heroCopy .eyebrow`
  - `display: inline-block`
  - 불투명 바탕 `background: #0c0814`(페이지 배경 계열)
  - `padding: 4px 8px`, `border-radius: 4px`
- 글자색 `#ffb5ed`, 크기, 문구, 위치 흐름은 그대로예요. 모바일 규칙(10px)도 그대로예요.
- 계산 대비는 `#ffb5ed`/`#0c0814` = 약 12.3:1이에요. 사진이 무엇이든 글자 뒤는 항상 이 바탕이에요.
- 흰 글자 그림자에 기대지 않았어요. `neon-showcase.tsx`, lib, 자산은 바꾸지 않았어요.

## 2. 시험
- `tests/public-showcase/neon-showcase.test.ts`에 1건을 추가했어요.
  - `.heroCopy .eyebrow`에 6자리 불투명 바탕이 있는지 확인해요.
  - `inline-block`인지, 글자색과 바탕 대비가 4.5 이상인지 확인해요.
  - 모바일 규칙이 바탕을 지우지 않는지(투명·none·rgba 없음) 확인해요.
- **red→green**
  - 옛 CSS(HEAD)로 돌리면 이 1건이 실패해요: `Tests 1 failed | 13 passed (14)`.
  - 수정본으로 돌리면 `14 passed (14)`예요.
- 전체 vitest는 **Test Files 103 passed | 10 skipped (113), Tests 2056 passed | 319 skipped (2375)**예요.
  - 작업 트리에 다른 담당의 미커밋 WIP(`lib/db/postgres/migration-catalog-v3.ts`, `tests/postgres/schema5-catalog.test.ts`)가 있는 상태의 결과예요.
- `eslint components/public-showcase tests/public-showcase --max-warnings 0`은 0이에요.
- 격리 clean 사본(`tmp/t240fix/app`, `git archive 313c16d` + 수정 2파일)에서 `tsc --noEmit --incremental false`는 오류 0이에요.

## 3. 실제 글자 대비 측정(같은 배경 쌍, 실제 glyph)
- **방법:** Tester `glyph-contrast.mjs`와 같아요.
  - 애니메이션을 0초에서 멈춘 상태로 원래 화면을 캡처해요.
  - hero 글자만 `color: transparent`로 바꾼 배경 화면도 같은 프레임에서 캡처해요.
  - 원래 글자색 ±12인 실제 글자 픽셀에서, 같은 위치 배경과의 최소 대비를 구해요.
- **도구:** `tmp/t240fix/capture.js`(ego), `tmp/t240fix/measure.mjs`. 결과는 `tmp/t240fix/{before,after}-contrast.json`, 캡처는 `tmp/t240fix/shots/`에 있어요.

| 폭 | 작은 문구 수정 전 | 작은 문구 수정 후 | 큰 제목 NEON AFTER HOURS(변경 없음) |
|---|---|---|---|
| 1280×900 | 11.97 | 12.34 | 15.92 → 14.87 |
| 390×844 | **2.9169 FAIL** | **12.34** | 5.64 |
| 360×900 | **1.81 FAIL** | **12.34** | **3.93 (52px 큰 글자)** |
| 414×896 | **3.34 FAIL** | **12.34** | 5.50 |

- 390의 수정 전 값 2.9169는 Tester가 보고한 값(2.916922)과 같아요.
- hero의 나머지 문구(대표 작품 표시, 부제, 제작 정보, 두 버튼)는 모든 폭에서 5.06 이상이에요.

### 추가로 본 점(이번 범위 밖, 판단 요청)
- 360px 폭에서는 큰 제목 "NEON AFTER HOURS"(52px)의 최소 실제 글자 대비가 **3.93**이에요.
  - 큰 글자 기준 3:1은 넘어요. 일반 글자 기준 4.5에는 못 미쳐요.
- 수정 전에도 같은 값이었어요. 이번 변경으로 생긴 것이 아니에요.
- 배정 범위가 작은 문구여서 손대지 않았어요. 필요하면 별도 보완 범위를 정해 주세요.

## 4. 회귀(ego, 격리 dev, 제 포트만)
- T240 미리보기 전체 확인(`tmp/t240fix/check.js`, 원 T240 스크립트와 같은 항목)
  - 1280·390 정상·필터·결과 없음·상세(키보드 열기/Tab 가두기/Esc 복귀)·음악 상세·사라진 버튼 복귀·레일·로딩/오류/빈 상태·다시 시도
  - 같은 화면의 동작 줄이기(애니메이션 none)도 포함이에요.
- **1회차:** `gone-390`(상세를 연 버튼이 필터로 사라진 뒤 Esc → 작품 영역 포커스) 1건이 실패했어요.
- **2·3회차:** 전부 PASS였어요.
- **같은 동작만 390에서 10회 반복:** 10/10 모두 작품 영역 포커스·대화상자 닫힘이었어요(`tmp/t240fix/gone.out`).
  - 이번 CSS 변경은 포커스 코드와 관계없어요.
  - 1회차는 스크립트의 짧은 대기(300ms) 시점 문제로 판단해요.
  - 다만 1회 실패 기록은 그대로 남겨요(`tmp/t240fix/result-run1.json`).
- Tester에게 ego 사용 시작(`msg_b4d64cd5fbb8`)과 끝(`msg_8fe8e3c1b89f`)을 알렸어요. dev 서버는 종료했고 포트가 닫힌 것을 확인했어요.

## 보호
- 커밋 대상은 3파일뿐이에요: CSS, 시험, 이 보고.
- T241 route·Auth, 다른 담당 WIP, T122·T137, tmp는 미변경·미stage예요.
- build·push·배포는 하지 않았어요. 3013과 공유 `.next`는 건드리지 않았어요.
