# 프리미어 스튜디오 관리자 화면

사용자가 선택한 3안을 `617b81e` 계보의 실제 관리자 UI에 적용했다. 작업 브랜치는 `design/admin-premiere-programs`다. Backend의 이미지 Gemini 모델 ID 수정 `158dec0`은 이 브랜치에 `292d7c2`로 통합했다.

## 화면과 API연동

- 관리자 상단에서 **Style DNA**, **음악 분석**, **쇼츠 분석**을 각각 연다. 주소의 `#admin-reference-analysis`는 Style DNA로 이동한다. 해시가 없는 `/admin`은 내 프로젝트를 연다.
- 선택한 프로그램만 활성화한다. 메뉴를 이동하면 진행 중인 요청을 취소하고 이전 응답을 버린다. 업로드 파일은 브라우저에서 이미지·음악 미리보기를 제공한다. 쇼츠의 원본은 명시적으로 YouTube에서 연다.
- 요청 경로는 기존 `/api/admin/reference-analysis` 이미지 옵션, `/api/admin/music-semantic`, `/api/admin/shorts-analysis`를 이용한다. 각 전송은 해당 프로그램에서 자료를 확인하고 동의한 뒤 실행한다. **API연동**에서는 세 설정 상태를 조회한다.
- 기존 통합 콘텐츠 분석·공개 화면의 관리자 진입과 공개 준비를 교체했다. 완성본 검수·게시, 공개 결과의 데이터와 읽기 경로는 유지된다.

## 검증

- 인증·관리자·분석 Vitest 300개, 변경 코드 ESLint, 타입 검사, Windows Next Webpack 빌드와 빌드 산출물 검사 통과.
- `tests/t198-legacy-gate.test.ts`의 기존 분석 결과 공개 라우트 단언 4개는 기준 `617b81e`에서도 동일하게 실패했다.
- Chromium 390·1440px에서 이미지 URL과 파일, 음악 파일, 쇼츠 URL의 모의 요청과 전송 동의, 화면 이동 시 취소·늦은 응답 배제, API연동 조회 3건, 자동 공개 요청 0건을 확인했다.
- 320×360 글자 토큰 2배에서는 메뉴 고정이 풀렸다. 390px 및 1440px 확대까지 신규 3종과 프로젝트·완성본·대기열·API연동의 제목 초점을 확인했다.
- [로컬 관리자 UI 확인](http://127.0.0.1:8803/admin#admin-style-dna). 실제 관리자 컴포넌트를 렌더하며 분석 결과와 설정 응답은 합성이다. 온라인 운영과 실제 모델 호출은 이 검수 범위 밖이다.

브라우저 결과는 `D:/starwork/design-analysis-check/premiere-admin-product-results.json`에 있다. 테스트 진입 파일은 같은 폴더의 `check-premiere-admin-product.ego.mjs`다.
