# T-071 P2-2 미리보기 실제 구현 (CC-DATA-01)

- 지시: Master `msg_d63ab41ac9c0` (+ 보완 `msg_071475e7edb4` T-072 G-1~G-9, `msg_193b909a2839`, `msg_b80dd327ed73`)
- 기준: T-067(기술 연결), T-068(화면 명세), T-072 1.2(디자인 검수 기준, 조기 읽기 B1~B3·C4·C5 반영)
- 상태: **ready_review** — Master 독립 검수·Claude design T-072 화면 검수 전

## 1. 바꾼 파일

| 파일 | 내용 |
|---|---|
| `package.json`, `package-lock.json` | `remotion`·`@remotion/player` **4.0.543 정확 고정**(두 패키지만, lock +25줄). 설치는 자동 권한 확인에 한 번 막혀 사용자가 직접 실행 |
| `lib/edit/preview.ts` (새) | 순수 변환: `previewProps`(클립 위치 누적·영상 `trimBefore`·빈 자리/없는 파일·전체 길이 max(영상, 글자 끝)·장면 0개 → null·미리보기 비율 때 화면용 위치만 옮긴 사본), `formatFrameTime`(MM:SS.FF), `spokenFrameTime`, `clampFrame`, spec `safeArea` 값 |
| `components/player/timeline-composition.tsx` (새) | Remotion 구성: `Sequence`, `Img`(pauseWhenLoading·maxRetries 0·onError), `OffthreadVideo`(muted·pauseWhenBuffering·onError), 회색 칸 3종(결과 선택 안 함·파일 없음·영상 끝 뒤 "영상 끝 · 글자만 남은 구간"), 글자(저장된 px·상자·모양), 점선 칩("미리보기 위치", "글꼴 없음 · 대신 보여요") |
| `components/player/player-panel.tsx` (새) + `.module.css` | Player(`controls`·`spaceKeyToPlayOrPause`·`clickToPlay`·전체화면 끔, `acknowledgeRemotionLicense` 근거 주석, `numberOfSharedAudioTags=0`, `defaultPremountInSeconds=2`), 재생·1/30초 버튼, 시간, 비율 3개·안전 영역 보기, 상태(불러오는 중·멈춤·재생 중·기다리는 중·오류·비어 있음), 무대·버튼에만 키 처리, `visibilitychange` 숨김 때 멈춤, 글꼴 미리 불러오기, 안전 영역 실측 경고, 안내 문구 |
| `components/player/player-loader.tsx` (새) | `next/dynamic` `ssr:false`. 서버 HTML에는 저장 비율의 "불러오는 중" 칸만 |
| `components/editing-panel.tsx`, `finishing-panel.module.css` | 정지 화면 미리보기·시간 막대 → PlayerLoader. `draft`(저장 전 고친 값)·자료 상태 맵(이미 있는 production 데이터, 새 API 없음)을 넘김. 390은 문구만(장면 순서·종류·크기·색·위치·시간·추가/빼기 숨김 + 안내 2개). T-068 3.1 문구 2곳(머리 "1/30초 단위", SRT 아래 P1 안내) |
| `components/ui/Icon.tsx`, `primitives.tsx`, `ui.module.css` | 아이콘 4개(play·pause·step-back·step-forward), `Badge variant="dashed"` (Q-5 허용 범위, 기존 토큰만) |
| `tests/p2-2-preview.test.ts` (새) | 12개: T1 변환, T2 시간 표시(0·31·254·749·750), T3 import 경계(서버 모듈 직·간접 0), Player 설정·문서 전체 키 처리기 없음·쓰기 요청 없음·ssr:false·muted, 패키지 두 개 정확 고정, SAFE_AREA = spec |

바꾸지 않은 것: DB·schema·migrations·backup·auth·API 계약, `lib/services/*`, `app/api/*`, PLAN·DESIGN·spec·공용 문서, `next.config.ts`. 저장·CAS·r1 ZIP 호환 경로 그대로.

## 2. 판단 (Master·design 확인용)

