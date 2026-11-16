# T-067 · P2-2 미리보기 Player 기술 연결 설계

| 항목 | 내용 |
|---|---|
| 담당 / 지시 | CC-DATA-01 (Claude Code) / Master `msg_190fde86f640` |
| 확인일 | 2026-11-16 |
| 기준 코드 | `98bca82` (P2-1 `d8768a8` 포함) |
| 바꾼 파일 | 이 파일 하나. 제품 소스·`package.json`·lock·설치·0005 원문·기준/공용 문서는 바꾸지 않았다 |
| 함께 보는 문서 | T-068 `T-068-PLAYER-UX.md`(보이는 것·누르는 것 — 이 문서는 그 화면을 **어떻게 연결하는지**만), T-037(라이선스 원문), T-060·T-061(타임라인) |
| 성격 | 설계. P2-2 구현 착수가 아니다. 아래 "구현 때"는 배정 뒤의 일이다 |

## 0. 결론 요약

1. **패키지 2개만**, 정확히 고정: `remotion@4.0.543`, `@remotion/player@4.0.543`(`^` 없이). `@remotion/cli`·`@remotion/media`·`@remotion/renderer`는 P2-2에 넣지 않는다.
2. 화면은 **기존 편집 화면 안 client 컴포넌트**에서 `next/dynamic(..., {ssr:false})`로 Player를 불러온다. 서버 코드·DB·API는 바꾸지 않는다.
3. Player 입력은 **지금 화면의 초안 타임라인(`draft`)을 순수 함수로 바꾼 값**이다. 미리보기는 아무것도 저장하지 않고 `value`·dirty·버전·DB를 건드리지 않는다.
4. Player 기본 조작(`controls`)은 끄고, 키·버튼은 T-068대로 **우리 요소에만** 단다. 기본 `spaceKeyToPlayOrPause`는 재생 버튼으로 초점을 옮기므로 반드시 `false`(3.4).
5. 자료는 지금 보호 API `/api/assets/{id}`(같은 출처, Range 지원)를 그대로 쓴다. `staticFile()`·`public/` 복사 없음.
6. 글꼴은 Player에서 `delayRender()`가 **효과가 없으므로**(공식 문서) Player를 띄우기 전에 `document.fonts.load()`로 기다린다.

## 1. 읽은 출처와 확인 범위

| # | 출처 | 확인 범위 |
|---|---|---|
| N1 | npm 레지스트리 `npm view @remotion/player@4.0.543`, `remotion@4.0.543` | version, license, peerDependencies, dependencies, engines(없음), tarball, integrity. `dist-tags.latest`는 **4.0.544**(2026-11-16T07:52Z 공개), 4.0.543은 2026-11-11T16:43Z |
| N2 | 공식 tarball `player-4.0.543.tgz`, `remotion-4.0.543.tgz` (저장소 밖 임시 폴더에 압축만 풀고 글자만 읽음, 설치·실행 안 함) | `package.json` exports, `LICENSE.md`(2,849바이트, SHA-256 앞 16자리 `53e92b6560f26f9d` — T-037 S0과 같음), `dist/cjs/Player.d.ts`·`player-methods.d.ts`·`event-emitter.d.ts`·`browser-mediasession.d.ts`, `dist/esm/index.mjs`의 키·초점·숨김 탭·버퍼 부분 |
| D1 | https://www.remotion.dev/docs/player/player | Props·PlayerRef 메서드·이벤트 표 전체 |
| D2 | https://www.remotion.dev/docs/player/installation | 같은 버전 정확 고정 안내 |
| D3 | https://www.remotion.dev/docs/player/best-practices | Player 다시 그리기 피하기(조작은 형제 컴포넌트) |
| D4 | https://www.remotion.dev/docs/player/scaling | 크기 계산 규칙 |
| D5 | https://www.remotion.dev/docs/player/buffer-state | 버퍼 상태, `pauseWhenLoading`·`pauseWhenBuffering` |
| D6 | https://www.remotion.dev/docs/player/premounting | Player 기본 premount 없음, 5.0은 2초 |
| D7 | https://www.remotion.dev/docs/player/media-keys | `browserMediaControlsBehavior` 기본 `prevent-media-session` |
| D8 | https://www.remotion.dev/docs/img | `onError`, 재시도 2회, 실패 시 `cancelRender` |
| D9 | https://www.remotion.dev/docs/offthreadvideo | 미리보기에서는 `<video>`, `trimBefore`, `durationInFrames`(4.0.530부터), `onError`, `pauseWhenBuffering` |
| D10 | https://www.remotion.dev/docs/video-tags | 세 영상 컴포넌트 비교(CORS 필요 여부, 미리보기 방식) |
| D11 | https://www.remotion.dev/docs/delay-render | "It has no effect when you are in a preview environment (e.g. Studio or Player)." |
| D12 | https://www.remotion.dev/docs/fonts | 로컬 글꼴 불러오기 방식 |
| D13 | https://www.remotion.dev/docs/player/integration | 수동 설치 예(우리는 Studio를 쓰지 않으므로 `@remotion/cli` 제외) |
| D14 | https://www.remotion.dev/docs/sequence | `from`·`durationInFrames` |
| D15 | https://www.remotion.dev/docs/miscellaneous/nextjs | `serverExternalPackages`는 `@remotion/renderer`용 안내 |
| X1 | https://nextjs.org/docs/app/guides/lazy-loading (Next 16 문서) | "ssr: false option will only work for Client Components" |

