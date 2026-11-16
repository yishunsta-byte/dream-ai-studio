# T-077 F076-1 수정 — 미리보기 시험의 CRLF 호환 (CC-DATA-01)

- 지시: Master `msg_7aeba68a7934` (T-076 F076-1)
- 바꾼 파일: `tests/p2-2-preview.test.ts`(한 줄 + 주석), 이 보고서. 제품 코드·migration·패키지·공유 문서 변경 없음

## 1. 원인과 수정

- `p2-2-preview` 13번째 시험(T-075)이 `player-panel.tsx` 글자 안에서 `\n`이 든 두 줄을 그대로 찾았다. 저장소를 CRLF로 꺼내면 파일은 `\r\n`이라 찾지 못해 실패했다.
- 수정: 그 시험에서 읽은 글자의 줄바꿈만 `\r\n → \n`으로 맞춘 뒤 같은 검사를 한다(`readFileSync(...).replace(/\r\n/g,"\n")`). 검사 내용(`PlayerFailed`가 effect로 `onFailed()`를 부름, `errorFallback={fallback}`, `onFailed={failed}`, `()=>null` 대체 없음)은 그대로. 다른 파일 읽기 검사는 줄바꿈과 무관(한 줄 문자열·`[^;]`/`[^>]` 정규식)이라 그대로.

## 2. 확인

- 원본 저장소: 전체 `vitest` 36개 파일 **425 통과 / 2 건너뜀**, 해당 시험 13개 통과, eslint(이 파일)·typecheck 통과.
- OS 임시 폴더에 소스 사본 두 개(LF·CRLF)를 만들고 미리보기 관련 5파일(`player-panel`·`timeline-composition`·`player-loader`·`lib/edit/preview`·시험)의 줄바꿈을 각각 LF/CRLF로 맞춤(CRLF 사본 `player-panel.tsx` CRLF 146개 확인). node_modules는 연결만 하고 끝나고 연결부터 지운 뒤 사본 삭제(원본 node_modules 195항목 그대로).

| 사본 | 고친 시험(13) | 고치기 전 시험(HEAD 내용, 13) | 고친 시험 + `PlayerFailed`의 effect 줄 삭제 |
|---|---|---|---|
| LF | 13 통과 | 13 통과 | **1 실패**(검사가 살아 있음) |
| CRLF | 13 통과 | **1 실패**(F076-1 재현) | **1 실패**(검사가 살아 있음) |
