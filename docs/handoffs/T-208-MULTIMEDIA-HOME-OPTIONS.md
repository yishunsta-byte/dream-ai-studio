# T208 · Multimedia homepage directions

- Owner: Codex design / CX-DESIGN-01.
- Request: 사용자 직접 요청 — 멀티미디어 사이트처럼 더 화려한 3안으로 재구성.
- Scope receipt: Master `msg_c0faf600c21d`; only `docs/design/t194-multimedia-options/` and this report.
- Status: ready_review. 시안 작성·자체 검증 완료. 사용자 선택·제품 반영·배포는 별도입니다.

## Review entry

[3안 비교 페이지](../design/t194-multimedia-options/index.html). 서버 없이 파일을 직접 열 수 있습니다. 비교 화면의 각 카드에서 시안을 열고, 상단 상태 보기로 7가지 상태를 확인할 수 있습니다.

| 안 | 구조와 시각 방향 | PC | 모바일 | 클라우드 예시 |
|---|---|---|---|---|
| [01 NEON PLAY](../design/t194-multimedia-options/neon-play.html) | 블랙·핑크·시안, 네온 공연 히어로, 가로형 장면 그리드, 작업·환경 카드 | [1280](../design/t194-multimedia-options/screenshots/neon-1280-normal.png) | [390](../design/t194-multimedia-options/screenshots/neon-390-normal.png) | [안내](../design/t194-multimedia-options/neon-play.html?state=cloud) |
| [02 COLOR WAVE](../design/t194-multimedia-options/color-wave.html) | 밝은 배경, 오렌지·퍼플, 검색 중심 인트로, 사진·카피 분할 히어로, 높이가 다른 갤러리 | [1280](../design/t194-multimedia-options/screenshots/wave-1280-normal.png) | [390](../design/t194-multimedia-options/screenshots/wave-390-normal.png) | [안내](../design/t194-multimedia-options/color-wave.html?state=cloud) |
| [03 CINEMA STAGE](../design/t194-multimedia-options/cinema-stage.html) | 풀 블리드 해안 풍경, 딥 틸·골드, 대표 이미지 전환, 편집형 큐레이션과 작업 지면 | [1280](../design/t194-multimedia-options/screenshots/cinema-1280-normal.png) | [390](../design/t194-multimedia-options/screenshots/cinema-390-normal.png) | [안내](../design/t194-multimedia-options/cinema-stage.html?state=cloud) |

**추천은 01 NEON PLAY.** 강렬한 미디어 첫인상과 탐색·작업 진입의 균형이 가장 좋습니다. 밝은 크리에이티브 이미지 중심은 02, 브랜드 영상미와 몰입감 우선은 03이 적합합니다. 최종 선택은 받지 않았습니다. 시각적으로 화려한 만큼 실제 제품 적용 시 이미지 용량과 미디어 로딩 전략을 별도 설계해야 합니다.

## Assets and functional boundaries

- Built-in Imagegen으로 네온 공연·자동차 광고·해안 풍경의 정지 이미지 3장을 새로 생성했습니다. 참조 이미지 없이 생성했으며, 6개 장면 카드는 3개 원본을 구도별로 재사용합니다. 제품 영상·사용 가능한 제작 템플릿으로 표시하지 않습니다.
- [자산 기록](../design/t194-multimedia-options/assets/ASSETS.md)에 정확한 프롬프트, 생성 도구·모드, 원본 경로, 복사 경로, 사용 조건 확인 범위를 남겼습니다. 독점·무제한 상업 이용 권리를 검증했다고 주장하지 않습니다.
- T194에서 Pretendard 폰트·OFL·출처 기록 3개 파일을 그대로 재사용했습니다. 새 HTML/CSS/JS와 비교 페이지를 작성했으며 기존 T194 시안은 보존했습니다.
- 장면 확대는 정지 이미지 대화상자입니다. 실제 영상·오디오 재생, 다운로드, 계정 연결, 저장, 제작 API 호출이 없습니다.
- 제작 진입은 쇼핑숏츠 샘플의 기획 흐름 예시입니다. 뮤직·여행 제작은 준비 중으로 안내합니다. 입력값은 저장·전송하지 않고 텍스트로 표시합니다.
- 로딩은 새 작업 버튼 비활성화와 사유, 빈 목록은 첫 작업 안내, 오류는 복구 시뮬레이션, 오프라인은 연결 안내, 로그인 전은 계정 안내, 클라우드는 제작 흐름 안내로 구분합니다.
- 워커의 최근 응답과 성공·프로세스 종료를 구분하는 설명을 유지했습니다. 성공 수치·조회 수·재생 시간 등 실제 데이터로 오인할 가상 지표를 넣지 않았습니다.

## Verification

- Ego Browser TaskSpace 38, 로컬 파일에서 검증. 비교 결과 탭만 사용자 확인용으로 남겼습니다.
- [레이아웃 기록](../design/t194-multimedia-options/layout-audit.json): 3안 × 7상태 × 1280/390 = **42/42 통과**. 가로 넘침 0, H1 각 1개, 이미지 정상, 표시되는 조작 요소 높이 44px 이상, 외부 HTTP 자원 요청 0, reduced-motion에서 애니메이션 없음.
- [동작 기록](../design/t194-multimedia-options/interaction-audit.json): **53/53 통과**. 장르 필터·검색 결합·검색 초기화·빈 결과, 정지 이미지 확대, Tab/Shift+Tab 포커스 순환, Escape·원래 트리거 복귀, 이름 입력의 HTML 해석 방지, 앵커 포커스, 7가지 상태 동작, 대표 이미지 순환, 핵심 텍스트 색 대비 4.5:1 이상을 확인했습니다.
- 비교 페이지 1280/390: 가로 넘침 0, 깨진 이미지 0, 링크·summary 44px 이상. 스크린샷과 3개 시안 링크를 확인했습니다.
- [스크린샷 폴더](../design/t194-multimedia-options/screenshots/): 상태별 42장, 비교 2장, 간결한 PC 프리뷰 3장. 기본 PC/모바일 6장과 비교 화면을 직접 시각 검토했습니다.
- 모바일 작업 카드가 좁은 열로 눌리던 문제를 2열 grid로 수정하고, COLOR WAVE 제목의 한 글자 줄바꿈을 조정한 뒤 42상태를 다시 캡처했습니다. 대화상자의 명시적인 키보드 포커스 순환도 보완했습니다.
- `node --check docs/design/t194-multimedia-options/media.js` 통과. staged diff whitespace 확인 통과.
- 실제 휴대전화·스크린리더·제품 API 통합·제품 빌드 검증은 포함하지 않습니다. 정적 시안 범위에 맞춰 브라우저로 검증했습니다. 사진 위 텍스트는 오버레이와 PC/모바일 캡처로 직접 확인했으며, 색 토큰 검증을 사진 전체 픽셀에 대한 접근성 인증으로 확장하지 않습니다.

## Protected work and next step

제품 코드, Auth/DB/cloud WIP, 공유 `.next`, 3013 서버, Vercel은 변경하지 않았습니다. 새 패키지나 서버를 설치·실행하지 않았습니다. 변경은 승인된 새 시안 폴더와 본 보고서뿐입니다.

사용자가 방향을 선택하면 해당 안을 제품의 실제 프로젝트·템플릿·제작 환경 데이터에 연결하는 별도 범위를 정합니다. 현재 산출물은 디자인 검토용입니다.
