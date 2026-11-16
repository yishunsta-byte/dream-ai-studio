# T-079 P2-3 구현 설계 — 글자 편집기·프리셋·경고 (CC-DATA-01)

| 항목 | 내용 |
|---|---|
| 지시 | Master `msg_d53eab9932b0` |
| 성격 | **기술 설계만.** 코드·DB·spec·공유 문서·패키지 변경 없음. 실제 구현은 Master가 범위를 정해 따로 배정 |
| 읽은 것 | PLAN 7.2·11.2·11.3·17·18, DESIGN 6.8·10장 P2, spec `fonts.json`·`text-presets.json`, T-033(3.2·4·7장), T-056, T-060, T-067, T-068, P2-EDIT-PROTOTYPE-GAP, 코드 `lib/edit/{schema,timeline,preview}.ts`, `lib/services/{editing,timeline,exports,review}.ts`, `app/api/projects/[id]/timeline/route.ts`, `components/editing-panel.tsx`, `components/player/*`, `lib/db/migrations/0001~0005` |
| 함께 볼 곳 | T080(Claude design) — 7장의 디자인·spec 질문은 그쪽에 직접 넘김, Master 참조 |

---

## 0. 한눈에 (추천)

1. **새 DB 마이그레이션 없음.** 글자는 이미 `timeline_revisions.timeline_json` 안의 `TextLayer`예요. P2-3은 그 JSON의 **허용 값(zod)과 화면**만 넓혀요. `text_presets` 표는 0001~0005 어디에도 없어요. "내 모양"(U-5)은 P2-3에 넣지 않아요.
2. **기본 8 프리셋은 spec 파일을 그대로 읽어요**(DB 복사 없음). 프리셋은 **누른 때만** 적용해요. 옮겨 온 P1 글자와 저장된 글자는 사용자가 고친 칸만 바뀌어요.
3. **저장은 지금처럼 명시 저장**이에요(자동 저장 U-4는 미정이라 넣지 않음). 지금 있는 `POST /timeline action:"save"`(내용 revision + 타임라인 id CAS)를 그대로 써요. 저장하면 검수가 무효가 되는 규칙(U-7)도 그대로예요.
4. 화면은 정적 편집기의 `EditInput`(P1 모양)을 거치지 않아요. **`Timeline`을 직접 고치는 순수 함수**를 쓰고, 미리보기(P2-2 Player)에는 같은 초안을 그대로 넘겨요.
5. 안전 영역·줄 수 경고는 **브라우저에서 실제 글꼴로 그린 바깥 경계**를 재서 판단해요. 경고는 저장·렌더를 막지 않아요.
6. 글꼴 8종: 코드는 `fonts.json` 8종을 받게 만들어요. 다만 지금 저장소에는 **Pretendard 파일만** 있어요. 나머지 7종 파일은 **별도 설치 작업**에서 넣어요(5.1). 설치·라이선스 검사를 통과한 글꼴만 목록에 보여요.
7. 나누기 추천: **P2-3a** = 글자 목록·편집 칸·프리셋·글꼴·경고·저장·미리보기 연결, **P2-3b** = 아래 타임라인 글자 줄(끌기·키보드 이동). 3.2.1 키 규칙과 지연 저장 시험이 커서 따로 검수하는 편이 안전해요.

---

## 1. 지금 상태 (코드 기준)

| 영역 | 지금 | P2-3에서 걸리는 점 |
|---|---|---|
| 스키마 `timelineTextSchema` | kind 8종, style·box·timing·animation 전부 있음. **`fontFamily`는 `"Pretendard"` 하나만** 허용 | 글꼴 enum 넓히기(2.1) |
| 화면 `editing-panel.tsx` | P1 정적 편집기 값(`EditInput`: kind 6종, 위치 3단계, 초 단위) → `applyEditView`로 타임라인 생성 | kind `lyric`·`brand`, 상자 위치, 모양, 움직임을 다룰 수 없음 → 편집기를 바꿈 |
| 저장 API | `POST /api/projects/{id}/timeline` `{action:"save",revision,timelineId,timeline}`. 서버는 `timelineSchema` + 장면 클립 + 글자 끝 상한 + 필수 표기 + 같은 내용 생략 + CAS 검사 | 필수 표기 규칙이 P1 값(64·흰색·기획 전체 시간)에 묶여 있음 → 프리셋 표기를 받도록 고침(2.3) |
| 미리보기 | `previewProps(timeline)` → `TextView`: 스타일·상자를 그대로 그림. 글꼴은 `var(--font-pretendard)` 고정, 움직임은 아직 그리지 않음 | 글꼴별 로드, 움직임, 선택·경고 테두리 |
| 내보내기 | `edit/text_overlays.json` = `editView`(P1 모양으로 줄인 값). `editableInStaticEditor`가 `lyric`·`brand`를 **빼요**. 글꼴은 Pretendard만 넣어요 | 새 종류·모양·글꼴이 묶음에서 조용히 빠짐 → 5.3 결정 필요 |
| 검수 | `c.typos`(글자 잘림) 근거는 서버 계산 문자열이에요. 서버에는 글꼴 측정 수단이 없어요 | 실측 근거를 어디서 만들지 결정 필요(4.4) |
| DB | `timeline_revisions`(0005). `text_presets` 표 없음 | 새 표·마이그레이션 만들지 않음 |

