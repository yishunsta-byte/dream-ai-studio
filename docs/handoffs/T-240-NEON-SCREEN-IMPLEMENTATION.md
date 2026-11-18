# T-240 공개 메인 NEON SCREEN 제품 컴포넌트

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_aec02dede5d0` · 상태: **ready_review(작성자 자체 검증)**
- 근거
  - 사용자 선택: Design `msg_4204fa0e183d`(fixed T232 `b918e427`, **01 NEON SCREEN** 확정. 03 추천안이 아님)
  - 원 시안: `docs/handoffs/T-232-PUBLIC-MULTIMEDIA-HOME-OPTIONS.md`, `docs/design/t232-public-showcase/neon-screen.html`·`showcase.css`·`showcase.js`·`assets/ASSETS.md`
- 이번 작업은 **컴포넌트만** 만들었어요.
  - 어떤 경로(route)에도 연결하지 않았어요.
  - `app/(studio)/page.tsx`, Auth, route, 공용 layout·globals, proxy, API, DB, package·config, T238 배포 후보 핀은 바꾸지 않았어요.

## 1. 만든 파일
| 경로 | 내용 |
|---|---|
| `lib/public-showcase/works.ts` | 공개 작품 자료형(`ShowcaseWork`), 예시 6개(`SAMPLE_WORKS`, 모두 `sample:true`, `media:null`, 고정), 종류+검색 `filterWorks`, 머리글자 |
| `components/public-showcase/neon-showcase.tsx` | `"use client"` `NeonShowcase` 컴포넌트(아래 3장) |
| `components/public-showcase/neon-showcase.module.css` | 격리 CSS. 모든 규칙이 `.root` 아래 클래스예요. 글꼴은 루트 레이아웃의 Pretendard 변수를 써요 |
| `public/showcase/t240/*.png` 6장 | T232 자산을 **바이트 그대로** 복사(sha256 일치를 시험으로 고정). 합계 15MB. 화면에서는 `next/image`(기본 quality 75)로 줄여서 보내요 |
| `tests/public-showcase/neon-showcase.test.ts` | 13건 |

- 자산 출처
  - 새 커버 3장(orchid·celestial·sunflower): T232에서 자체 생성
  - 사진 3장(neon-rooftop·desert-motion·wild-coast): T208 자체 생성 사본
  - 폰트는 복사하지 않았어요. 앱에 이미 있는 `public/fonts/PretendardVariable.woff2`를 써요.
  - 권리 범위는 T232 ASSETS.md 기록을 그대로 따라요. 법률 검증이나 독점 권리는 주장하지 않아요.

## 2. 사용 방법(통합 담당용)
```tsx
<NeonShowcase works={공개_작품_목록} status="ready" | "loading" | "error" onRetry={...}
  featuredId="..." collectionIds={[...]} loginHref="/login" />
```
- 자료는 props로만 받아요.
  - 컴포넌트와 lib는 `react`, `next/image`, `next/link`, 자기 lib, CSS만 가져와요(시험으로 고정).
  - fetch·env·localStorage·DB·저장소 접근은 없어요.
- 공개 권한이 확인되고 공개하기로 선택된 완성 작품만 넘겨야 해요. 개인 프로젝트·초안·파일 연결은 통합 단계에서 따로 정해요.
- `media`가 있으면 상세에서 기본 컨트롤이 있는 `<video>`/`<audio>`를 보여 줘요(`preload="none"`, 자동재생 없음).
  - 지금 예시는 모두 `null`이라 정지 이미지와 "아직 재생할 수 있는 … 파일이 연결되지 않았어요" 안내만 보여요.
  - 실제 재생 파일로 검증한 적은 없어요.

## 3. 화면 동작
- **구성**
  - 머리: 브랜드, 발견·작품·크리에이터 메뉴(해당 영역으로 포커스+스크롤), 검색, 크리에이터 로그인(실제 `/login` 링크)
  - 예시 안내 줄: 예시 작품이 하나라도 있을 때만 "지금 보이는 작품과 크리에이터는 화면을 소개하는 예시예요. 영상·음악은 아직 재생되지 않아요."
  - 대표 작품 hero: 대형 이미지, "대표 작품 · 예시" 표시, 자세히 보기, 다른 작품 둘러보기
  - 작품 레일: 종류 칩 `aria-pressed`, ←/→ 버튼, 카드마다 "예시 작품"
  - 뮤직 컬렉션 3개, 바닥글
- **상태**
  - 불러오는 중: `aria-busy`
  - 오류: `onRetry`가 있을 때만 "다시 시도"
  - 검색 결과 없음: "검색·종류 초기화"를 누르면 검색칸으로 포커스
  - 공개 작품 0개: hero 대신 안내, 제목은 1개
  - 결과 수는 `role=status`로 알려요.
- **상세(native dialog)**
  - 열면 닫기 버튼에 포커스가 가고, Tab·Shift+Tab은 상세 안에서만 돌아요.
  - Esc나 닫기 버튼으로 닫으면 연 버튼으로 포커스가 돌아가요. 그 버튼이 필터로 사라졌으면 작품 영역으로 가요.
- **동작 줄이기:** hero 확대 애니메이션과 확대 전환을 끄고, 레일·메뉴 이동은 즉시 이동해요.
- **글자:** 조회수·좋아요·재생 시간·"재생 중" 같은 가짜 수치나 상태는 없어요. 개발 용어(시안·UI·API·DB·시연)도 화면에 없어요(시험으로 확인).
- **시안과 다른 점(제품용으로 뺀 것)**
  - 상태 고르기 드롭다운, "재생 진입 시연" 버튼, 3안 비교 링크, 가상 로그인 대화상자는 뺐어요.
  - 로그인은 실제 로그인 화면 링크로 바꿨어요.

## 4. 검증(실제 출력)
- **집중 시험:** `npx vitest run tests/public-showcase` → **13 passed**
  - 자료 계약, 자산 해시, 필터·검색, 정상·로딩·오류·작품 없음·예시 아님 렌더링
  - 보이는 글자의 금지 용어, 영상·음악 요소 없음
  - import 경계, CSS 범위·44px·동작 줄이기, 포커스 복귀 코드
- **전체 검사(현재 작업 트리)**
  - `npx tsc --noEmit --incremental false` 0
  - `npx eslint . --max-warnings 0` 0
  - 전체 vitest: **Test Files 102 passed | 10 skipped (112), Tests 2044 passed | 319 skipped (2363)**
  - 작업 트리에는 다른 담당의 미추적 파일(`tests/b45-schema5-catalog-native-owned.ts` 등)도 있었어요. 건드리지 않았어요.
- **실제 브라우저(ego lite)**
  - 환경: 제 격리 사본 `tmp/t240/app`에서 `next dev`, 127.0.0.1:50921(인증 꺼짐, DB 환경 없음)
  - 사본에만 만든 미리보기 경로 `app/t240-preview`로 확인했어요. 저장소에는 넣지 않았어요.
  - Tester와 자원 조정 완료(`msg_162c56cbf92b`, Tester 브라우저 미사용).
  - 결과 **PASS**(`tmp/t240/result.json`, 캡처 `tmp/t240/shots/` 12장)

| 확인(1280·390 각각) | 결과 |
|---|---|
| 정상 | h1 1개, 가로 넘침 없음(1280 -15·390 0), 보이는 조작 요소 모두 44×44 이상, 깨진 이미지 0, 외부 요청 0, video·audio·iframe 0, 작품 6 |
| 글자 대비 | 보이는 제목·문단·링크·버튼 글자가 가장 가까운 불투명 배경 기준 4.5:1 이상 |
| 종류+검색 | 음악 → 3개, + "앰비언트" → CELESTIAL DRIFT, + "zzz" → 없음 안내·"작품 0개", 초기화 → 검색칸 포커스·전체·6개 |
| 상세 | Enter로 열기, 닫기 버튼 포커스, 영상 미연결 안내, media 0, Tab 3번·Shift+Tab 모두 상세 안, Esc → "DESERT MOTION 자세히 보기"로 복귀 |
| 음악 상세 | 음악 미연결 안내, 닫기(Enter) → 컬렉션 버튼으로 복귀 |
| 연 버튼 사라짐 | 상세 연 채로 "여행" 필터 → Esc → 작품 영역으로 포커스 |
| 레일 → | scrollLeft 4→760(1280), 4→307(390) |
| 로딩·오류·작품 없음 | 각 h1 1, 넘침 없음, 44px, 대비 통과. 오류 → 다시 시도 → 6개·"작품 6개" |
| 동작 줄이기 | reduce일 때 hero 애니메이션 `none`, 보통일 때 drift |

- **고친 결함(자체 발견):** 첫 화면 확인에서 소제목·작품 제목이 거의 보이지 않았어요.
  - 원인: 전역 `h2`·`h3`의 밝은 배경용 글자색이 그대로 적용됐어요.
  - 고친 방법: `.root h1/h2/h3 { color: inherit }`로 덮어썼어요. 전역 focus 그림자도 이 화면에서는 끄고, 시안의 네온 외곽선만 쓰게 했어요.
  - 다시 확인: 캡처로 직접 다시 확인했고, 대비 검사와 CSS 규칙 시험을 추가했어요.
- **같이 고친 것:** 메뉴 링크 "발견"·"작품"이 가로 24px였어요. 최소 44px로 늘렸어요.
- **한계**
  - dev 서버 기준이에요. production build는 실행하지 않았어요(배정 금지).
  - 화면 왼쪽 아래 "N" 원은 Next 개발 도구 표시라 운영에는 없어요.
  - 실제 휴대전화·스크린리더·실제 미디어 재생은 확인하지 않았어요.
  - 사진 위 글자는 대비 검사가 페이지 배경 기준으로 계산돼요(어두운 그라데이션 위). 정밀 확인은 독립 UI 검수 몫이에요.
- **정리:** dev 서버를 종료했고 포트가 닫힌 것을 확인했어요. 3013·공유 `.next`는 쓰지 않았고, 쿠키·캐시는 지우지 않았어요.

## 5. 통합 제안(별도 route 배정용, 실제 소스 근거)
1. **지금 `/`는 작업실이에요.**
   - `app/(studio)/page.tsx`가 `legacyPageGate()` → `checkStartup()` → `listProjects()`·`readRecentOperations()`로 **개인 DB·백업 기록**을 읽어요. `(studio)/layout.tsx`의 시작 점검도 그대로 걸려요.
   - 그래서 공개 메인을 이 파일에 섞지 말고, 별도 route group(예: `app/(public)/page.tsx` + 전용 layout)으로 분리하는 것을 제안해요.
   - 작업실은 기존 링크를 유지하는 다른 주소(예: `/studio`)로 옮기는 방안이 필요해요. 기존 링크 영향 조사도 같이 해야 해요.
   - 이 결정과 `/` 주소 전환은 Master·사용자 몫이에요.
2. **인증 경계(`proxy.ts`)**
   - `authMode()`가 supabase(운영 `VERCEL=1`)이면 `isPublicPath`(`/login`, `/auth/callback`, `/api/auth/*`)만 공개예요. 나머지는 로그인하지 않으면 401·로그인으로 보내요.
   - 공개 메인을 열려면 해당 경로를 공개 목록에 넣어야 해요.
   - 그 경로가 개인 자료 컴포넌트·API를 import하지 않는다는 검사를 같이 붙여야 해요.
3. **정적 이미지 경로**
   - proxy `matcher`는 `_next/static|_next/image|favicon.ico|fonts/`만 제외해요.
   - 그래서 운영 모드에서 로그인하지 않은 방문자의 `/showcase/t240/*.png` 요청은 proxy 인증을 거쳐 막힐 수 있어요.
   - `next/image` 최적화기가 원본을 읽을 때 이 경로가 막히는지도 **미확인**이에요.
   - 통합 때 `showcase/` 제외(또는 공개 경로) 추가와 운영 유사 실행 확인이 필요해요.
4. **보안 검수 범위 제안**
   - 공개 경로에서 세션 없이 개인 프로젝트·초안·파일 목록·API 응답이 나오지 않는지
   - 공개 목록 자료의 출처: 공개 선택·권한 확인된 작품만
   - 로그인 링크의 `next` 처리
   - 이미지·미디어 경로 열거 가능성
   - 캐시 헤더: 공개 페이지는 개인 정보 없이 캐시 가능, 인증 화면은 no-store 유지
5. **용량:** 원본 PNG 15MB를 그대로 넣었어요. 운영 전 WebP·JPEG 파생본을 만들지는 사용자·Design 판단이에요(원본 보존 규칙).

## 보호
- 허용 5경로와 이 보고만 커밋해요.
- 미추적 T122·T137 보고, 다른 담당 WIP(b45 등), tmp, 공용 문서는 stage하지 않았어요.
- 새 창·agent·worktree 없음. push·배포 없음. 비밀값 없음.
