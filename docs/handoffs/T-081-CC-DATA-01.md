# T-081 P2-3a 글자 편집기 구현 — CC-DATA-01 보고

- 기준: T-079(5937543) 기술 설계, T-080(b3c7af7) UX 수용조건 A-1~A-16, T-082 글꼴 설치(b9b1961/967002a), T-083 조기 검토 처리(E-1~E-6).
- 상태: 제품 준비 완료(ready_review). 자체 확인이고 독립 검수는 아니에요.
- API 모양·DB·migration·schema_version은 바꾸지 않았어요. public/fonts·spec·PLAN·DESIGN은 건드리지 않았어요.

## 1. 바꾼 파일

| 파일 | 내용 |
|---|---|
| `lib/edit/fonts.ts` (새) | 읽을 수 있는 글꼴 8종(spec 이름 그대로), `FontRef`, `fontStack` |
| `lib/edit/presets.ts` (새) | spec text-presets 로드(불러올 때 스키마 검사), 빠른 모양 7개(표기 제외), 움직임 이름 |
| `lib/edit/text-ops.ts` (새) | 새 글자·빠른 모양·종류 바꾸기·순서·빼기·되넣기, `MM:SS.FF` 시간 읽기, 안전 영역 판정·안으로 옮기기, 움직임 계산 |
| `lib/fonts/registry.ts` (새, 서버 전용) | 설치 글꼴 확인: 폴더에 글꼴 파일 정확히 1개 + OFL.txt 본문. URL의 `[ ]`는 인코딩 |
| `lib/edit/timeline.ts` | `style.fontFamily`를 8종 enum으로 넓힘(추가만) |
| `lib/services/timeline.ts` | 글꼴·굵기 서버 검사(저장값 그대로면 통과), 필수 표기 세 번째 경우(spec 표기 모양 그대로 + 기획 전체 시간, D-4), `editView.timelineJson` |
| `lib/services/editing.ts` | 편집 초안·고를 수 있는 글꼴·필요한 표기·기획 길이·P1 원래 초 |
| `lib/services/exports.ts` | 새 user/restore 타임라인일 때만 `edit/timeline.json`(행 원문) + 쓴 글꼴 + `LICENSES/<folder>-OFL.txt`, README 첫 줄 "편집용 묶음입니다."(E-5) |
| `lib/edit/preview.ts` | 글자별 움직임·글꼴 없음·선택/경고 테 |
| `components/player/font-loader.ts` (새) | FontFace 등록·대기(20초), ok/missing/timeout 구분 |
| `components/player/timeline-composition.tsx` | `TextView` 공개: 자간 px, 외곽선 바깥 두께(2×width + paint-order, 감쌀 폭에서 외곽선만큼 뺌), 움직임, 선택/경고 테 |
| `components/player/player-panel.tsx` | 글꼴 여러 개 로드, 선택·경고 테 전달, `controlRef`(현재 프레임·이동). P2-2 오류 화면·키 처리 구조 그대로 |
| `components/player/text-measure.tsx` (새) | 저장 비율 크기로 화면 밖에 같은 `TextView`를 그려 바깥 상자(외곽선·그림자·띠 포함)와 줄 수 측정 |
| `components/text-editor/*` (새) | 글자 목록·글자 추가·편집 칸 |
| `components/editing-panel.tsx` | 초안 편집·명시 저장·변경 취소·떠날 때 확인·실측 경고 연결 |
| `tests/p2-3-text-editor.test.ts` (새) | 17개 시험 |

## 2. 정한 것 (설계에 없던 세부)

- 움직임 표시 규칙(E-2): 나타날 때 `p=(frame+1)/d`, 사라질 때 `q=(frame-(span-d))/d`. 저장 시간의 첫·끝 프레임은 완전히 투명하지 않아요. 타자 효과는 고른 속도(가속 없음).
- 경고 테는 실측이 끝나고 글꼴이 실제로 로드된 글자에만 그려요. 대신 그린 글꼴로는 경고를 판단하지 않고 "확인 전"으로 보여요.
- 글꼴이 20초 안에 안 오면 그 미리보기 동안은 timeout으로 남아요(안내: "미리보기를 다시 불러와 보세요"). 늦게 도착해도 자동으로 바꾸지 않아요.
- 문구를 바꾼 글자만 저장할 때 앞뒤 공백을 지워요. 문구를 안 바꾼 글자는 저장값 바이트 그대로예요.
- 영상보다 긴 글자 경고(필수 표기 포함)도 경고 테 대상이에요. 저장은 막지 않아요.

## 3. 확인 결과