웹 문서는 날짜가 "Last updated on Nov 14, 2026"이고 **최신(4.0.544) 기준**이다. 4.0.543과 다를 수 있는 부분은 N2(실제 배포본 타입·코드)로 다시 확인했고, 확인한 것만 아래에 적었다. 추측한 API는 쓰지 않았다.

## 2. 패키지·버전·라이선스

| 패키지 | 고정 버전 | peerDependencies (N1) | 우리 값 | 판단 |
|---|---|---|---|---|
| `remotion` | `4.0.543` | `react >=16.8.0`, `react-dom >=16.8.0` | react·react-dom `19.3.1` | 맞음 |
| `@remotion/player` | `4.0.543` | 같음. dependencies `remotion: 4.0.543`(정확) | 같음 | 맞음 |

- **Next 16.4.6·Node 26**: 두 패키지 모두 `engines`가 없고 Next를 peer로 두지 않는다(N1). 즉 배포 정보상 제한도 보증도 없다 → 구현 때 production build·브라우저 확인이 근거다(6장).
- **4.0.544가 나왔지만 4.0.543을 쓴다.** 라이선스 원문 대조(T-037)와 개인 사용 확인(T-040)이 4.0.543 기준이다. 올리려면 그 배포본 LICENSE를 다시 대조한다(T-037 8-2).
- 설치(구현 배정 뒤, Master 승인 후): `npm i --save-exact remotion@4.0.543 @remotion/player@4.0.543` — D2 안내대로 모든 Remotion 패키지 같은 버전, `^` 없음. lockfile 변경은 그 커밋에만.
- **넣지 않는 것**: `@remotion/cli`(Studio 불필요), `@remotion/media`(D10: 새 코드에 권장되지만 **CORS 필요**·별도 패키지라 LICENSE 대조가 하나 더 필요. 미리보기는 core의 `OffthreadVideo`로 충분 — 3.2), `@remotion/renderer`(P2-4).
- **`acknowledgeRemotionLicense`**: D1 설명은 "Acknowledge the Remotion License to make the console message disappear." 4.0.543 LICENSE의 "an individual" 무료 대상(T-037 3장)이고 사용 주체가 은영님 개인 활동으로 확정(T-040, PLAN 2.3)이므로 **이 근거를 주석으로 남기고 `true`**를 준다. 조직 전환·P7·버전 변경 때 다시 확인.

## 3. 파일별 설계 (구현 때)

### 3.1 `lib/edit/preview.ts` (새 파일, 순수, client에서도 사용)

서버 전용 모듈(`server-only`, `@/lib/db`, `@/lib/repo`, `@/lib/services`)을 import하지 않는다. 입력을 고치지 않는다(새 객체만 반환).