---

## 2. 자료 구조·서버 규칙

### 2.1 스키마 (`lib/edit/timeline.ts`, 클라이언트·서버 공용)

| 칸 | 지금 | P2-3 |
|---|---|---|
| `style.fontFamily` | `z.literal("Pretendard")` | `z.enum(FONT_FAMILIES)`. `FONT_FAMILIES`는 `docs/spec/fonts.json`의 `fonts[].family`를 **정적으로 import**해서 만들어요(8개, 순서는 파일 순서). 설치 여부는 서버 검사(2.3)에서 따로 봐요 |
| `style.fontWeight` | 100~900 정수 | 같음. 단, 서버가 **그 글꼴의 `weights`에 있는 값만** 받아요(2.3) |
| 그 밖 | — | 바꾸지 않아요. 옛 행은 모두 그대로 통과해요(넓히기만 하므로 `checkTimelineRows`·0005 검사·해시는 영향 없음) |

- P1 정적 편집기 스키마 `lib/edit/schema.ts`(`textLayerSchema`, 0003 스냅샷 읽기용)는 **고치지 않아요.** 0005 원문과 그 등록 해시도 그대로예요.
- 시험: 옛 고정 백업 s4·s5를 0005로 옮긴 행이 새 스키마에서도 그대로 읽히고 해시가 같은지 확인해요.

### 2.1.1 `fontFamily` 넓히기가 0005·고정 r1·역호환에 미치는 영향 (Master `msg_9b3ecc4aa9ac` 요청 보충)

| 대상 | 영향 | 근거(코드) |
|---|---|---|
| 0005 원문·등록 해시 | **없음.** 0005는 `0005_timeline_shared.cjs`가 `"Pretendard"`를 직접 써요. TS 스키마를 import하지 않아요. 파일을 고치지 않으므로 선언 해시도 같아요 | `0005_timeline_shared.cjs` 33행 |
| 고정 r1(s4·s5) 읽기 | **없음.** `readTimelineRow`는 `timelineSchema.parse` 후 `canonicalJson`·sha256이 저장 바이트와 같은지 봐요. 허용 목록을 넓혀도 `"Pretendard"`는 그대로 통과하고, zod enum은 값을 바꾸지 않아 바이트·해시가 같아요 | `lib/db/timeline-data.ts` 39~42행 |
| 옮긴 r1 대조 | **없음.** `checkP1MigratedRow`는 `textFromP1`(Pretendard 고정, 바꾸지 않음)과 글자를 통째로 비교해요. 그래서 다른 글꼴이 들어간 `p1-migration` 행은 지금처럼 "text" 불일치로 거절돼요 | 같은 파일 59행 |
| 기존 ZIP·SRT | **없음.** 옛 묶음은 manifest 해시로 재검증해요. `text_overlays.json`·SRT를 만드는 경로(`editView`)는 바뀌지 않아요 | `lib/services/exports.ts` |
| P1 값 해석 | **없음.** P1 `textLayerSchema`(`lib/edit/schema.ts`)와 `fromP1Values` 변환은 고치지 않아요. 새 단위(예: letterSpacing px)를 정하더라도 P1에서 옮긴 값은 모두 0·null이라 해석이 달라질 값이 없어요 | `textFromP1` |
| **되돌린 앱(옛 빌드)** | **있음.** P2-3 이후 Pretendard가 아닌 글꼴로 저장한 행이나 그 백업을 P2-3 이전 빌드에서 열면 `timelineSchema.parse`가 실패해요. 그러면 "저장한 타임라인을 확인해 주세요."로 막혀요(조용히 바꾸지는 않음) | — |
| **글꼴을 목록에서 뺄 때** | **있음.** 스키마 enum을 `fonts.json`에서 바로 만들면, 나중에 spec에서 글꼴을 빼는 순간 그 글꼴로 저장된 옛 버전을 **읽을 수 없게** 돼요 | — |

추천(구현 배정 때 반영):
- **읽기 허용 목록과 선택 목록을 나눠요.**
  - `READABLE_FONT_FAMILIES`(코드 상수): 한 번 넣으면 빼지 않아요. 지금은 `fonts.json` 8종과 같은지 시험으로 확인해요.
  - **선택 가능** = `fonts.json` ∩ 설치·라이선스 통과: 서버 저장 검사와 화면 목록에만 써요.
- 시험을 추가해요.
  - ① s4·s5를 0005로 옮긴 r1의 `timeline_json`·sha256이 넓히기 전후로 바이트 단위 같아요.
  - ② `checkTimelineRows`·`verifyTimelineMigration`이 그대로 통과해요.
  - ③ 다른 글꼴로 바꾼 `p1-migration` 행은 `P1SourceMismatchError`예요.
  - ④ `READABLE_FONT_FAMILIES`는 `fonts.json`을 모두 포함해요(빼면 실패).
- 옛 빌드로 되돌리는 경우는 PLAN에 앱 되돌리기 절차가 없어서 막지 않아요. 문서에는 "P2-3 이후 다른 글꼴로 저장한 백업은 P2-3 이전 앱에서 열리지 않음"을 적어 둬요.

### 2.2 화면·데이터 함수 (새 파일 `lib/edit/text-ops.ts`, 순수·클라이언트 안전)

