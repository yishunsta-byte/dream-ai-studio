# T-240-R2 NEON 작은 문구 대비 보완 독립 재검수

2026-11-18 · Codex(Tester) · fixed **e36171c6f84bfdb2baebf69ddc4118fe8a3481be** · 배정 msg_1c356ba47462. T241-R 보고555436c와 own HTTP/모의 서버 정리를 마친 뒤 순차 실행했다.

**판정: PASS — F240-1 수정 및 아래 UI 회귀 범위.** 390px 원래 실제 글자 대비 **2.916922:1**을 독립 재현했고, 수정 후 **12.338369:1**로 확인했다. 원9f2c471/84083f9 FAIL과 그 원본 증거는 변경하지 않았다. 이번 판정은 새 고정 버전의 결함 해소이며 실제 미디어·Supabase·배포 또는 전체 접근성 인증이 아니다.

## 변경 경계·독립 환경

커밋의 정확한 변경3개는 CSS/추가 테스트1건/작성자 handoff다. CSS의 유일한 제품 규칙 변경은 heroCopy의 eyebrow에 `display:inline-block`, 불투명 `#0c0814`, padding4px8px, radius4px를 추가한 것이다. 색 `#ffb5ed`와 모바일10px/본문·사진은 그대로다. 기존13 테스트 기대는 바뀌지 않았다. TSX/lib/6자산/T241 route/Auth는 이전 커밋 대비 diff가 없다.

고정 git archive 사본 `tmp/t240r2-review-e36171c/app`, node_modules junction, loopback **50957**, 사본 `.next`, auth off/소유 runtime root를 사용했다. 기본 관측은 누적 T241이 포함된 실제 공개 `/`에서 진행했다. 상태 props만 필요한 loading/error/empty는 사본 전용 `/review-state` page/client 두 파일로 공급했다. 이 도우미는 제품 경로에 넣지 않았다. 공유3013/.next·build/deploy/install·새 agent/window/worktree를 사용하지 않았다. `source-check.mjs`가 사본의 CSS/component/lib/원test/public route/proxy/6PNG **12파일 고정 바이트/LF 일치**를 종료 후 확인했다.

## 실제 글자와 배경 측정

`round-02-capture.mjs`는 각 viewport에서 실제 innerWidth/폰트/이미지 decode를 확인하고 hero animation을 currentTime0에 정지했다. 글자 전경 스크린샷 뒤 **텍스트만 감싼 임시 inline span의 opacity0**으로 배경 스크린샷을 찍었다. 부모 eyebrow와 새 불투명 backplate는 숨기지 않았다. 전체 heroCopy opacity0으로 plate까지 없애서 다른 배경을 재는 오류를 피했다. 촬영 후 span opacity를 복원하며 제품 파일은 수정하지 않았다.

`measure.mjs`는 CSS 전경색 ±12에 속하고 원 배경과 차이가 있는 실제 글자 내부 픽셀에서 같은 위치 배경을 비교한다. 안티앨리어싱 경계를 최소 기준의 근거로 삼지 않으며, 빈 사각형 픽셀도 글자라고 세지 않는다. 표의 결과는 `glyph-results.json`, 원래 색·크기·weight·위치·배경은 각 `*-metrics.json`/`captures.json`, 실제 이미지 쌍은 `shots/*-{foreground,background}.png`에 보존했다.

| 실제 viewport | 작은 영문 문구 크기/weight | 수정 후 최소 실glyph 대비 | 큰 제목 크기/weight | 큰 제목 최소 실glyph 대비 |
| --- | --- | --- | --- | --- |
| 390×844 | 10px/800 | **12.338369** | 52px/850 | 5.637544 |
| 360×900 | 10px/800 | **12.338369** | 52px/850 | **3.932420** |
| 414×896 | 10px/800 | **12.338369** | 52px/850 | 5.497791 |
| 1280×900 | 11px/800 | **12.338369** | 80.64px/850 | 14.865075 |

390의 추가20초 프레임에서도 작은 문구12.338369, 제목5.785006이었다. 큰 제목은3:1 기준, 작은10/11px 문구는4.5:1 기준을 적용한다. 360px의52px/850 제목3.932420을 일반 글자4.5 미만이라는 이유로 새 결함으로 판정하지 않는다. 작은 문구의 기준을 낮춘 것이 아니다.

수정 후 작은 문구의 glyph 위치 배경은 모든 네 폭 및390/20초에서 **RGB[12,8,20] 단일 색**이었다. 실제 computed background `rgb(12,8,20)`/inline-block도 확인했다. CSS 전경/배경의 독립 sRGB 계산은 **12.338369177980296**으로 실픽셀 결과와 일치한다. 이미지는 그대로이고 animation 확대가 달라져도 문구 뒤의 plate가 유지되는 것을 시작점과20초 양쪽에서 확인했다. 모든 가능한 향후 이미지/스타일/브라우저 조합을 측정한 주장은 아니다.