```ts
type PreviewAsset={kind:"image"|"video";available:boolean};          // assetId → 지금 화면이 아는 자료 상태
type PreviewClip={sceneId:string;from:number;durationInFrames:number;
  source:{type:"empty"}|{type:"missing"}|{type:"image";src:string}|{type:"video";src:string;trimBefore:number}};
type PreviewText={id:string;layer:TimelineText;box:TimelineText["box"];movedForPreview:boolean};
type PreviewProps={fps:30;width:number;height:number;durationInFrames:number;clips:PreviewClip[];texts:PreviewText[];reducedMotion:boolean};
export function previewProps(t:Timeline,assets:ReadonlyMap<string,PreviewAsset>,o:{aspect:Timeline["aspect"];reducedMotion:boolean}):PreviewProps|null;
export function formatFrameTime(frame:number):string;   // T-068 3장 MM:SS.FF / H:MM:SS.FF
```

- **크기**: `9:16 → 1080×1920`, `1:1 → 1080×1080`, `16:9 → 1920×1080`. 지금 정지 미리보기의 글자 크기 기준(`fontSize / (16:9 ? 1920 : 1080)` × 폭, `editing-panel.tsx`)과 같은 기준이라 글자 `fontSize`를 px 그대로 쓴다.
- **클립 위치**: `from` = 앞 클립 `durationFrames`의 합, `durationInFrames = clip.durationFrames`. 빈 자리(`assetId === null`) → `empty`. 자료가 없거나 `available:false` → `missing`(요청하지 않음). 이미지 → `src = /api/assets/{assetId}`. 영상 → 같은 src + `trimBefore = trimInFrames`(T-060: 영상은 `durationFrames = 원본 − trimIn − trimOut`).
- **전체 길이**: `max(영상 합계, 글자 endFrame 최대)`. 0이면(장면 0개) `null` → T-068 "비어 있음"(Player를 띄우지 않음). D1: `durationInFrames`는 "an integer and greater than 0".
- **미리보기 비율**(T-068 2.2): `o.aspect`가 저장된 `t.aspect`와 다를 때만 크기를 바꾸고, spec `text-presets.json` `safeArea[aspect]` 밖으로 나가는 글자 **상자 위치**만 안쪽으로 옮긴 사본을 `box`에 넣고 `movedForPreview:true`. `layer`(원본)는 그대로 둔다. 실제 글꼴로 잰 경계 판단(spec rule)은 화면 쪽 측정(3.3)이 하고, 이 함수는 상자 기준 1차 이동만 한다.
- **움직임 줄이기**: 값만 전달. 지금 타임라인의 `animation`은 모두 `none`이라 P2-2에서 달라지는 것은 없고, P2-3에서 움직임을 그릴 때 이 값으로 생략한다(렌더 P2-4는 항상 `false`).

### 3.2 `components/player/timeline-composition.tsx` (새 파일, `"use client"`)

Remotion 구성 요소. `<Composition>`으로 감싸지 않는다(D1 "The Player does not use `<Composition>`'s").

| 칸 | 쓰는 것 (모두 `remotion` core) | 이유·출처 |
|---|---|---|
| 바탕 | `AbsoluteFill` | — |
| 클립 | `<Sequence from durationInFrames>` | D14 |
| 이미지 | `<Img src pauseWhenLoading onError>` | D8: `onError` 없이 실패하면 재시도 2회 뒤 `cancelRender` → Player 전체 오류. 그래서 **반드시 `onError`**를 주고 그 클립만 `missing` 표시로 바꾼다(컴포넌트 안 state). `pauseWhenLoading`은 4.0 기본 false(D8) → `true` |
| 영상 | `<OffthreadVideo src trimBefore durationInFrames muted pauseWhenBuffering onError>` | D9: 미리보기에서는 `<video>`, **CORS 불필요**(D10), `onError`를 주면 예외를 던지지 않음, `pauseWhenBuffering` 4.0 기본 false → `true`. 미리보기는 프레임 정확을 보장하지 않음(D10 표 "Html5 video" 기반, D9 `acceptableTimeShiftInSeconds` 기본 0.45초에서 다시 맞춤) |
| 빈 자리·없음 | 회색 칸 + 문구(T-068 2.3) | 요청 없음 |
| 글자 | `div` + `fontFamily: var(--font-pretendard)` + `box`(비율 좌표) + `style` | 지금 정지 미리보기와 같은 계산을 공용 함수로 |

