# T-240-R NEON SCREEN 독립 검토

2026-11-18 · Codex(Tester) · 고정 대상 `9f2c471a281a709174bcd84dbf789266fa8a3bb7`.

**판정: FAIL — F240-1 P2 모바일 hero 작은 문구 대비 부족.** 관련 13 tests, 타입 검사, 범위 lint는 통과했다. 컴포넌트 동작 검토이며 T241 공개 `/`·`/studio`·인증/자산 allowlist 통합 승인이나 실제 미디어 재생 승인이 아니다. 제품·CSS·기존 테스트 기대값은 수정하지 않았다.

## F240-1 · P2 · 390px hero 작은 문구

`components/public-showcase/neon-showcase.module.css`의 `.heroCopy .eyebrow` 색 `#ffb5ed`, 모바일 10px 문구 `THE NIGHT IS JUST BEGINNING.`이 이미지의 밝은 건물 위에 놓인다. 390×844, DPR1, 기본 대표 예시, 이미지 애니메이션 시작점에서 실제 글자 내부 픽셀의 최소 대비 **2.916922:1**이다. 작은 일반 텍스트 기준 4.5:1보다 낮다. 제목 자체는 같은 방식으로 5.637544:1이므로 이 결함은 제목이 아닌 작은 영문 문구에 해당한다.

재현: 고정 소스의 컴포넌트를 격리 Next dev 경로에서 390×844로 표시 → 폰트·hero 이미지 decode 완료 → scrollY0 → 이미지 animation pause/currentTime0 → 문구를 본다. 정상 스크린샷과 heroCopy만 opacity0으로 만든 배경 스크린샷을 같은 위치에서 한 쌍으로 저장했다. 문구 사각형 중 실제 전경색에 가까운 글자 내부 픽셀만 골라 원래 CSS 전경색/그 위치의 합성된 배경 RGB로 sRGB 상대 휘도 비율을 계산했다. 최저 위치 CSS px `(146,521)`, 전경 `[255,181,237]`, 배경 `[97,119,133]`; 해당 문구 solid 글자 픽셀 250개. 임의의 빈 사각형 배경 픽셀을 글자라고 계산한 결과가 아니다.

근거는 소유 ignored `tmp/t240r-review-9f2c471/`:

- `shots/hero-foreground-paired-390.png`, `shots/hero-background-paired-390.png`, `hero-paired-rects-390.json`.
- `round-09.mjs`, `glyph-contrast.mjs`, `glyph-contrast-results.json`.
- 전체 영역을 보수적으로 계산한 선행 `contrast.mjs`·`contrast-results.json`도 보존. 이것만으로 결함 판정하지 않았다.

1280×900 동일 글자 위치 계산: hero 제목 15.915862, 영문 문구 11.966053, 부제 13.966579, byline 13.181156. 390 부제 11.047513, byline 11.077370. 이 값은 해당 고정 구도/애니메이션 시작점의 스크린샷 측정이며 모든 프레임·임의의 향후 이미지 대비를 보증하지 않는다. 문구에 충분한 불투명 배경을 주거나 해당 위치 overlay를 강화한 후 동일한 실제 글자 위치 및 다른 애니메이션 구도에서도 회귀 확인을 권한다. 조상 backgroundColor만 계산하면 이미지와 gradient의 실제 합성 배경을 놓친다.

## 검증 범위와 결과

`git archive`로 고정 커밋을 `tmp/t240r-review-9f2c471/app`에 풀고 기존 node_modules만 junction으로 재사용했다. 사본에만 `/t240r-preview` page/client를 추가해 props 상태를 공급했다. 고정 root layout/globals/font를 그대로 사용했다. auth off, 사본 전용 DREAM_DATA_ROOT, 독립 `.next`, loopback 포트50937. 공유3013·공유.next·build/deploy·패키지 설치·환경 파일 변경은 없었다. 실제 검증 시점 1280×900/390×844를 page evaluate innerWidth로 확인했다. invocation 사이 브라우저 도구가 viewport override를 되돌리므로 각 화면 검증 invocation에서 다시 지정했다.

