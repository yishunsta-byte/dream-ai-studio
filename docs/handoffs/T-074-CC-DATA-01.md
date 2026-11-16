# T-074 미리보기 가독성 소규모 보완 (CC-DATA-01)

- 지시: Master `msg_2d7404823cfc` (T-072 `63eda92` 후속 C-4·C-5·C-6), design 토큰 확인 `msg_2e575708ff11`
- 범위: 화면 표시만. 저장된 글자 값·타임라인·원본 이미지/영상·DB·패키지·공용 문서는 그대로

## 1. 바꾼 것

| # | 파일 | 전 → 후 |
|---|---|---|
| C-4 | `components/player/timeline-composition.tsx` `Slot` | 빈 자리·없는 파일·글자만 구간 바탕 `--bg-sunken`(밝음) + `--fg-muted` → `--bg-sidebar`(#243B53) + `--fg-on-sidebar-muted`(#A9BACB, design 계산 대비 약 5.8:1). 흰 글자(P1 값 그대로)가 이 구간에서도 보임 |
| C-5 | `components/player/player-panel.module.css` 안전 영역 | 칠 `--st-danger-bg` 35% → `--st-danger-fg` 18%, 점선 1px `--st-danger-line` → 2px `--st-danger-line` + 바깥 1px `--bg-sidebar` 테(outline이라 상자 위치는 그대로) |
| C-6 | `components/editing-panel.tsx` | 휴대폰 안내 두 개 중 아래 "휴대폰에서는 문구만 고쳐요." 삭제, 위 "장면 순서·글자 모양·시간은 PC에서 바꿔요." 유지 |

## 2. 확인

- typecheck 통과, `eslint components` 0건, `tests/p2-2-preview.test.ts` 12 통과, `npm.cmd run build` 통과.
- production(next start 127.0.0.1:3061, s5 고정 백업을 OS 임시 폴더에 푼 사본 — 끝나고 삭제), ego-browser. 새 캡처 `tmp/t074-evidence/` 8장(기존 t071 캡처는 그대로):
  - `02-text-only-tail-1280.png`: 00:12.00 글자만 구간, 바탕 rgb(36,59,83) 위 흰 "광고" rgb(255,255,255) 보임. 390도 같음(`02-…-390.png`). 빈 자리 `01-empty-slot-*.png`.
  - 안전 영역 켬: 밝은 장면(이미지, `03-image-safe-*.png`)·어두운 장면(글자만 구간, `02-*`) 모두 붉은 띠와 점선 보임. 16:9 `04-safe-169-*.png`.
  - 점선 상자 위치(Player 상자 기준, 2px 점선 뒤 다시 잼): 1280 9:16 360×640 위 76.8·아래 128·왼쪽 0·오른쪽 43.19, 16:9 10.13·18, 1:1 18. 390 9:16 316×561.77 위 67.41·아래 112.34·오른쪽 37.91, 16:9 8.88·15.8, 1:1 15.8 → 모두 spec 비율과 ±1px 안(계산값과 0.01px 차).
  - 390 보이는 휴대폰 안내 1개("장면 순서·글자 모양·시간은 PC에서 바꿔요."), 가로 넘침 0.
- 전체 시험 반복은 지시대로 하지 않음.
