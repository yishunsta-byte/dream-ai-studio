# Spectrum Lab YouTube 쇼츠 분석 후보

기준은 운영 소스 `ba983c7`이다. 기존 관리자 콘텐츠 분석·공개 메뉴의 분석기 아래에 **YouTube 쇼츠 분석**을 추가했다.

- 공개 YouTube Shorts·시청·공유 주소에서 영상 ID를 추출한다. 권리와 외부 전달 동의를 받은 요청만 서버가 처리한다.
- `POST /api/admin/shorts-analysis`는 기존 관리자 인증·동일 출처 판정을 사용한다. 설정된 Gemini 모델에 표준 YouTube 주소만 보내고 요약, 첫 장면, 화면 구성, 소리, 시간대별 근거, 새 연출 초안을 검증해 반환한다.
- 기존 파일·직접 URL 분석, 공개 API 및 DB를 재사용하거나 변경할 필요 없이 별도 분석으로 실행된다. 모델 응답은 분석 제안으로 표시하고 미확인 값은 그대로 둔다.
- 서버 환경은 기존 이미지 연동과 같은 `DREAM_REFERENCE_GEMINI_API_KEY` 및 쇼츠 전용 모델명 `DREAM_REFERENCE_SHORTS_GEMINI_MODEL`을 읽는다. 미설정 상태에서 모델 호출은 발생하지 않는다.

검증은 작성자 자체 시험이다. 관련 Vitest 38건, 대상 ESLint, Next Webpack 운영 빌드·TypeScript·추적 검사를 통과했다. 로컬 Chromium 390·1440px 합성 시험에서 키보드 실행, 필수 동의, 잘못된 주소의 요청 0·입력 초점 유지, 근거 시각·미확인·연출 초안, 입력 교체 뒤 늦은 응답 무시, 가로 넘침 0을 확인했다. 근거는 `D:/starwork/master-shorts-evidence/browser-results.json`이다.

Gemini 실호출과 배포 설정은 진행 전이다. 지표·댓글 기반 대체 분석, 대본 제작, 공개 승인 흐름은 후속이다.

플래너 전달 문구

> 기존 관리자에 쇼츠 URL 분석 후보를 연결했습니다. 합성 검증 38건과 두 화면 폭의 조작, 운영 빌드가 통과했습니다. 실제 Gemini 연결과 운영 적용은 별도 확인이 필요합니다.
