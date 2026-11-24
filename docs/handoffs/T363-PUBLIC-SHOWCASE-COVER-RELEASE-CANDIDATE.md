# T363 공개 홈 표지·장애 안내 최소 릴리스 후보

2026-11-19 · Codex(Front)
- 배정: Master `msg_7a10a1f0c953`
- B안 승인: `msg_5be603dea10a`(화면 의존성만 포함)
- push·배포 없음. Master 후속 확인 예정

## r2 — 공개 홈 '예시' 표시 제거 (주인님 결정, 2026-11-19)

**결정 내용**
- 주인님 지시: "이미지와 문구에 예시로 들어간 단어는 싹 빼고 실제처럼 보이게 해"
- PLAN R5(샘플을 완성품처럼 보이게 하지 않기)와 부딪혀서 주인님께 확인했어요. **R5 예외 승인**과 **로컬 + T363 후보 반영**으로 답을 받았어요.
- 이제 방문자는 소개용 6개 작품·크리에이터를 실제 작품처럼 보게 돼요.
- 내부 `sample` 값은 그대로 둬요. 표지 대체·이미지 경로 판단에 쓰기 때문이에요.

**새 후보**
- ref: `refs/heads/release/public-showcase-cover-20261119-r2`
- 커밋: **`2511a1e5448dcac5f15b8ffd4f0e29d816119f53`**(부모 `3c57eff`, 고정 직전 원격 재확인)
- 트리: `7180e2153abd52a9078dc67f00811261b0bf2da2`, 4경로 +341 / −52
- 아래 '후보'의 `90ac7d1` ref는 지우지 않고 그대로 뒀어요. r2가 그 내용에 아래 변경을 더한 것이에요.

| 경로 | blob | 90ac7d1 대비 |
|---|---|---|
| `components/public-showcase/neon-showcase.tsx` | `f32be1dc2fa848368006d26538479ac5850d66db` | 카드 "예시 작품" 배지, 위쪽 안내 문단, 대표 "대표 작품 · 예시" → "대표 작품", 아래쪽 안내 문구, 상세 머리글 "PUBLIC SHOWCASE / 예시 작품" → "PUBLIC SHOWCASE" 제거, 안 쓰는 `hasSample` 제거 |
| `components/public-showcase/neon-showcase.module.css` | `adc6032abd304fe78b7c15c50dafc06ef7f07658` | 안 쓰는 `.sample`·`.notice`(+ 좁은 화면 `.notice`) 제거 |
| `lib/public-showcase/works.ts` | `11f7420e80fd9f846aef1780c41c9490ae62d93d` | 작품 설명 6개 끝의 "… 예시예요." → "…이에요/예요." |
| `tests/public-showcase/neon-showcase.test.ts` | `cb8588862269b7d34089d76472db264ec93da707` | '예시가 보여야 한다'는 검사 2곳을 '예시가 없어야 한다'로 바꿨어요. 작품 글·상세 머리글 재발 방지 검사를 더했어요 |

**확인** (원격 + r2 격리 사본)
- 공개 홈 집중 2파일 30건 통과, tsc 0, ESLint 통과, build 성공
- 전체 Vitest는 2,201 통과·1 실패였어요. 실패는 `p2-5b-dsp-fixes` 소리 도구 시험(`TOOL_FAILED`)이고, 단독으로 다시 돌리니 21/21 통과했어요. T357 때와 같은 불안정 시험이고 이번 변경과 관계없어요.
- 브라우저(ego 공간 120·121 닫음): 운영과 같은 예시 모드 홈 1280·390에서 화면 글의 '예시' 0, 대표 배지 "대표 작품", 아래쪽 "DREAM · PUBLIC SHOWCASE", 가로 넘침 0. 첫 작품 상세 머리글은 "PUBLIC SHOWCASE", 상세 안 '예시' 0이에요.
  - 첫 확인에서 상세 머리글이 따옴표째 `"PUBLIC SHOWCASE"`로 보이는 실수를 발견해 고쳤어요. 설명 문장에 남은 '예시'도 이때 찾아서 뺐어요. 둘 다 시험으로 막았어요.