| # | 내용 |
|---|---|
| J-1 | Master D-4/G-4: 시간 칸 오류(`draft=null`) 동안 마지막 유효 타임라인을 계속 그리고 "시간 칸을 고칠 때까지 마지막으로 맞았던 내용으로 보여 줘요." 표시. 마지막 값은 렌더 중 파생 상태로 보관(effect 없음) |
| J-2 | T-068의 1회 Toast(info)는 기존 Toast에 info 종류가 없어 넣지 않고, 옮긴 글자가 있을 때 무대 아래 작은 글로 계속 보임(T-072 C-6 "지금 방식 괜찮음") |
| J-3 | 키 안내는 design 조기 의견 B3대로 두 줄: "재생 화면: Space 재생·멈춤 · ←/→ 1/30초 · Shift+←/→ 1초 · Home/End 처음·끝" / "글자 칸: 글자만 고쳐요. 미리보기가 키를 가로채지 않아요." (P2-3 클립 줄 없음) |
| J-4 | 무대 이름은 "미리보기 · 9:16"만(B2). 시간은 숨긴 알림 칸이 멈춤 때와 키가 0.3초 멈춘 뒤에만 읽음 |
| J-5 | "원래 비율로"를 누르면 그 줄이 사라지므로 저장 비율 버튼으로 초점을 옮김(B1, G-7) |
| J-6 | 글꼴 없음: P2-2 글자는 모두 Pretendard라 "Pretendard 글꼴 파일을 찾지 못해 기본 글꼴로 대신 보여 줘요." + 칩 + 안전 영역 경고에 "(대신 그린 글꼴 기준)" |
| J-7 | 무대 테두리를 그림자 선으로 그려 Player와 안전 영역 점선이 같은 상자를 씀(테두리 1px 때문에 최대 1.6px 어긋나던 것을 고침) |
| J-8 | 전체 길이는 T-067(=T-072 G-1) max(영상 합계, 글자 끝). s5 프로젝트는 영상 9초·표기 글자 30초라 `00:30.00`, 9초 뒤는 "영상 끝 · 글자만 남은 구간" |

## 3. 검증

### 3.1 자동

- `npm.cmd test` 36개 파일 **424 통과 / 2 건너뜀**(생성 전용), `npm.cmd run lint` 0건, `npm.cmd run typecheck` 통과, `npm.cmd run build` 통과(verify-build 포함).
- LICENSE: 설치된 `remotion`·`@remotion/player`의 `LICENSE.md` 둘 다 2,849바이트, SHA-256 앞 16자리 `53e92b6560f26f9d`(T-037과 같음), T-067 때 내려받은 공식 tarball 원문과 `cmp` 바이트 동일.
- `npm audit` 경고 7건은 기존 개발 도구(typescript-eslint·minimatch) 것이고 Remotion 쪽 없음.
- 서버: 편집 페이지 서버 HTML에 Player·영상 마크업 0, "불러오는 중" 칸만. `.next/server` 추적에 Remotion 없음. 브라우저 묶음은 편집 화면에서만 따로 불러오는 조각 하나 370,208바이트(gzip 113,574).

### 3.2 production 브라우저 (next build + next start 127.0.0.1:3061, s5 고정 백업을 OS 임시 폴더에 푼 사본, ego-browser)

증거: `tmp/t071-evidence/` 캡처 16장(git 제외).

