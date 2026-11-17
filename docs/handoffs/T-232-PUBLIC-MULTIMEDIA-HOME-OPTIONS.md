# T232 · 공개 멀티미디어 메인 3안

- 담당: Codex design / CX-DESIGN-01, 기존 Windows Design 세션.
- 배정: Master `msg_c14c9d021a30` 사용자 최우선 지시 전달. 수락·우선 전환 `msg_96a753313c59`.
- 상태: **ready_review · 3안 제작·작성자 자체 검증 완료**. 사용자 선택·제품 통합·운영 배포·실제 콘텐츠 공개는 아님.
- 허용 경로: `docs/design/t232-public-showcase/`와 본 보고서만. T208 원본 보존.
- 적용 지침: AI_TEAM_RULES v1.4 수신·유지, 기존 세션만 사용. 새 Codex 창·agent·worktree·예약 없음.

## 비교·체험

[3안 비교 index](../design/t232-public-showcase/index.html). 정적 파일을 직접 열면 됩니다. 서버·로그인·외부 네트워크가 필요 없습니다. 각 시안의 검색·카테고리·작품 상세와 재생 UI 상태·로그인 진입 안내를 체험할 수 있습니다.

| 안 | 구조·무드 | 실제 시안 | PC 1280 | 모바일 390 |
|---|---|---|---|---|
| 01 NEON SCREEN | 다크 네온 시네마, 대표 작품 대형 hero·가로 작품 레일·뮤직 컬렉션 | [열기](../design/t232-public-showcase/neon-screen.html) | [캡처](../design/t232-public-showcase/screenshots/screen-1280-normal.png) | [캡처](../design/t232-public-showcase/screenshots/screen-390-normal.png) |
| 02 SOUND COLOR | 웜 크림·테라코타·퍼플, 중첩 커버 아트·앨범 그리드·선택 작품 하단 플레이어 | [열기](../design/t232-public-showcase/sound-color.html) | [캡처](../design/t232-public-showcase/screenshots/sound-1280-normal.png) | [캡처](../design/t232-public-showcase/screenshots/sound-390-normal.png) |
| 03 CREATOR FEED | 밝은 네이비·틸·오렌지, 영상 썸네일 피드·추천 작품·크리에이터 채널 카드 | [열기](../design/t232-public-showcase/creator-feed.html) | [캡처](../design/t232-public-showcase/screenshots/feed-1280-normal.png) | [캡처](../design/t232-public-showcase/screenshots/feed-390-normal.png) |

**목표 적합성 추천은 03 CREATOR FEED.** 메인에서 여러 공개 콘텐츠가 노출되고 방문자가 종류·검색·크리에이터 문맥으로 바로 둘러보기 쉽습니다. **화려한 멀티미디어 첫인상은 01 NEON SCREEN이 가장 강합니다.** 대형 영상 포스터와 네온 컬러·가로 레일로 작품의 영상미를 강조합니다. 음악의 비중이 크고 커버 탐색·플레이어 경험을 중심에 두려면 02가 적합합니다. 최종 사용자가 고른 안으로 간주하거나 새 4안을 추가하지 않았습니다.

3안은 같은 화면의 색상 변형이 아닙니다. 01은 영화형 작품 집중/레일 탐색, 02는 음악형 커버/장르/플레이어, 03은 검색·썸네일·채널 중심 피드로 정보 구조와 타이포그래피·색·탐색 흐름이 다릅니다. 공통 데이터 예시·상세 상태 동작만 공유합니다.

## 공개 콘텐츠 경계·동작