- **남은 안내 하나:** 상세의 재생 안내 "재생할 수 있는 영상 파일이 아직 연결되지 않았어요."는 '예시'가 아니고 실제 상태 안내라서 그대로 뒀어요.

**로컬 master에도 같은 변경**
- 위 4경로와 `tests/public-showcase/showcase-feed.test.ts`의 예시 배지 검사 1곳이에요.
- 로컬 공개 홈 집중 13파일 147건 통과, tsc 0, ESLint 통과.

## 후보 (r1, 참고)

| 항목 | 값 |
|---|---|
| 기준 | `origin/master` **`3c57eff`**. 시작·고정 직전 두 번 `git fetch`로 재확인했고 드리프트는 없어요 |
| 로컬 후보 ref | `refs/heads/release/public-showcase-cover-20261119` |
| 후보 커밋 | **`90ac7d1ba8db1c6dda8a9be0570d2aee624bc711`**(부모 `3c57eff`) |
| 후보 트리 | `340e7cce881c5c45b369c4b606c073ff49722ff2` |
| 바뀐 경로 | 3개, +326 / −35 |

바뀐 경로별 blob:
- `components/public-showcase/neon-showcase.tsx` → blob `6750dd8788fa00267f6ccf27c7111afdd697aa91`
- `components/public-showcase/neon-showcase.module.css` → blob `be0a11251922848ccd9596da697c87a2571ff440`
- `tests/public-showcase/neon-showcase.test.ts` → blob `be36c71615af1bf9578cf3fad521e65fb9f8873f`

**고정 방법**
- 임시 인덱스(`GIT_INDEX_FILE`)에 `read-tree origin/master`를 하고, 위 3 blob을 `update-index`로 넣었어요.
- 그다음 `write-tree`, `commit-tree -p origin/master`, `update-ref <ref> <sha> 0000…`(새 ref만 허용)로 고정했어요.
- 작업본·실제 인덱스·master는 건드리지 않았어요.

## 담은 것과 출처

| 출처 | 담은 조각 |
|---|---|
| T250 `a50e821`(의존성) | 컴포넌트·CSS·시험 조각만(인계 문서는 제외)이에요. 내용은 아래 '담은 T250 조각' 참고 |
| T357 `982b357` | 장애 화면의 대표·음악 영역 빈 문구를 목록 상태(`status`)에 맞춤 + 시험 |
| T360 `df05e0a` | 표지 불러오는 중·성공·실패 상태(주소별 공유, 실패 고정), `CoverPlate`·`DetailCover`, 카드 `↗`·실패 시 `aria-describedby`, 대표 상태 한 줄, 음악 `coverBox`, 재생 안내 분리, 늦은 실패 알림 + CSS + 시험 |
| T360-F1 `f5a155c` | 영상 상세: 알려진 실패면 `poster` 생략, 조작 줄을 비운 `.mediaPlate` 바탕, `onPlaying` 뒤 바탕 내림 + 시험 |

**담은 T250 조각** — 상세의 `WorkMedia` 재생 상태 화면이에요.
- `WorkMedia` 컴포넌트: 불러오는 중·오류 안내, 다시 불러오기, 닫을 때 정지
- `useLayoutEffect`·`SyntheticEvent` import
- `trapTab`의 재생 조작 예외
- `pauseDetailMedia`, `dialog onCancel`, 닫기 버튼의 정지
- 상세 분기(`opened.media ? <WorkMedia/> : 정지 이미지`)
- CSS `.mediaFeedback`, `.mediaFeedback .btn`
- 시험 2건: 예시 안내 문구, 재생 작품과 예시가 섞였을 때

T360의 `DetailCover`와 T360-F1의 `poster`·바탕이 이 `WorkMedia`를 직접 고쳐서 빠질 수 없어요.

**같이 들어간 보이는 문구 1곳**
- T250 조각에는 예시 안내 문구 변경이 들어 있어요.
  - 바뀌기 전: "지금 보이는 작품과 크리에이터는 화면을 소개하는 예시예요. 영상·음악은 아직 재생되지 않아요."
  - 바뀐 뒤: "‘예시’로 표시된 작품과 크리에이터는 화면 소개용이에요. 예시 작품에는 재생 파일이 연결되어 있지 않아요."