| # | 확인 | 결과 |
|---|---|---|
| B1·B2·B3 | 무대 초점 →·→·←, Shift+→, End, End 뒤 →, Home | `00:00.01`→`00:00.02`→`00:00.01`, `00:01.01`, `00:29.29`(마지막), 그대로 `00:29.29`, `00:00.00`. 키 동안 페이지 스크롤 변화 0 |
| B4 | 재생 → 멈춤 | 버튼 이름 "재생"↔"멈춤", 재생 중 시간 증가, 멈춘 뒤 0.5초 더 봐도 같음, 알림 "멈춤, 0초 1프레임". ※ 이 자동화 창은 화면 갱신이 초당 약 3번이라 시간이 1초 단위로 뛰어 보임(속도 수치는 보지 않음) |
| B5 | 글자 칸에서 End·Space·←·→·Shift+←·Home | 글자에 공백이 들어가고 시간·재생 상태 그대로, 초점 글자 칸 유지 |
| B6 | 페이지 열자마자·재생/멈춤 뒤 초점 | 처음 BODY, 무대에서 Space 재생/멈춤 뒤 무대 그대로(초점 이동 없음) |
| B7 | 9:16 → 16:9 → 1:1 → "원래 비율로(9:16)" | 시간 `00:03.01` 유지, 초점 = 누른 버튼, 원래 비율로 뒤 초점 = 9:16 버튼, 칩 "미리보기 비율 16:9 · 저장 안 됨", 저장 상태 줄("저장됨 · 타임라인 r1 …") 그대로, 편집 중 안내 없음 |
| B8 | 모든 확인 동안 fetch·XHR 기록 | 쓰기 요청(POST 등) 0, GET만(RSC 미리 가져오기·`/api/jobs`) |
| DB | 시작 직후 vs 미리보기 확인 전체(저장 시험 전) | 모든 표 행 수 + 내용 해시 **같음**(`timeline_revisions`·`projects`·`jobs`·`activity_log`·`settings` 포함) |
| 안전 영역 | Player 상자 기준 점선 위치 | 9:16 360×640: 위 76.8·아래 128·오른쪽 43.19·왼쪽 0 (= 12%·20%·12%·0). 16:9 360×202.5: 10.13·18. 1:1 360×360: 18. 모두 spec과 ±1px 안 |
| B9 | 사본에서 장면 2 파일을 치움 | 그 구간만 "장면 2 결과 파일을 찾을 수 없어요.", 처음부터 재생해 장면 2·3·글자만 구간을 지나 `00:09.28`까지 계속, 기다리는 중 0회, 오류 상태 아님 |
| G-8 | 파일은 있는데 브라우저에서 `/api/assets/{장면2}` 차단(onError 경로) | 같은 회색 칸, 재생 계속, 기다리는 중에 갇히지 않음 |
| 빈 자리 | 장면 3(결과 선택 안 함) | "장면 3 · 결과를 선택하지 않았어요." |
| B10 | 글꼴 파일(`*.woff2`) 차단 | Callout + 글자 칩 "글꼴 없음 · 대신 보여요", 편집 동작, **저장 동작**(사본에 r2 생김 — DB 비교 뒤에 한 시험) |
| B11 | `prefers-reduced-motion: reduce` | seek·재생 같음. 움직이는 글자가 없어 안내 없음(G-5) |
| B12 | 숨김 | 이 자동화 창은 다른 탭을 앞으로 가져와도 `visibilityState`가 바뀌지 않음 → 페이지에서 `visibilityState=hidden` + `visibilitychange` 이벤트를 만들어 확인: 재생 중 → 멈춤, 다시 visible 이벤트 뒤 1.5초 자동 재생 없음 |
| G-4 | 끝 시간을 0으로(시간 오류) | 무대에 마지막 유효 내용(글자 2개) 그대로 + 안내 문구 |
| G-9 | 저장 전 글자 고침 | 미리보기 글자에 바로 반영("… 고침"), "저장하지 않은 고침도 미리보기에 보여요." |
| B13 | Tab 순서 1280 | 원래 비율로 → 무대 → 재생 → 1/30초 뒤로 → 1/30초 앞으로 → 9:16 → 16:9 → 1:1 → 안전 영역 보기 → (장면 순서) |
| B13 | Tab 순서 390 | 무대 → 재생 → 뒤로 → 앞으로 → 9:16 → 16:9 → 1:1 → 안전 영역 보기 → 키보드 사용법 → 글자 문구(장면 순서 없음) |
| B13 | 초점 링·넘침·누름 크기 | 무대 초점 링이 영상 바깥에 보임(캡처 15). 390 가로 넘침 0, 보이는 버튼 모두 44×44 이상(1:1 버튼 43px였던 것을 고친 뒤 다시 확인) |
| 390 | 문구만 | 보이는 입력은 "글자 n 문구"뿐, 안내 "장면 순서·글자 모양·시간은 PC에서 바꿔요." · "휴대폰에서는 문구만 고쳐요." |
| B14 | 옮긴 r1 | 미리보기는 프레임 시간, 묶음 SRT는 P1 시간 그대로 — 기존 시험(T-061·T-069 `p2-1-f065` 1번) 그대로 통과 |

## 4. 확인하지 못한 것 (그대로 적음)

- **오류 상태**: Player 실패를 브라우저에서 주입하지 못함(파일 실패는 onError로 회색 칸이 되어 오류 상태가 되지 않음). 코드 경로(`error` 이벤트 → Callout + "미리보기 다시 불러오기")만 있음.
- **비어 있음**: 편집 단계가 열린 장면 0개 프로젝트가 고정 데이터에 없음. 단위 시험(장면 0개 → null)만.
- **영상 결과**: s5 사본의 선택 결과가 모두 이미지라 `OffthreadVideo` 재생은 브라우저에서 보지 못함.
- **실제 기기·화면 읽기 프로그램**: 실제 휴대폰 재생, 스크린 리더 낭독은 하지 않음. 390은 에뮬레이션.
- **실제 탭 숨김**: 위 B12처럼 이벤트를 만들어 확인함.
- 재생 속도·부드러움: 자동화 창 갱신이 느려 판단하지 않음.

## 5. 남은 점

- 안전 영역 칠은 spec대로 `--st-danger-bg` 35%라 검은 배경 위에서는 어두운 분홍빛 회색으로 보임(캡처 15). 색 판단은 design 검수에 맡김.
- 전역 `[tabindex]:focus-visible` 규칙이 먼저 적용돼 무대 초점 선은 1px + 초점 그림자(바깥 2px 띄움)로 그려짐. 보임은 확인함.