- **소리**: P2-2는 영상 소리를 `muted`로 둔다(오디오는 P2-5). `numberOfSharedAudioTags={0}`(N2: 0 이상 정수 허용, 5.0 기본값도 0). → Master 확인 D-3.
- Composition은 `@/lib/edit/preview`와 `remotion`만 import한다.

### 3.3 `components/player/player-panel.tsx` (새 파일, `"use client"`)

Player와 조작 줄, 상태. D3대로 **Player만 그리는 컴포넌트**와 **조작·시간 표시 컴포넌트**를 나누고 `PlayerRef`를 넘긴다(시간이 바뀔 때 Player가 다시 그려지지 않게).

Player에 주는 값(모두 N2 타입·D1에 있음):

```tsx
<Player ref={ref} component={TimelineComposition} inputProps={props /* useMemo */}
  durationInFrames={p.durationInFrames} compositionWidth={p.width} compositionHeight={p.height} fps={30}
  style={{width:"100%"}}                       // D4: 폭만 주면 높이는 비율로
  controls={false} clickToPlay={false} doubleClickToFullscreen={false} allowFullscreen={false}
  spaceKeyToPlayOrPause={false}                // 3.4
  loop={false} autoPlay={false} moveToBeginningWhenEnded={false}   // T-068: 끝 프레임에서 멈춤
  initialFrame={frameToKeep}                   // 마운트 때만 적용(D1)
  defaultPremountInSeconds={2}                 // D6: Player 기본 premount 없음, 5.0 기본 2초
  numberOfSharedAudioTags={0}
  browserMediaControlsBehavior={{mode:"prevent-media-session"}}   // D7 기본값을 명시
  errorFallback={({error})=>…}                 // T-068 "오류" 상태
  acknowledgeRemotionLicense                   // 2장 근거
/>
```

| T-068 상태 | 연결 |
|---|---|
| 불러오는 중 | ① `next/dynamic` 불러오는 동안 ② 글꼴 기다리는 동안(3.5) — Player를 아직 그리지 않음 |
| 멈춤 / 재생 중 | `play`·`pause`·`ended` 이벤트(N2 `PlayerStateEventMap`)로 우리 state 갱신. 재생 버튼: 마지막 프레임이면 `seekTo(0)` 뒤 `play()` |
| 기다리는 중 | `waiting`·`resume` 이벤트(N2: 버퍼 상태가 바뀌면 `dispatchWaiting/Resume`). `pauseWhenLoading`·`pauseWhenBuffering`을 켜야 생김 |
| 오류 | `errorFallback` + `error` 이벤트. "다시 불러오기" = Player `key` 바꿔 다시 마운트 |
| 비어 있음 | `previewProps(...) === null` → Player 없음 |

- **시간 표시**: `frameupdate`(D1: 재생·seek 모두에서 발생)로 숫자 갱신. 화면 읽기 알림은 `pause`·`seeked` 뒤 0.3초 조용할 때만(T-068 3장).
- **seek**: `ref.seekTo(clamp(frame, 0, durationInFrames - 1))`. D1: 재생 중 seek는 잠깐 멈췄다 이어 감 → T-068 2.1 규칙과 맞음.
- **비율 버튼**: 컴포넌트 안 `useState`만 쓴다. 바꾸면 지금 프레임(`getCurrentFrame()`)을 기억하고 Player `key`를 바꿔 다시 마운트, `initialFrame`으로 그 위치에서 시작(T-068 "비율 바꿈 직후 = 불러오는 중"). `value`·`draft`·dirty·API는 건드리지 않는다.
- **탭 숨김**: Player는 숨겨져도 멈추지 않는다(N2 `index.mjs`: 숨김 때 `requestAnimationFrame` 대신 `setTimeout`으로 계속 진행). 그래서 우리 쪽에서 `document` `visibilitychange`가 `hidden`이면 `ref.pause()`, 돌아와도 자동 재생 안 함(T-068 Q-4 답).
- **안전 영역 측정**: 지금 편집 화면처럼 `ResizeObserver` + 그려진 글자 요소의 `getBoundingClientRect()`로 잰다(spec rule "실제 글꼴로 그린 바깥 경계"). Player 컨테이너는 `ref.getContainerNode()`(D1)로 얻는다.