- 재생 작품과 예시가 섞일 때 문구가 틀리지 않도록 같이 바뀐 것이에요. 이 시험 1건과 묶여 있어요.
- 표지 대체 동작에는 필요 없어서, 빼길 원하면 문구와 시험 1건만 되돌리면 돼요.

## 제외한 것

| 제외 | 처리 |
|---|---|
| T-254 `710c2c1` `Image unoptimized={!X.sample}` 4곳, 커버 라우트·`proxy.ts`·`next.config.ts`·`cover-path`·`cover-source` | 속성을 빼고 원격처럼 기본 `Image`(Next 최적화 경유)로 둬요. 라우트·설정 파일은 넣지 않았어요 |
| T-255-F1~F3 `c4afb29`·`4b4c350`·`4149e20`: `<a>` 새 문서 링크, `installShowcaseGuard` import·effect, 가드 런타임·`showcase-guard.tsx`·`page.tsx` | 원격처럼 `next/link`의 `Link` 4곳을 유지했어요. 가드 import·effect는 넣지 않았어요 |
| 생산 공급원·DB·`publication-*`·feed, `app/(public)/page.tsx` | 넣지 않았어요. 원격 홈은 `SAMPLE_WORKS`만 넘기는 그대로예요 |
| `tests/public-showcase/cover-route.test.ts`(원격에 없음), T357·T360·T360-F1 인계 문서 | 넣지 않았어요 |

**포팅 방법**
- 로컬 `f5a155c`의 3파일에서 제외 대상만 원격 형태로 되돌렸어요.
- 원격 + T250 조각 + T357(둘 다 깨끗하게 얹힘)과 로컬 T357 시점(`982b357`)을 비교하면, 남는 차이는 위 제외 대상뿐이에요. 그래서 포팅본과 로컬 `f5a155c`의 차이도 제외 대상 줄(tsx 11+/17−)과 시험 2곳뿐이에요.

**시험 조정 2곳(후보 전용)**
1. 소스 import 허용 목록에서 `showcase-guard-runtime`을 뺐어요. 가드를 제외했기 때문이에요.
2. T360 첫 시험의 "원래 주소 그대로" 검사를 `/_next/image?url=${encodeURIComponent(src)}`로 바꿨어요.
   - 원격에는 `unoptimized`가 없어서, 비예시 이미지가 최적화 주소 안에 원래 주소를 담아 나가기 때문이에요.
   - 뜻(주소 변경·새 공급원 없음)은 같아요.

## 검증 (메인 PC 격리 사본, `git archive origin/master` + 후보 3파일)

| 확인 | 결과 |
|---|---|
| 공개 홈 집중 시험 `tests/public-showcase`(원격엔 `neon-showcase.test.ts` 1파일) + `t241-public-home-route` | **2 파일 30건 통과** |
| `tsc --noEmit`(생성 `.next` 제외) | 오류 0 |
| ESLint `components/public-showcase`·`tests/public-showcase`·`app/(public)` | 통과 |
| 전체 Vitest(`.tools/ffmpeg` 실파일 복사) | **파일 113 통과·10 건너뜀, 시험 2,202 통과·319 건너뜀·실패 0** |
| `npm run build`(순수 후보, 사본 전용 패치 전) | 성공 |
| 예시 모드(`/`, 운영과 같은 `SAMPLE_WORKS`) | 다 그려진 뒤 대체 바탕 0, 대표 상태 문구 없음, 깨진 이미지 0, `NEON AFTER HOURS` 응답 |

**합성 브라우저 확인**
- 사본에만 바꾼 것(후보에 없음):
  - 홈 `?t363=published|revoked`에 합성 비예시 작품 11건을 넣었어요.
  - `/t363-cover/<이름>` 합성 표지 라우트: 정상, 4초 지연, 404, 깨진 PNG, 3초 뒤 404.
  - 재생되는 3초 mp4를 넣었어요.