원래390 값은 같은 누적 `/` DOM에서 추가 display/background/padding/radius만 임시 원래 computed 값(block/transparent/0/0)으로 돌린 **old-style-baseline**으로 별도 촬영했다. 실제 작은 글자250픽셀, 최저위치(146,521), 전경[255,181,237]/배경[97,119,133], **2.9169222134365556**으로 원 독립84083f9 값과 정확히 일치한다. 이전 제품 커밋을 수정한 것이 아니라 같은 프레임 비교용 DOM 스타일 대조군이며, 원9f2c471의 이전 스크린샷 증거도 계속 보존한다. 수정 후390은 실제 글자227픽셀 모두 plate 뒤에 있었다.

## 검사·실제 UI 회귀

- 고정 사본 관련 unit **14/14 PASS**. native PG 플래그5개 process-local0. 새 테스트의 색 계산/불투명 CSS 검사는 실제 화면 측정과 별도 근거다.
- 고정 clean 사본 `tsc --noEmit --incremental false` **exit0**, component/관련 test scoped eslint `--max-warnings 0` **exit0**. 공유 생성물은 변경하지 않았다.
- `round-03-regression.mjs`의 **44/44 실제 브라우저 검사 PASS**, 결과 `regression-results.json`. 390×844와1280×900에서 각각 시행했다.
- 정상 h1하나, 제품 interactive44px 미만0, 페이지 가로 넘침 없음, broken image0, 관측 외부 resource0, video/audio/iframe0. Next dev N 버튼은 제품 크기 검사 범위 밖이다.
- 키보드 Enter 음악3 → 검색 앰비언트 CELESTIAL DRIFT1 → zzz 결과0/status작품0 → 초기화 전체6/검색 input 포커스.
- DESERT MOTION 상세 Enter, 닫기 autofocus, Tab/ShiftTab 유지, Esc→연 카드 포커스. LIQUID BLOOM 음악 상세의 미연결 안내/정지 이미지/실미디어0, Enter닫기→연 컬렉션 버튼 포커스.
- 각 폭의 별도 fresh navigation에서 NEON 상세를 연 뒤 background inert 상태에 DOM event injection으로 여행 필터를 적용해 연 카드 제거 → Esc → dialog 닫힘/내용 제거/작품 section 포커스. 실제 사용자 배경 클릭이 아닌 외부 상태 변경을 흉내 낸 시험이다.
- rail 다음 scrollLeft>100/이전<20. loading/error/empty 각각 article0·h1하나·넘침/44px 문제 없음, loading aria-busy true, 오류 Enter 재시도→6개.
- prefers-reduced-motion emulation의 matchMedia true 및 hero computed animationName none, 두 폭 모두 확인.

작성자의 최초 gone-390 실패와 이후10/10은 **작성자 기록**으로 남아 있으며 이번44건 결과로 덮어쓰지 않았다. 이번 독립 회귀는 각 모달을 fresh navigation에서 의도한 제목/open/close 포커스까지 기다리고, 닫힘 뒤 React 내용 제거도 기다렸다. 사라진 트리거는 각 폭1회씩 통과했다. 첫 R1의 성급한 연속 검사/타임아웃 기록도 보존한다. 이번에 새 제품 타이밍 반례는 발견하지 않았으나, 한정된 fresh-state 결과를 모든 초고속 연속 전환 경쟁 상태의 부재로 확대하지 않는다.

직접 시각 확인한 이미지는 fixed360/414/1280 foreground, ready-full390, dialog390음악이다. plate·제목 줄바꿈·본문·44px 메뉴·상세 안내가 보였고 추가 잘림/누락을 발견하지 않았다. 정상 전체390/1280 및 상세 영상·음악 두 폭 캡처도 보존했다. 측정/DOM 자동 결과와 눈으로 본 범위는 구분한다.

## 정리·반환

ego space53 `finish({keep:[]})` 완료, own Next 세션 Ctrl-C 종료 후 **PID78056·50957 listener 부재** 확인했다. Front에 점유 해제를 직접 전송(msg_f5f53c252d13). 원 제품/테스트/보안 경로·동시 Backend B46 WIP·공유 생성물·무관 보고서는 건드리지 않았다. 이번 추적 변경은 이 보고서만 선택 commit한다.

Master 복사 반환: T240-R2 fixede36171c **PASS(F240-1 해소/UI회귀한정)**. old3902.916922→fixed12.338369/실제plateRGB일치,360/414/1280및390frame20s동일; 제목36052px850/3.93242는큰글자3기준PASS분리.14unit/type/scopedlint0·실UI44/44PASS. 원84083f9FAIL불변·작성자gone실패/10회기록과본인freshstate근거분리·실미디어/Supabase/운영승인아님·ego/서버정리완료.