### 3.4 키보드·초점 분리

- **Player 기본 키를 쓰지 않는다.** N2 `index.mjs`(약 1715행): `spaceKeyToPlayOrPause`가 켜져 있고 재생 버튼이 있으면 **`playing`이 바뀔 때마다(마운트 포함) 재생 버튼에 `focus()`**한다. 글자 칸에서 타이핑하는 중 초점을 뺏을 수 있어 `spaceKeyToPlayOrPause={false}` + `controls={false}`로 막는다(D1: Space 재생은 "Only works if controls is true").
- Player 안에서 `window` keydown을 다는 곳은 재생 속도 메뉴뿐이다(N2 약 910행, `showPlaybackRateControl`을 켜야 나옴) → 켜지 않는다.
- 우리 처리기는 **무대 감싼 `div tabIndex=0`과 조작 버튼에만** `onKeyDown`(T-068 4.1). `document`·`window` 처리기 없음. 처리하면 `preventDefault()`+`stopPropagation()`. 글자 칸은 무대 밖이라 이벤트가 오지 않는다.
- 무대 접근 이름: `aria-label="미리보기 · 9:16 · 00:08.10"`(T-068 4.2). 초점 링은 무대 감싼 요소에 그린다(영상 위에서도 보이게 `outline-offset`).

### 3.5 글꼴 준비

- 앱은 `next/font/local`로 `public/fonts/PretendardVariable.woff2`를 `--font-pretendard` 변수로 싣는다(`app/layout.tsx`). Player는 **같은 문서 안**에 그려진다(N2에 iframe 없음) → 같은 변수를 그대로 쓴다.
- D11: Player에서 `delayRender()`는 효과가 없다. 그래서 Player를 띄우기 **전에** 쓰이는 굵기마다 `document.fonts.load(\`${weight} ${size}px ${family}\`)`를 기다린다(브라우저 표준 API). 실패하거나 결과가 비면 T-068 2.3 "글꼴 없음" 표시로 띄우고(편집은 계속), 그 글자 경고에 "(대신 그린 글꼴 기준)".
- 재생 중 새 글꼴이 필요해지는 경우는 P2-3(글꼴 목록 확장) 때 `useBufferState().delayPlayback()`(D5)으로 연결한다. P2-2는 Pretendard 하나라 필요 없음.

### 3.6 `components/player/player-loader.tsx` (새 파일, `"use client"`)

```tsx
const PlayerPanel=dynamic(()=>import("./player-panel").then(m=>m.PlayerPanel),{ssr:false,loading:()=> <불러오는 중 칸/>});
```

- X1: `ssr:false`는 Client Component 안에서만 된다 → 이 파일 자체가 `"use client"`.
- `@remotion/player` 배포본 첫 줄이 `"use client"`이고 RSC에서 불리면 안내 오류를 낸다(N2 `_check-rsc`). 서버 컴포넌트에서 직접 import하지 않는다.
- 서버 렌더(HTML)에는 Player가 들어가지 않는다 → 처음 HTML에는 "불러오는 중" 칸만.

### 3.7 `components/editing-panel.tsx` (수정)