모든 함수는 입력을 바꾸지 않고 새 `Timeline`을 돌려줘요(얼린 입력으로 시험).

| 함수 | 하는 일 | 지키는 것 |
|---|---|---|
| `newTextLayer(kind, {startFrame, videoFrames, plannedFrames, content})` | spec 프리셋 기본값(style·box·animation·locked)으로 새 글자를 만들어요. id는 `v7()`, 시간은 `startFrame`부터 3초(영상 끝을 넘지 않게)예요. 표기는 `0 … plannedFrames`이고 문구는 고정 목록에서만 골라요 | 새 글자에만 프리셋 적용 |
| `updateText(timeline, id, patch)` | 바꾼 칸만 덮어써요(깊은 병합: `style`·`box`·`timing`·`animation`) | 고치지 않은 칸은 저장값 그대로(바이트 단위 — `canonicalJson` 비교 시험) |
| `applyPreset(layer, kind, {withBox})` | **사용자가 누를 때만** style·animation을 그 프리셋 값으로 바꿔요. `withBox:true`("기본 위치도")일 때만 box도 바꿔요. 문구·시간·종류·잠금은 바꾸지 않아요 | 명시적 적용, 잠긴 표기에는 사용 불가 |
| `changeKind(layer, kind)` | 종류만 바꿔요. 그 종류의 `maxLines`(경고 기준)만 따라 바꾸고, 모양은 바꾸지 않아요 | 종류를 바꿔도 모양이 조용히 바뀌지 않음 |
| `moveLayer(timeline, id, ±1)` | `text` 배열 순서(= 그리는 순서, 뒤가 위)를 한 칸 옮겨요 | 다른 글자 값 그대로 |
| `removeText(timeline, id)` | 잠긴 글자는 거절해요(화면 버튼도 없음, 2.3) | — |
| `parseFrameTime("00:01.15")` / `formatFrameTime` | `MM:SS.FF` 또는 `H:MM:SS.FF`를 정수 프레임으로 바꿔요. FF는 00~29이고, 틀리면 `null`을 돌려줘요 | 왕복이 정확함 |
| `moveInsideSafeArea(box, measured, aspect)` | 잰 바깥 사각형이 안전 영역 안에 들어오도록 x·y를 **가장 적게** 옮겨요. 폭이 안전 영역보다 넓으면 `null`("크기나 폭을 줄여 주세요") | 저장된 비율 기준 |

### 2.3 서버 검사 (`lib/services/timeline.ts` `check()`)

| 규칙 | 지금 | P2-3 추천 |
|---|---|---|
| 글꼴 | 스키마에서 Pretendard만 | `fontFamily`가 **설치·라이선스 검사를 통과한 글꼴**(5.1 `installedFonts()`)이고 `fontWeight`가 그 글꼴 `weights`에 있어야 해요. 단, 저장값에서 **바뀌지 않은 글자**(지금 있는 `carried` 판단)는 통과시켜요. 글꼴 파일이 나중에 빠져도 옛 버전이 막히지 않게 하려는 것이에요 |
| 필수 표기 | 내용 일치 + 잠김 + (저장값에서 상자만 바뀜 **또는** 64·흰색·0~기획 끝) | 세 번째 경우를 하나 더 받아요: **spec `disclosure` 프리셋 값 그대로**(style·animation이 `canonicalJson` 기준으로 같음) + 0~기획 끝. 글자 크기는 프리셋 38 이상이어야 해요(spec "프리셋 값 미만으로 줄일 수 없음") |
| 잠긴 글자의 시간 | 새 표기는 0~기획 끝으로 고정, 저장값은 상자만 바뀔 수 있음 | **그대로 유지 추천**(D-3) |
| 그 밖 | 장면 클립·글자 끝 상한·크기 1MB·소리 줄 비움·같은 내용 생략 | 그대로 |

- 오류 문구는 지금 문구를 그대로 써요. 새 문구는 하나예요: "이 글꼴은 아직 설치되지 않았어요. 다른 글꼴을 골라 주세요."
- 같은 내용 생략·CAS·`changeContent`(내용 revision + 1, 뒤 단계 무효)는 바꾸지 않아요 → 글자만 고쳐도 장면 결과·선택은 그대로예요(T-1 앞 단계, 시험으로 확인).

### 2.4 편집 화면 자료 (`lib/services/editing.ts` `get()`에 추가, 새 API 없음)

```ts
fonts: {family:string; weights:number[]; url:string; installed:boolean; reason:string|null}[]  // fonts.json 순서, 설치 안 된 것도 이유와 함께
requiredDisclosures: string[]      // 프로젝트 등록값에서 (지금 requiredDisclosures)
plannedFrames: number              // 기획 장면 합계 × 30 (표기 기본 시간)
```

- 기존 `value`(P1 모양)·`savedSrt`·`fromP1` 값은 SRT 미리보기와 T-068 안내(옮긴 r1의 P1 시간 표시)에 계속 써요. 편집 대상은 `base`(Timeline)와 `clips`예요.
- 저장된 타임라인이 없을 때 초안의 필수 표기는 지금처럼 P1 값(64·흰색·위/가운데/아래)이에요. **P2-3 추천: 새 초안의 표기는 spec 표기 프리셋으로 만들어요**(2.3의 세 번째 경우). 이미 저장된 표기는 바꾸지 않아요(D-4).