| 항목 | 독립 결과 |
| --- | --- |
| 관련 테스트 | 고정 사본 `node node_modules/vitest/vitest.mjs run tests/public-showcase/neon-showcase.test.ts`: **13/13 PASS**, native PG 플래그 5개 process-local 0 |
| 타입 | 고정 사본 `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit0 |
| lint | component TSX/works.ts/관련 test만 eslint `--max-warnings 0`: exit0 |
| 자산·자료 | 6개 전부 sample:true/media:null, 고정 T232 이미지와 바이트 동일(관련 테스트 재현), ASSETS 출처 기록 확인 |
| 경계 | 컴포넌트 React/Next Image·Link/자체 자료·CSS만 import. fetch/env/localStorage/개인 프로젝트/DB imports 없음. CSS module 격리 및 reduced-motion 규칙 확인 |
| 실제 ready 화면 | 두 크기 h1 하나·article6·깨진 이미지0·video/audio/iframe0·관측 resource entry 외부 origin0 |
| 클릭 크기 | 두 크기 DOM에서 보이는 제품 인터랙티브 요소 44px 미만0. 메뉴 발견44×44, 작품44×44, 크리에이터68.5×44 |
| 가로 넘침 | 390 scrollWidth-innerWidth=0, 1280=-15(세로 scrollbar 영역); 양수 넘침 없음. 작품 rail 내부 가로 스크롤은 의도된 동작 |
| 검색/필터 | 키보드 Enter 음악3 → 검색 앰비언트 CELESTIAL DRIFT1 → zzz 추가 0/status 작품0 → 키보드 초기화 전체6/검색 input 포커스 |
| rail | 다음 버튼으로 scrollLeft>100, 이전으로 <20 복귀, 두 크기에서 실제 동작 |
| 상세 | DESERT MOTION Enter 열기/닫기 버튼 autofocus, Tab·ShiftTab 순환, Esc 닫기 및 연 버튼 복귀. 두 크기 음악 상세의 정지 이미지/파일 미연결 안내/미디어요소0, Enter 닫기 및 연 음악 버튼 복귀 |
| 사라진 트리거 | 별도 fresh 상태에서 NEON 상세 → DOM event injection으로 여행 필터 적용해 연 카드 제거 → Esc → 작품 section 포커스. 두 크기 PASS. 배경 inert 상태에서 필터 변경은 실제 사용자 클릭이 아닌 외부 변경을 흉내 낸 주입 시험 |
| 메뉴 이동 | 크리에이터 메뉴 키보드 Enter로 collection section 포커스 이동, 두 크기 PASS |
| 상태 | loading/error/empty props 각각 article0/h1하나/넘침 없음/44px 미만0. loading aria-busy=true. error retry Enter 후 article6. empty 실제 문구·화면 스크린샷 보존 |
| 동작 줄이기 | CDP prefers-reduced-motion:reduce → matchMedia=true, hero computed animationName=none, 두 크기 PASS |

`browser-results.json`의 첫 40개 검사는 33개 true/7개 false로 원본 보존했다. 4개 false는 검사 코드가 넘침을 `===0`으로 잘못 판단해 -15px도 실패로 센 경우다(정확한 조건은 `<=0`). 나머지3개는 닫힘 이벤트·React commit 완료를 기다리지 않은 연속 모달 검사여서 제품 결함으로 확정하지 않았다. `round-03`·`round-06` 타임아웃도 삭제하지 않았다. 각각의 새 상태에서 정확한 dialog 제목·open·focus·닫힌 뒤 내용 제거까지 기다리는 `round-08` 및 `round-10`으로 사라진 트리거와 음악 닫기를 다시 분리 검증해 통과했다. 따라서 최초 40개 전부 통과로 재표기하지 않는다. 이 검토는 초고속 연속 모달 전환 경쟁 상태까지 해결됐다고 보증하지 않는다.

자동 DOM/키보드 결과: `browser-results.json`, `final-browser-results.json`, `audio-final-results.json`. 실제 직접 시각 확인한 이미지: `shots/ready-1280.png`, `ready-390.png`, `music-final-390.png`, `error-390.png`. 전체 스크린샷은 ready/loading/error/empty 두 크기와 상세/대비 쌍을 `shots/`에 보존했다. 시각 확인에서 구성·잘림·누락은 추가 발견하지 않았다. Next dev N 표시는 개발 도구이며 제품 인터랙티브 크기 판정에서 제외했다.

## 한계와 정리

실제 영상·오디오 파일은 연결하지 않았으며 재생·대역폭·자막·재생기 포커스는 검증하지 않았다. 외부 요청0은 위 페이지 관측 resource entry의 결과이고 전 서버 보안 감사가 아니다. 스크린리더·다른 브라우저·모든 텍스트/gradient 대비·향후 실제 작품의 권리 검증·T241 통합은 별도다. 자체 생성 기록 확인을 법률상 권리 승인으로 확대하지 않는다.

검토 마지막에 고정 component/lib/tests/public asset 경로 `git diff 9f2c471 -- ...` 결과 없음. ego space42 `finish({keep:[]})` 완료. own next 세션 Ctrl-C 종료 후 **PID68468 부재·50937 listener 부재** 확인. Front에 브라우저 사용 가능과 F240-1 원본 근거 경로를 전달했다. Front T241의 기존 수정/스테이징 rename과 무관 untracked 보고서는 보존했다. 이 보고서만 선택 commit한다. 후속 B45-R은 이 정리 뒤 별도 순차 검토다.