### 자동 검사
- `tsc --noEmit` 통과, `eslint .` 통과, `vitest run` 37파일 442개 통과(2개는 원래 건너뜀), `npm run build` 통과(임시 폴더 복사본에서 빌드, 저장소 `.next`는 건드리지 않음).
- 새 시험 17개: 읽기 목록 ⊇ spec / 가짜 글꼴 폴더(라이선스 없음·본문 다름·파일 0개·2개 거절, CRLF 라이선스 통과) / 실제 8종 설치·URL 인코딩 / 새 글자 8종 = spec 값, 기본 위치가 세 비율 안전 영역 안 / 새 글자 시간(3초·앞당김·짧은 영상) / 빠른 모양은 style·animation만(체크 때만 위치), 종류 바꾸기는 maxLines만, 잠긴 표기 불변 / 고친 칸만 바뀜·순서·빼기·되넣기 / 시간 왕복·오류 구분 / 안전 영역 0.5px·안으로 옮기기 / 움직임 첫·끝 프레임 / P1 r1이 자간 0·외곽선·띠·그림자 null만 썼고 r1 바이트·해시·0005 대조 그대로 / 다른 글꼴로 바꾼 r1은 P1 대조 실패 / 설치 안 된 글꼴·없는 굵기 거절, 저장값 그대로면 통과 / 필수 표기 규칙 / P1 표기 위치만 바꿔 저장·빼기 거절 / 글자만 저장 시 장면·선택·자료 불변·새 버전·검수 잠김·같은 내용 noop / 묶음 내용 / 경계(편집기 폴더에 서버 import·문서 전체 키·fetch 없음).
- 기존 비영(0이 아닌) 자간·외곽선 데이터: P1→r1 경로는 자간 0과 외곽선·띠·그림자 null만 써요(시험으로 확인). 그래서 px·바깥 두께로 읽는 방식이 기존 데이터를 바꾸지 않아요. 반례는 찾지 못했어요.

### 운영 모드 화면 (가짜 s5 데이터, OS 임시 폴더, 127.0.0.1:3061)
증거: `tmp/t081-evidence/` (git 제외)
- 1280 (`edit-1280*.png`): 목록 3줄, 표기 잠금, 빠른 모양 "훅" 적용 + 되돌리기 알림, Noto Serif KR(23.8MB) 로드 약 0.4초(같은 PC), 화면 자간 -1px·외곽선 20px(바깥 10)·paint-order 확인, 선택 테 실선·경고 테 점선.
- 실측 경고: 긴 문구 + 세로 93% → "확인할 것이 2개 있어요." 아래 안전 영역(20%) + "글자가 길어 5줄이 돼요. 최대 2줄이에요." 안으로 옮기기 → 경고 사라짐, 초점은 편집 칸 제목, 목록에 "위치 확인 필요".
- 저장: 타임라인 r2·내용 버전 r6 생성, 저장 후 변경 없음 상태.
- 글꼴 시간 초과(`edit-1280-font-timeout.png`): 300KB/s로 늦추자 "Noto Serif KR 글꼴을 불러오지 못해 …", "20초 안에 다 읽지 못했어요." 안내, 그 글자는 "확인 전".
- 390 (`edit-390*.png`): 가로 넘침 없음(390), 편집 칸은 문구만 보임, "PC에서 바꿔요" 안내, 휴대폰에서 문구 고침 → 변경 취소로 원래 값(앞뒤 공백 포함) 복귀.

### 묶음 ZIP
- 화면의 묶음 계획: 15개 파일·약 25.9MB, `edit/timeline.json`·`fonts/noto-serif-kr/NotoSerifKR[wght].ttf`·`LICENSES/noto-serif-kr-OFL.txt` 포함.
- 가짜 데이터의 장면 3에 결과가 없어 화면에서는 만들기가 막혀요(원래 데이터 상태). 그래서 같은 `bundleLayout`으로 임시 폴더에 실제 ZIP을 만들었어요: 25,870,703바이트, 15개 파일.
  - `edit/timeline.json` sha256 = DB 행 `timeline_sha256` = `7b3797a5…f64284`
  - 글꼴 파일·라이선스 sha256 = 저장소 원본과 같음. 라이선스는 지금 저장소에서 LF이고, 묶음은 디스크 바이트를 그대로 복사해요. 라이선스 확인은 줄바꿈(LF/CRLF)과 상관없이 본문으로 판단해요.
- 옮긴 P1 r1 묶음은 timeline.json·새 글꼴 없이 P1 배치 그대로예요(시험).

## 4. 남은 것·제한

- `lib/services/review.ts`의 오탈자(c.typos) 문구는 범위 밖이라 그대로 뒀어요(D2: P2-4까지 PASS 근거로 쓰지 않음).
- 구빌드 호환: Pretendard 외 글꼴로 저장한 타임라인은 이번 이전 빌드가 읽지 못해요(T-079 2.1.1에 적은 제한). r1·기존 ZIP·text_overlays·SRT 바이트는 그대로예요.
- 이번 범위 밖(P2-3b 이후): 타임라인 글자 줄·드래그 키, 자동 저장, 내 모양 저장, 버전 이력 화면.
- E-3 강조 안내 문구("강조는 글자가 보이는 동안 계속 움직여요.")는 넣었어요. E-6 registry 이유 문구는 화면에 내보내지 않아요.