---

## 3. 화면 (P2-3a)

### 3.1 구성 (DESIGN 6.8 위쪽)

- 왼쪽 미리보기(지금 PlayerPanel), 오른쪽 **글자 편집**이에요. 그 아래 장면 순서(지금 그대로)와 SRT 미리보기가 와요.
- 글자 편집 = **글자 목록** + **선택한 글자 편집 칸** 하나. 지금처럼 글자마다 카드를 펼치지 않아요.

**글자 목록** (`components/text-editor/text-list.tsx`)
- 항목 하나 = `<button aria-pressed>` 한 줄이에요. 종류 칩, 문구 앞 20자, 시간 `00:01.00–00:03.15`, 그리고 경고 아이콘(안전 영역·줄 수·영상보다 긺)이 들어가요. 잠긴 표기는 자물쇠와 "필수 표기 · 위치만 변경"으로 보여요.
- 항목 옆 "앞으로"·"뒤로" 작은 버튼으로 순서(그리는 순서)를 바꿔요. 첫 글자는 "뒤로", 마지막 글자는 "앞으로"가 꺼져요.
- 아래에 "글자 추가 ▾"(종류 8개 중 고름, 표기는 필요한데 빠진 것만 보임)가 있어요. 100개면 꺼지고 이유를 보여요.
- 필요한 표기가 빠졌으면 목록 위에 Callout(warning) "필요한 표기 '광고'가 없어요." + "표기 추가"를 보여요(T-033 4.3).

**선택한 글자 편집 칸** (`components/text-editor/text-inspector.tsx`)

| 칸 | 조작 | 잠긴 표기 |
|---|---|---|
| 머리 | 종류 select(8종, spec label) · 시간 | 종류 고정 |
| 문구 | textarea, 500자, 아래에 "최대 {m}줄" + 줄 수 경고 | 읽기 전용(fixedTexts) |
| 빠른 모양 | spec 프리셋 칩 **7개**(표기 제외, T-080 R-1, 이름 = spec label). 누르면 바로 바뀌고 Toast "‘훅’ 모양을 적용했어요. 위치·문구·시간은 그대로예요." + "되돌리기"(이 적용 하나만 취소). 옆 체크 "기본 위치도 함께"(기본 꺼짐) | 숨김 |
| 글꼴 | select. 항목 이름을 그 글꼴로 그려요(로드 실패 시 기본 글꼴). 설치·라이선스를 통과하지 못한 글꼴은 **목록에서 숨겨요**(T-080 R-2). 저장값의 글꼴을 지금 쓸 수 없으면 "{이름} · 지금 없음"을 고른 상태로 보이고 미리보기는 대체 글꼴 칩을 보여요. 굵기 select는 그 글꼴 `weights`만 보여요 | 숨김 |
| 크기 | number 18~120 | 숨김(서버 고정) |
| 색 | 색 견본(color) + 외곽선 켜기/색/두께(0~40) | 숨김 |
| 배경·그림자 | 프리셋 값 표시 + 켜기/끄기만(세부 값 편집은 넣지 않음, 3.3) | 숨김 |
| 위치 | x·y(%) number(0~100, 0.5 단위), 폭(%) · "안전 영역 안으로 옮기기"(경고가 있을 때) | **사용 가능** |
| 움직임 | 나타날 때·강조·사라질 때 select(spec `animationLabels` 쉬운 말) | 숨김 |
| 시간 | 시작·끝 `MM:SS.FF` 입력칸 + "지금 재생 위치로" 버튼 2개 | 숨김(D-3) |
| 지우기 | "이 글자 빼기"(잠긴 글자에는 없음, 이유 문구 "필수 표기라 지울 수 없어요.") | — |

- 시간 칸 아래·저장 버튼 근처의 옮긴 r1 안내 두 줄은 T-068 98·99행 문구 그대로 써요.
- "지금 재생 위치로"를 쓰려면 PlayerPanel이 현재 프레임을 알려 줘야 해요. `onFrameChange?:(frame)=>void` 대신 **`getFrame` ref 함수**를 넘겨 받아요. 누를 때만 읽어 매 프레임 부모 렌더를 막아요.

### 3.2 휴대폰 (390, PLAN 17·T-033 4.4)

- 글자 목록(경고 아이콘 포함)과 **문구 textarea만** 보여요. 나머지 칸·순서·추가·삭제는 `pcOnly`예요. 지금 Callout "장면 순서·글자 모양·시간은 PC에서 바꿔요."를 그대로 써요. 가로 넘침은 0이어야 해요.

### 3.3 스키마가 허용하지만 P2-3 화면에 두지 않는 값

`speakerCharacterId`, `box.anchor`, `box.rotation`, `style.letterSpacing`·`lineHeight`·`align`, 배경 `paddingX/Y`·`radius`·`opacity`, 그림자 세부 값, `animation.durationFrames`·`easing`이에요. 이 값들은 프리셋이나 저장값 그대로 **보존만** 해요(편집 시험에서 바이트 동일). 화면에 넣을지는 사용 기록을 본 뒤 정해요.

### 3.4 미리보기 연결 (`PlayerLoader` props 추가)