- 원격 기준이라 카드·대표·음악 이미지는 Next 최적화를 거쳐요. 최적화 응답은 정상 200, 404는 404, 깨진 바이트는 400, 지연은 4.3초였어요.
- 다시 빌드한 뒤 `next start -p 3363`으로 실행했어요. ego 새 공간 118·119에서 확인하고 닫았어요. 시험 담당에게 시작·끝을 알렸고 쿠키는 쓰지 않았어요.

| 확인 | 결과 |
|---|---|
| 처음 → 끝 상태 | 대표 "표지 불러오는 중"+그라데이션 → 이미지·문구 없음. 지연 카드는 불러오는 중 → 정상. 404·깨짐은 실패(이미지 없음·설명 연결). 늦은 실패는 불러오는 중 → 실패. 음악은 정상 / "표지 조회 실패" ×2 |
| 404 작품 상세(키보드) | 대체 바탕 + 실패 문구, 재생 안내 분리, 닫기 초점, Esc 뒤 카드 복귀. 표지 요청 1 → 1 |
| 늦은 실패 상세 | 불러오는 중 → 실패, 알림 1회, 초점 유지·복귀 |
| 음악 재생 + 표지 실패 | 대체 바탕 + `audio`, 음악 버튼으로 복귀 |
| 영상 + 알려진 표지 실패 | `poster` 없음, `.mediaPlate` 보임. 요청은 최적화 주소 1, 원래 주소 0이고 열기·재생 시도 뒤에도 같아요. 재생 시도 뒤 재생 오류·다시 불러오기가 나오고 바탕은 유지돼요. 클릭·키보드 모두 초점 복귀 |
| 재생되는 영상 + 표지 실패 | 누름은 `VIDEO`가 받고, 조작 줄 56px 비움. 재생 뒤 바탕이 사라지고 0.8초까지 진행. 요청 수 그대로 |
| 정상 표지 영상 | `poster` = 원래 주소, 바탕 없음. 재생 오류는 재생 시도 뒤에만 나와요 |
| 철회 목록 | 빠진 작품의 카드·상세가 없어요 |
| 320 / 390px | 가로 넘침 0, 문구 최대 2 / 1줄, 누를 영역 69 / 92px 이상, 영상 상세 바탕 124 / 177px |

## 검증 한계

- **정상 표지 영상의 요청 두 번:** 원격 기준에서는 카드 이미지가 최적화 주소로, 영상 `poster`는 원래 주소로 따로 요청돼요. 그래서 정상 표지 영상은 상세를 열 때 원래 주소 요청이 1회 더 생겨요(확인: 최적화 1 + 원래 1).
  - 원격의 기존 `poster={opened.image.src}`와 같은 동작이라 회귀는 아니에요.
  - 실패한 표지는 원래 주소로도 다시 요청하지 않아요.
- **새 주소 확인 생략:** 원격 기준에는 승인 세대(새 주소) 개념이 없어서, 새 주소 재시작 확인은 로컬 T360-F1(`f5a155c`) 결과로 갈음해요. 지연 표지 영상 단계도 같은 이유로 T360-F1 결과를 따라요.
- **운영 홈은 예시만:** 운영 홈은 예시 작품만 보여 줘서, 표지 실패 화면은 예시 이미지가 깨질 때만 실제로 나타나요.
- **재생 주소 없음:** 실제 재생 주소는 원격 공개 자료에 없어요. 재생 관련 확인은 합성 재생 주소 조건이에요.
- **자동 키보드 입력:** 자동 `Enter`로 상세를 열 때 바로 닫히는 현상이 1회 있어 다시 시도했어요(`keyboardRetries 1`). T360 문서에 적은 것과 같은 현상이에요.

## 정리

- 서버를 멈췄어요(3363 대기 0).
- 사본은 재분석 지점을 먼저 지우고 폴더째 삭제했고, 임시 인덱스도 지웠어요.
- 저장소 `node_modules`는 283개 그대로이고, 작업본에서 바뀐 화면·시험 파일은 0이에요.
- push·배포·운영 설정 변경은 없어요. 새 창·에이전트·worktree도 없어요.