- 방문자가 보는 공개 선택 완료 콘텐츠의 **화면 설계**입니다. 실제 공개 목록 API, 개인 프로젝트/초안/실파일에 연결하지 않았습니다. 샘플 6개와 가상 크리에이터는 디자인 자료이며 실제 작업물·계정·공개 권한을 뜻하지 않습니다.
- 대표 작품·포스터·앨범·크리에이터 카드가 메인의 주인공입니다. 작업 대기열·개인관리·제작 시작을 메인 중심으로 두지 않았습니다. 별도 크리에이터 로그인 진입은 안내 대화상자까지만 제공합니다. 실제 인증/계정 입력·외부 이동 없음.
- 작품 포스터와 상단에 “시안 샘플 / 정지 이미지 / 실제 재생 없음”을 표시했습니다. 상세에서 정지 이미지→불러오는 중→연결 오류를 수동 시연할 수 있습니다. 실제 영상·음원·완료 재생·조회수·좋아요·진행 시간·자동재생은 없습니다.
- 02 하단 플레이어는 선택한 커버/제목/크리에이터를 반영하며 이전·다음 커버 선택과 재생 UI 진입을 제공합니다. 소리를 내지 않으며 오디오 연결·시간 진행을 가장하지 않습니다. 고정 플레이어 때문에 본문 끝이 가리지 않도록 여백과 스크롤 여유를 뒀습니다. 전체 페이지 캡처에는 고정 바가 캡처 당시 viewport의 하단 위치에 보입니다.
- 검색·카테고리는 작품 목록을 갱신합니다. 상단 추천 작품과 고정 컬렉션은 큐레이션 예시로 남습니다. 결과 없음은 초기화 행동, 목록 로딩·오류는 정상 예시로 복구하는 UI를 제공합니다. 복구는 네트워크 성공이 아닌 시안 상태 전환입니다.
- 실제 제품 연결 시 공개 권한이 확인되고 공개하기로 선택한 완성 콘텐츠만 별도 공급해야 합니다. 이 산출물로 게시·업로드·권한 변경을 수행하지 않았습니다.

## 현재 서비스 참고 — 직접 읽기 전용

[참고 URL·시각·관찰·차용 범위 기록](../design/t232-public-showcase/REFERENCES.md).