| 추가 | 쓰임 |
|---|---|
| `selectedTextId` | 선택 글자 테두리: 2px `--accent-bar` + 바깥 1px `--bg-sidebar`(T-080 R-4) |
| `textWarnings: Record<id, ("safe"\|"lines"\|"beyond")[]>` | 경고 글자 테두리: 2px dashed `--st-warning-line` + 바깥 1px `--bg-sidebar`(T-080 R-4) |
| `fonts`(2.4) | 컴포지션이 글꼴별 `@font-face`/`FontFace`를 로드해요. 재생 중 새 글꼴은 `useBufferState().delayPlayback()`(T-067 D5). 못 읽으면 지금 칩 "글꼴 없음 · 대신 보여요" |
| `getFrame` ref | 3.1 "지금 재생 위치로" |

- 테두리와 칩은 **미리보기에만** 그려요. 렌더(P2-4)에는 같은 컴포지션을 `selectedTextId` 없이 써요.
- 움직임: `TimelineComposition`의 `TextView`에 in/out/emphasis를 `useCurrentFrame()` + `interpolate`로 그려요. `reducedMotion`이면 바로 나타나고 사라져요(T-067). 프레임별 값은 순수 함수 `textMotion(frame, layer)`로 빼서 시험해요.
- 미리보기 전용 비율 전환(U-2)은 그대로예요. 다른 비율일 때는 경고 계산과 "안으로 옮기기"를 **저장 비율 기준으로만** 해요. 미리보기 위치를 저장하지 않아요(T-033 3.2.2).

### 3.5 키보드 소유권 (T-033 3.2.1)