- "정지 화면 미리보기" 칸을 `PlayerLoader`로 바꾼다. 넘기는 값: `draft`(지금 화면 초안, 이미 있음), `data.aspect`, 자료 상태 맵(`data.production.scenes[].versions[].asset`에서 `assetId → {kind, available}` — **서버 변경 없음**), 샘플 여부.
- `draft`가 `null`(시간 오류)일 때는 **마지막으로 유효했던 props를 계속 보여 주고** T-068에 문구를 정해 달라고 한다(D-4).
- 저장 경로·SRT 미리보기·CAS·`savedSrt`는 그대로. 미리보기는 늘 프레임 시간(T-068 3.1).

### 3.8 바꾸지 않는 것

`lib/services/*`, `app/api/*`, DB·마이그레이션, `next.config.ts`(client 전용이라 `serverExternalPackages` 불필요 — 그 설정은 D15가 말하는 `@remotion/renderer`용), `scripts/verify-build.mjs`.

## 4. 저장·현재 내용 경계

| 무엇 | 미리보기가 바꾸나 |
|---|---|
| `value`(편집 값)·dirty | 아니오. 비율·재생 위치·안전 영역 보기는 PlayerPanel 안 state |
| 타임라인 행·버전 번호·내용 버전·`stage_states`·`activity_log` | 아니오. 미리보기는 API를 부르지 않는다(자료 GET만) |
| 장면 결과·작업(jobs) | 아니오. 생성 요청 0 |
| 저장된 `aspect`·`box` | 아니오. 비율 미리보기는 사본(`movedForPreview`)만 |

## 5. 빌드·서버 렌더·추적

- client 전용이므로 서버 추적 목록(`.next/server/**/*.nft.json`)에 Remotion이 필요 없다. 구현 때 `npm.cmd run build`(+ `verify-build`) 통과와, 편집 페이지 서버 응답 HTML에 Player 마크업이 없는 것을 확인한다.
- client 묶음 크기는 build 출력에서 **실제 값을 기록**한다(지금 추정치는 적지 않는다).
- 서버 전용 모듈이 client 그래프에 들어가지 않게 시험으로 막는다(6장 T3).

## 6. 구현 때 검증 방법

숫자 기준을 새로 지어내지 않는다. 기기 성능·재생 속도 수치는 쓰지 않고, **프레임 번호와 저장 상태가 같은지**만 본다.

**자동 시험 (vitest, node)**

| # | 내용 |
|---|---|
| T1 | `previewProps`: 클립 `from` 누적, 영상 `trimBefore`, 빈 자리·없음, 길이 = max(영상, 글자), 장면 0개 → `null`, 비율 바꾸면 크기·`movedForPreview`만 다르고 `layer` 같음, 입력 객체 그대로(얼린 객체로 확인) |
| T2 | `formatFrameTime`: T-068 6-3 예 0·31·254·750 → `00:00.00`·`00:01.01`·`00:08.14`·`00:25.00`, 마지막 위치 749 → `00:24.29` |
| T3 | import 경계: `lib/edit/preview.ts`·`components/player/*`가 `server-only`·`@/lib/db`·`@/lib/repo`·`@/lib/services`를 (직접·간접) import하지 않음 |
| T4 | 기존 시험 전부(407)와 s4·s5 그대로 |

(Player 자체를 node에서 그리는 시험은 하지 않는다. 지금 시험 환경은 `environment:"node"`이고 DOM 환경 패키지를 더하지 않는다.)

**production 브라우저 확인** (`next build` + `next start`, 127.0.0.1, 다른 포트, 임시 데이터 사본, ego-browser, 1280·390)