- [YouTube](https://www.youtube.com/): 2026-11-18 02:29:20 KST, 상단 검색·주제 칩·큰 영상 썸네일·제목/크리에이터·세로 콘텐츠 레일을 관찰. 03의 피드 탐색 패턴에 반영.
- [Suno Discover](https://suno.com/discover): 02:29:53 KST, 커버 중심 추천·탐색/창작 진입 분리·하단 선택 작품 플레이어를 관찰. 02에 반영. 최초 루트의 session-recovery를 완성된 홈으로 해석하지 않고 `/home`→실제 `/discover` 이동 후 확인했습니다. 기존 브라우저의 로그인된 shell이며 익명 사용자 화면이라고 주장하지 않습니다. 계정 정보·추천 곡·재생 시간은 시안 자료로 사용하지 않았습니다.
- [Vimeo Watch](https://vimeo.com/watch): 02:29:24 KST, 대형 작품 추천·가로 큐레이션 레일·크리에이터/채널 탐색을 관찰. 01의 hero/레일과 03 채널 카드에 반영.

Ego Browser TaskSpace20에서 기존 브라우저를 읽기 전용으로 사용했습니다. 로그인·결제·외부 게시·생성·실제 재생·쿠키 선택을 누르지 않았습니다. 로고·브랜드·타인 썸네일/커버를 복제하거나 시안 자산으로 다운로드하지 않았습니다. 점검용 참고 캡처는 ignored `tmp/t232/`에만 있고 제품 자산에 포함하지 않습니다.

## 이미지·폰트

[자산 및 정확한 프롬프트 기록](../design/t232-public-showcase/assets/ASSETS.md).

- 새 커버 3장: `assets/orchid.png`, `celestial.png`, `sunflower.png`. **Built-in Imagegen**으로 새로 생성; reference 이미지 없음, transparent background false. 원 생성 파일 보존·프로젝트 내부 복사 완료. 커버 3장을 직접 확인했습니다.
- T208의 자체 생성 네온 공연·사막 자동차·해안 사진 3장을 새 폴더로 그대로 복사했습니다. 새 생성 3장으로 다시 계수하지 않았으며 T208 원본은 변경하지 않았습니다. 기존 ASSETS.md에 원본/프롬프트 근거가 있습니다.
- Pretendard 폰트/OFL/출처 3파일 재사용. 모든 참고 자산은 로컬 파일이며 외부 폰트/썸네일 요청 없음.
- 생성 서비스의 적용 조건·배포 용도의 권리 전체를 법률 검증하거나 독점·무제한 상업 권리를 확보했다고 주장하지 않습니다. 실제 타인 콘텐츠 게시 권한은 이번 작업에서 취득하지 않았습니다.

## 자체 검증·제한

| 검증 | 실제 결과 |
|---|---|
| 3안 ×1280/390 ×7상태 | **42/42 통과**: normal, search-empty, list-loading, list-error, detail-ready, play-loading, play-error |
| 위 화면의 기계적 확인 | document 가로 넘침0, h1 각1, 로컬 이미지 정상, 표시된 조작 영역 높이44px 이상, HTTP 외부 자원 요청0, audio/video/iframe 요소0 |
| 검색·상태·키보드·대비 | **106/106 통과**. 장르/종류+검색 결합, 결과 없음/초기화, 로딩·오류/복구, 상세 진입, Tab/Shift+Tab trap, Escape·정확한 트리거 복귀, 정지 이미지 복귀, 로그인 안내/폼 없음, creator 안내/anchor, 레일 스크롤·키보드 마지막 작품, 선택 플레이어, reduced-motion, 핵심 텍스트 색 조합4.5:1 이상 |
| 비교 index | 1280/390 가로 넘침0·깨진 이미지0·조작44px 이상·h1 하나; 모바일 펼침 동작과 각 시안 파일 진입 확인 |
| 캡처 | **26장**: normal6, search-empty6, play-error6, PC list-loading3, comparison2, PC preview3 |
| 직접 시각 확인 | PC/모바일 정상6화면, 비교 PC, PC 음악 상세 오류/모바일 피드 상세 오류를 열어 확인 |
| JS/문서 | `node --check docs/design/t232-public-showcase/showcase.js`, staged whitespace check 통과 |

근거: [layout-audit.json](../design/t232-public-showcase/layout-audit.json), [interaction-audit.json](../design/t232-public-showcase/interaction-audit.json), [comparison-audit.json](../design/t232-public-showcase/comparison-audit.json), [캡처 폴더](../design/t232-public-showcase/screenshots/).

Ego Browser에서 실제 로컬 HTML/CSS/JS로 실행했습니다. 기준 viewport는 매 실행마다 명시 설정했고 reduced-motion 검사도 실행했습니다. 검증 스크립트는 ignored `tmp/t232/round-09-qa.mjs` 및 `round-10-comparison.mjs`; 비교 페이지 하나만 사용자 확인용으로 남기고 브라우저 작업을 finish했습니다.

초기 확인에서 네온 버튼 흰 글자 대비가 약해 배경을 어둡게 조정한 뒤 최종 전 사례를 재실행했습니다. 초기 자동화는 중복 anchor 선택자와 긴 페이지의 auto-scroll/대화상자 종료 시점에서 중단됐습니다. selector를 명확히 하고, 검색은 focus/키보드 입력으로 수행하고, close 뒤 실제 상태/프레임을 기다리도록 검증기를 고친 뒤 최종42/106을 완주했습니다. 초기 중단을 제품 통과로 계수하지 않습니다. `[hidden]` 상태가 시안의 display 규칙에 덮이지 않도록 명시했습니다.

이것은 **작성자 자체 검증**입니다. 실제 휴대전화·스크린리더·미디어 디코딩/스트리밍·공개 콘텐츠 권한/API·인증·운영 배포 검증은 미실행입니다. 핵심 색 토큰 대비를 사진의 모든 픽셀에 대한 접근성 인증으로 확대하지 않습니다. Master `msg_cc354087f052`는 PC 정상3캡처를 직접 확인한 관찰이며, 모바일/상호작용의 독립 PASS가 아닙니다.

## 보호 범위·후속

제품 app/Auth/layout·공용 지침/상태·DB·운영3013·공유 `.next`·원본 시안은 수정하지 않았습니다. package 설치·production build·배포 없음. 동시 Front/Backend 변경과 기존 미추적 T122/T137 보고서는 stage/수정하지 않습니다.

T231은 fixed6308791의 부분 소스 확인/남은 점을 `docs/handoffs/T-231-CLOUD-MANAGEMENT-DESIGN-REVIEW.md`에 보존한 뒤 T232로 우선 전환했습니다. Front의 후속 b7a0a94/3b32ad0 실측·캡처 수신은 별개이며 이번 T232 성과나 T231 독립 승인으로 합산하지 않습니다.

사용자가 방향을 정하면 공개 콘텐츠 데이터/재생 자산/접근 권한 연결은 별도 제품 범위로 배정합니다. 현재 시안 작성으로 사용자 선택이나 실제 콘텐츠 게시를 대신하지 않습니다.

복사용 반환: **T232 ready_review. 공개 작품을 주인공으로 NEON SCREEN(화려한 영상미/hero·레일), SOUND COLOR(커버·장르·플레이어), CREATOR FEED(작품 노출·탐색/영상피드·채널) 3안을 신규 폴더에 완성했습니다. 콘텐츠 발견 목적 추천은03, 강한 네온 첫인상은01입니다. 비교 index·PC/390·상태 캡처26장, 실제 브라우저42화면/106동작·대비 확인 통과, 자산/정확한 프롬프트·참고URL/시각 기록 포함. 정지이미지·UI 시연이며 실제 재생/조회수/로그인/업로드/게시 없음. 제품·DB·운영·T208 원본 변경이나 배포 없이 고유 산출물만 반환합니다.**