- 문서 전체 키 처리는 두지 않아요(기존 시험 "`window/document.addEventListener("key`" 없음"을 text-editor 폴더까지 넓혀요).
- 입력칸에서는 브라우저 기본 동작을 써요. 앱이 가로채지 않아요.
- 글자 목록: 항목은 버튼이라 Tab·Enter·Space로 다뤄요. ↑/↓ 이동(roving)은 넣지 않아요. 단순하고 화살표 겹침이 없어요.
- 미리보기 무대 키(Space·←/→·Shift)는 지금 그대로예요.
- Ctrl+S는 넣지 않아요. 문서 전체 단축키를 두지 않는다는 규칙 때문이에요. 저장은 버튼으로 해요.
- 타임라인 글자 줄의 선택 클립 키(←/→ 이동, Alt 끝 시간, Enter 편집칸)는 P2-3b예요.

### 3.6 저장 (명시 저장 유지 추천, D-1)

- "새 글자 설정 저장" 하나를 둬요. 보내는 값은 `{action:"save", revision, timelineId, timeline: draft}`이고, `draft`는 2.2 함수로 만든 Timeline이에요.
- 머리는 "저장됨 · 타임라인 r{n} · 시각"이에요. 고친 것이 있으면 Badge "저장하지 않은 변경"과 "변경 취소"(저장값으로 되돌림)를 보여요.
- 실패하면 초안을 지우지 않고 오류 문구를 그대로 보여요. CAS 충돌이면 지금 `TIMELINE_CONFLICT` 문구가 나와요.
- 고친 것이 있는 채로 화면을 떠나면 `beforeunload`로 브라우저 기본 확인을 띄워요. 다른 링크로 갈 때도 같은 검사를 해요.
- 버전 목록·되돌리기 화면(DESIGN 6.8 "버전 목록", GAP G7)은 API(`restore`)가 이미 있지만 P2-3a에 넣지 않아요. 따로 작게 배정하는 것을 추천해요(D-6).

---

## 4. 경고 (실측)

### 4.1 측정 방법 (`components/player/text-measure.tsx`, 클라이언트)

- 화면 밖 고정 칸(`position:fixed; left:-10000px; visibility:hidden; pointer-events:none`)에 **저장 비율 크기 그대로(예 1080×1920)** 컴포지션 좌표계를 만들어요. 그 안에 Player가 쓰는 **같은 `TextView`**를 움직임 없이 그려요. 측정과 미리보기, 이후 렌더가 같은 부품과 같은 글꼴 파일을 써요.
- 글꼴이 준비되면(`document.fonts.load`, 글꼴별) 글자마다 이렇게 재요.
  - 바깥 사각형 = `data-text-body`의 `getBoundingClientRect()`(배경 패딩 포함) + **외곽선 두께**(T-080: `stroke.width` = 바깥으로 보이는 두께, 그리기는 `-webkit-text-stroke: 2×width` + `paint-order: stroke fill`) + 그림자(|x|·|y| + blur)를 넓혀요. 그다음 컴포지션 좌표로 바꿔요.
  - 줄 수 = `Range.getClientRects()`의 서로 다른 줄 top 개수예요.
- 결과는 `{id → {rect, lines, fontLoaded}}`이에요. 초안이 바뀔 때 `requestAnimationFrame` 한 번으로 모아 다시 재요.
- 판정은 순수 함수 `textWarnings(measured, aspect, maxLines)`로 빼서 시험해요.

### 4.2 경고 종류

| 경고 | 조건 | 화면 |
|---|---|---|
| 안전 영역 | 바깥 사각형이 그 비율의 `SAFE_AREA`(spec 값) 밖으로 0.5px 넘게 나감 | 목록 아이콘 · 미리보기 노란 테두리 · 편집 칸 위 Callout(warning). 문구는 걸친 쪽에 맞춰요. 예: "아래 안전 영역(20%)에 걸쳐 있어요. 휴대폰 앱 버튼에 가려질 수 있어요." + "안전 영역 안으로 옮기기" |
| 줄 수 | 실측 줄 수 > `style.maxLines` | 문구 칸 아래 "글자가 길어 {n}줄이 돼요. 최대 {m}줄이에요." + 노란 테두리 |
| 영상보다 긺 | 지금 있는 `endFrame > videoFrames` | 지금 Callout 그대로 |
| 측정 못 함 | 글꼴 로드 실패·시간 초과(8초) | "글꼴을 불러오지 못해 크기를 확인하지 못했어요."(통과로 치지 않고 아이콘 회색 "확인 전") |

- 경고는 저장·렌더를 막지 않아요(spec `textFit`).
- "안으로 옮기기"는 초안만 바꿔요(dirty). 저장은 사용자가 해요. 옮긴 글자에는 이 화면에서만 "위치 확인 필요" 칩이 붙고, 저장하면 사라져요. 따로 저장하는 칸은 만들지 않아요(D-5).

### 4.3 "같은 글자 수라도 글꼴에 따라 다름" 시험 (T-033 4.5-5)

- node(vitest)에는 글꼴 그리기가 없어요. 그래서 판정 함수는 단위 시험으로 보고, 실측은 **production 브라우저 확인**으로 해요. 같은 문구를 Pretendard·Black Han Sans(설치 후)로 각각 그려 줄 수가 다르게 나오는 것을 증거 캡처로 남겨요.

### 4.4 검수 `c.typos` 자동 근거 (D-2)

- 서버(검수 화면)에는 실제 글꼴로 재는 수단이 없어요. 새 의존성을 넣지 않으면 서버에서 잴 수 없어요.
- **추천:** P2-3에서는 근거 문구를 "글자 길이·안전 영역은 편집 화면에서 실제 글꼴로 확인해요. 자동 근거는 영상 만들기(P2-4)에서 붙어요."로 바꿔요. 자동 근거는 P2-4 렌더 작업(같은 컴포지션을 headless Chrome에서 그림)에서 재서 기록해요.
- 브라우저 측정값을 서버에 보내 저장하는 방식은 추천하지 않아요. 화면이 보낸 값을 근거로 믿게 되기 때문이에요.

---

## 5. 글꼴·내보내기

### 5.1 글꼴 설치·목록

- 새 server-only `lib/fonts/registry.ts` `installedFonts()`: `fonts.json`을 읽고 글꼴마다 파일 존재(`public/fonts/<folder>/`)와 라이선스 전체 본문 검사(spec installRule)를 해요. 결과는 `{family, weights, url, installed, reason}`이에요. Pretendard는 지금 경로 `public/fonts/` 바로 아래를 그대로 써요.
- 시험: 라이선스 파일이 없거나 본문에 "SIL Open Font License"·"Version 1.1"이 없으면 목록에서 빠지는지 봐요(가짜 폴더 fixture). 실제 설치 글꼴은 모두 통과해야 해요.
- **나머지 7종 파일 받기는 따로 배정을 추천해요**(D-7). 공식 배포처에서 내려받아야 하고(외부 접속), 받은 파일 해시와 배포 커밋을 `SOURCE.md`에 남겨요. 저장소 용량이 늘어요(특히 Noto Sans/Serif KR 가변 글꼴). 크기는 설치 때 재요. 변환·부분 글꼴 도구는 새 의존성이라 쓰지 않고, 배포 파일(woff2가 없으면 ttf) 그대로 써요.
- 설치 전에도 P2-3a는 동작해요. 목록에는 Pretendard만 보여요(나머지는 숨김, T-080 R-2).

### 5.2 미리보기 글꼴

- `FONT` 상수를 없애고 `fontStack(family)` = `"{family}", var(--font-pretendard), system-ui, sans-serif`로 바꿔요. `@font-face`는 컴포지션 안에서 `FontFace(family, url(...))`로 한 번만 등록해요(`delayRender`/`continueRender`, 실패 시 칩).
- 지금 `fontReady`(Pretendard 하나, 8초)를 "타임라인이 쓰는 글꼴 전부"로 넓혀요.

### 5.3 내보내기 묶음 (D-8, 범위 결정 필요)

- 지금 묶음은 P1 모양 `edit/text_overlays.json`과 Pretendard만 담아요. P2-3에서 `lyric`·`brand`·모양·움직임·다른 글꼴을 저장하면 **묶음에서 조용히 빠져요.**
- **추천(P2-3a에 포함):**
  - ① `edit/timeline.json` = 저장된 `timeline_json` 원문을 추가해요.
  - ② 쓰인 글꼴 파일과 `LICENSES/<글꼴>.txt`를 추가해요(T-5). Pretendard는 지금처럼 항상 넣어요.
  - ③ README 한 줄 "글자 모양·위치·움직임은 edit/timeline.json에 있어요."를 추가해요.
  - `text_overlays.json`·SRT·manifest 형식은 그대로 둬요(옛 묶음 재검증 호환).
- 대안: P2-6(재편집용 ZIP)까지 화면에서 `lyric`·`brand`와 Pretendard 외 글꼴을 막아요. 기능이 반쪽이 되므로 추천하지 않아요.

---

## 6. 파일 범위·시험

### 6.1 P2-3a 파일

| 파일 | 변경 |
|---|---|
| `lib/edit/timeline.ts` | `fontFamily` enum(2.1) |
| `lib/edit/presets.ts` (새) | spec `text-presets.json` 정적 import + zod 검사, `presetFor(kind)`, `DISCLOSURE_PRESET` |
| `lib/edit/fonts.ts` (새, 클라이언트 안전) | `FONT_FAMILIES`, `fontStack` |
| `lib/edit/text-ops.ts` (새) | 2.2 함수, `textWarnings`, `textMotion` |
| `lib/fonts/registry.ts` (새, server-only) | 5.1 |
| `lib/services/timeline.ts` | 2.3 글꼴·표기 검사 |
| `lib/services/editing.ts` | 2.4 자료 추가, 새 초안 표기 프리셋(D-4) |
| `lib/services/exports.ts` | 5.3(D-8 채택 시) |
| `lib/services/review.ts` | 4.4 `c.typos` 근거 문구(D-2 채택 시) |
| `components/editing-panel.tsx` | 글자 카드 폼 → text-editor 연결, 장면 순서·SRT·완료 버튼은 유지 |
| `components/text-editor/{text-editor,text-list,text-inspector}.tsx` + `.module.css` (새) | 3장 |
| `components/player/{player-panel,player-loader,timeline-composition}.tsx`, `lib/edit/preview.ts` | 3.4·5.2 |
| `components/player/text-measure.tsx` (새) | 4.1 |
| `tests/p2-3-*.test.ts` (새) | 6.2 |

- 바꾸지 않는 것: migrations 0001~0005와 등록 해시, `lib/edit/schema.ts`, 고정 fixture s4·s5, spec·PLAN·DESIGN, `package.json`·lock, API route 모양.

### 6.2 시험 (vitest, node)

1. **보존:** 옮긴 P1 글자에 문구만 바꾸면 나머지 칸이 `canonicalJson`으로 같아요. 프리셋을 누르지 않으면 style·box·animation이 그대로예요. 종류만 바꾸면 `maxLines`만 바뀌어요.
2. **프리셋:** 새 글자 8종이 spec 값 그대로 만들어져요. 기본 위치가 모든 비율의 안전 영역 안이에요(숫자). `applyPreset`은 문구·시간·box(기본값)·잠금을 그대로 두고 style·animation만 바꿔요.
3. **시간:** `parseFrameTime`·`formatFrameTime` 왕복(0 → `00:00.00`, 31 → `00:01.01`, `00:01.30`은 null)을 확인해요.
4. **순서·추가·삭제:** 순서 이동 뒤 다른 글자 값이 같아요. 잠긴 글자 삭제를 거절해요. 100개 상한도 확인해요.
5. **서버:** 설치 안 된 글꼴과 없는 굵기는 400으로 거절해요. 저장값에서 그대로 온 글꼴은 통과해요. 프리셋 표기·P1 표기·상자만 바뀐 표기는 통과하고, 표기 문구·크기(<38)·시간 변경은 거절해요.
6. **T-1 앞 단계:** 글자만 바꿔 저장하면 `scene_versions`·선택 포인터·자료 행이 같고, 내용 revision은 +1, 검수는 무효예요.
7. **CAS·같은 내용:** 기존 시험을 새 편집기 초안 경로로 한 번 더 돌려요.
8. **경고 판정:** `textWarnings` 경계(0.5px), 비율 3종, `moveInsideSafeArea` 최소 이동·너무 넓음 null을 확인해요.
9. **움직임:** `textMotion` 처음·끝 프레임 값, `reducedMotion`이면 항상 완전 표시예요.
10. **글꼴 목록:** 라이선스 파일 없음·본문 불일치 fixture가 빠지는지 확인해요.
11. **경계:** text-editor·player 폴더가 서버 모듈을 import하지 않고 문서 전체 키 처리도 없어요(기존 시험 확장).
12. **내보내기(D-8):** `timeline.json` 원문 해시가 DB 행 해시와 같아요. 쓰인 글꼴마다 라이선스가 들어 있고, 옛 묶음 재검증도 그대로예요.

### 6.3 브라우저 확인 (production, 가짜 데이터 루트, 1280·390)

- 글자 선택 → 편집 → 미리보기에 바로 반영돼요. 새 글자 8종을 추가하고, 프리셋을 적용·되돌리고, 순서를 바꾸고, 지우고(잠긴 표기는 버튼 없음), 시간을 `MM:SS.FF`로 넣고 "지금 재생 위치로"를 눌러 봐요.
- 안전 영역 경고: 각 비율의 위·아래·오른쪽에 걸치게 놓았을 때 노란 테두리와 Callout이 나오는지, "안으로 옮기기" 후 경고가 사라지는지 봐요. 줄 수 경고도 봐요.
- 저장 → r+1, 검수 무효, 장면 행은 같아요. 다른 창 충돌 문구, 실패 시 초안 유지, `beforeunload`도 확인해요.
- 390: 문구만 보이고 가로 넘침 0이어야 해요. 미리보기만 볼 때 쓰기 요청은 0이고 DB도 같아야 해요.

### 6.4 P2-3b (타임라인 글자 줄) — 따로 설계·배정

- 줄 그리기(초 눈금·재생 위치선·글자 클립 = 문구 앞부분·길이 = 시간), 선택 = 남색, 경고 = 노란색이에요.
- 3.2.1 키: 선택 클립 ←/→ 1프레임, Shift 1초, Alt 끝 시간만, Enter 편집칸으로, 빈 곳은 seek예요. 끌기는 pointer events로 하고, 키를 누르고 있으면 한 번에 모아 반영해요.
- 시험: T-033 3.3 1-1·1-2(한 키 = 한 동작, blur·지연 저장 순서)를 지연 주입으로 확인해요. 이 단계부터 자동 저장(U-4)이 다시 논의될 수 있어요.

---

## 7. 결정이 필요한 것 (추천 포함 — Master, 디자인 관련은 T080 참고)

| # | 내용 | 추천 |
|---|---|---|
| D-1 | 자동 저장(U-4) | **명시 저장 유지.** 같은 API, 같은 내용 생략, 떠날 때 확인. 자동 저장은 P2-3b 이후 사용 기록을 보고 다시 봄 |
| D-2 | `c.typos` 자동 근거 | P2-3은 안내 문구만, 실측 근거는 P2-4 렌더에서 기록 |
| D-3 | 표기 글자의 시간 바꾸기 | spec 표기 프리셋은 "위치·시간만 바꿀 수 있음"이지만 지금 서버는 시간을 고정해요. 표기가 짧아지면 검수 기준(x.ad-disclosure)을 해칠 수 있어서 **시간 고정 유지 추천**(위치만 변경). 바꾸려면 "줄이기 불가, 늘리기만" 같은 규칙이 필요 |
| D-4 | 새 초안의 필수 표기 모양 | 새로 만드는 표기는 spec 표기 프리셋(38, 흰 배경, 왼쪽 위), 이미 저장된 표기는 그대로 |
| D-5 | "위치 확인 필요" 칩 저장 | 이 화면에서만 표시(저장 칸 새로 만들지 않음) |
| D-6 | 버전 목록·되돌리기 화면 | P2-3a 밖, 작게 따로 배정 |
| D-7 | 글꼴 7종 파일 설치 | 별도 작업(외부 내려받기·해시 기록·용량 확인) |
| D-8 | 내보내기 `edit/timeline.json` + 쓰인 글꼴·라이선스 | P2-3a에 포함 추천(안 하면 새 값이 묶음에서 조용히 빠짐) |
| D-9 | 나누기 | P2-3a(편집 칸·프리셋·글꼴·경고·저장·미리보기) / P2-3b(타임라인 글자 줄·키) |

### 7.1 디자인·spec 확인 요청 (T080 Claude design에 직접 전달)

> **T-080 답(b3c7af7, `msg_934ca8e0abb3`) 반영:** ① 자간 = 짧은 변 1080 기준 px ② 외곽선 = 바깥으로 보이는 두께 ③ 필수 표기 지울 수 없음 + 종류별 이유 글(T-080 2.3) ④ "광고"만. 구현 때 `TextView` 자간을 `px`로, 외곽선을 `2×width` + `paint-order`로 고치고, "P2-3 이전 경로(P1 이관·정적 편집기)는 letterSpacing 0·stroke null만 씀" 시험을 추가해요(R-3). 옮긴 r1의 시간 안내는 P1 원래 초를 읽을 수 있을 때만 보여요(R-6). 아래는 원래 질문이에요.

1. **`letterSpacing` 단위:** spec `units`에 없어요. 미리보기 `TextView`는 `em`으로 그리는데, 훅 프리셋 −1이 `−1em`이면 글자가 완전히 겹쳐요. **"짧은 변 1080px 기준 px"로 정하는 것을 추천**해요(fontSize와 같은 기준). 정해지면 `TextView` 한 줄을 고쳐요.
2. **외곽선 두께 뜻:** `-webkit-text-stroke`는 가운데 기준이라 바깥으로는 두께의 절반만 나와요. spec `width`가 전체 두께인지 바깥 두께인지 정해 주세요. 측정·렌더를 같게 맞추려는 것이에요.
3. **표기 지우기:** DESIGN 6.8·T-033 4.3은 "확인 패널 후 지움"인데, 지금 서버는 필수 표기 삭제를 거절해요. **추천은 "지울 수 없음 + 이유 문구"**예요. ConfirmPanel은 필수가 아닌 잠긴 글자에만 쓰는데, 지금은 그런 글자가 없어요. DESIGN 10장 체크 문구를 맞춰 주세요.
4. **표기 "유료 광고 포함":** spec fixedTexts에는 있지만 서버 필수 문구는 "광고"만 받아요. P2-3은 "광고"만 고를 수 있게 둬요. 다른 문구를 허용하려면 기준을 따로 정해 주세요.
5. GAP 목록 G1~G10 중 P2-3a와 맞물리는 것은 G1·G2·G3·G4·G8·G9·G10이에요(G5·G6·G7은 P2-3b·버전 화면).

---

## 8. 하지 않은 것

- 코드·시험·브라우저 실행 없음(설계만). 글꼴 실측·파일 크기는 재지 않았어요.
- 자동 저장, "내 모양"(`text_presets`), 비율 바꿔 새 버전 만들기(U-2), 렌더(P2-4)·오디오(P2-5)는 범위 밖이에요.