| # | 방법 | 통과 |
|---|---|---|
| B1 | 무대 초점에서 →·← | 시간 칸이 정확히 1프레임씩 바뀜(`00:00.00 → 00:00.01`) |
| B2 | Shift+→ | 30프레임(1초) 이동 |
| B3 | Home·End | `00:00.00`·마지막 프레임 |
| B4 | 재생 → 잠시 뒤 멈춤 | 시간 칸이 앞으로 갔고 멈춘 뒤 더 안 바뀜(속도 수치는 보지 않음) |
| B5 | 글자 칸에 Space·화살표 입력 | 글자는 바뀌고 시간 칸·재생 상태 그대로, 페이지 스크롤 없음 |
| B6 | 페이지 열자마자·재생/멈춤 뒤 `document.activeElement` | 사용자가 둔 곳 그대로(3.4 초점 이동 회귀) |
| B7 | 비율 3종 → 원래 비율 | 시험 전후 DB 사본 표 내용(행 수·`timeline_revisions`·`projects.content_revision`·`jobs`) 같음, dirty 표시 없음 |
| B8 | 확인하는 동안 브라우저가 보낸 요청 기록 | `/api` 쓰기 요청(POST·PATCH 등) 0, 자료 GET만 |
| B9 | 자료 파일 하나를 임시 사본에서 지움 | 그 구간만 "파일을 찾을 수 없어요", 재생은 계속, 오류 상태 아님 |
| B10 | CDP `Network.setBlockedURLs`로 글꼴 파일 막음 | "글꼴 없음" 표시, 편집·저장 동작 |
| B11 | CDP `Emulation.setEmulatedMedia` `prefers-reduced-motion: reduce` | 안내 문구, 재생·seek 같음 |
| B12 | 다른 탭으로 전환 | 재생 중이었으면 멈춤, 돌아와도 자동 재생 없음 |
| B13 | 가로 넘침, Tab 순서, 초점 링 | T-068 4.2·6-8 |
| B14 | 옮긴 r1 사본(s4·s5) | 미리보기는 프레임 시간, 묶음 SRT는 P1 시간 그대로(T-061 시험과 같은 결과) |

- 휴대폰 재생은 PLAN 종료 기준대로 **실제 기기 증거**가 필요하다. 390 에뮬레이션은 대신하지 않는다.
- 빌드: `npm.cmd run build`, 서버 HTML에 Player 마크업 없음, lint·typecheck·test.

## 7. T-068 질문에 대한 기술 답

| # | 답 |
|---|---|
| Q-1 기다리는 중 | **알 수 있다.** `waiting`·`resume` 이벤트(N2 타입·코드). 단 `Img pauseWhenLoading`·`OffthreadVideo pauseWhenBuffering`을 켜야 버퍼 상태가 생긴다(D5, 4.0 기본 false) → 3.2에서 켬 |
| Q-3 저장 전 고친 값 바로 그리기 | `inputProps`를 `useMemo`로 만들고 조작 UI는 형제 컴포넌트(D3). 처음엔 지연 없이 반영하고, 브라우저 확인(B5)에서 입력이 밀리면 T-068이 허용한 0.3초 지연을 넣는다. 수치 목표는 정하지 않음 |
| Q-4 탭 숨김 | `document` `visibilitychange` → `ref.pause()`. Player는 스스로 멈추지 않음(3.3) |
| Q-2·Q-5 | 기술 결정이 아님 — Master 판단 |

## 8. Master 확인이 필요한 것

| # | 내용 | 이 문서의 제안 |
|---|---|---|
| D-1 | 패키지 설치(lock 변경) 시점 | P2-2 구현 배정 커밋에서만, 2장 명령 그대로 |
| D-2 | 4.0.544가 나왔음 | 4.0.543 유지(라이선스 대조 기준). 올리면 LICENSE 재대조 |
| D-3 | P2-2 영상 소리 | `muted`(오디오는 P2-5) |
| D-4 | 시간 오류(`draft=null`) 동안 미리보기 | 마지막 유효 값 유지 + 문구는 T-068에서 |
| D-5 | `@remotion/media` | P2-2는 쓰지 않음. P2-4(렌더) 설계 때 다시 판단 |

## 9. 한계

- 설치·실행하지 않았다. Player 동작·성능은 실제로 보지 않았고, 위 판단은 배포본 타입·코드와 공식 문서 문장에 근거한다. 구현 때 6장으로 확인한다.
- 웹 문서는 4.0.544 시점 글이다. 4.0.543과 다를 수 있는 것은 배포본으로 다시 봤지만, 문서의 모든 문장을 배포본과 대조하지는 않았다.
- `@remotion/player` 배포본 코드는 키·초점·숨김 탭·버퍼·검증 부분만 읽었다.
- 법률 판단 아님(T-037과 같음).
