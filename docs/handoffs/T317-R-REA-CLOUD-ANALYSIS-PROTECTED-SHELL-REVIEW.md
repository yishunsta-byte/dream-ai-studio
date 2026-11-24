# T317-R 클라우드 분석 셸 독립 검수

기준 `5980904` · Master 인계 `msg_7463cbab8a0b` · Codex(Tester)

**판정은 T316 단계 1의 분석 자료 분리 통과.** 클라우드 분석 페이지는 인증과 로컬 분기만 조회한다. 등록 자료 로더·연결을 import하거나 호출하지 않고, 클라이언트 셸에 자료 props를 전달하지 않는다. 셸은 공급자 없이 공통 컴포넌트를 그린다. 자료 선택이 없고 실행 버튼이 비활성이며, 실행 핸들러도 공급자 부재에서 반환한다. 새로운 목록·분석 요청 경로가 추가되지 않았다. [페이지](../../app/%28cloud%29/cloud/reference-analysis/page.tsx) · [셸](../../components/reference-analysis/studio-registered-analysis-page.tsx) · [실행 가드](../../components/reference-analysis/studio-registered-analysis.tsx#L190)

고정 임시 사본에서 페이지 단위 시험 7/7을 확인했다. 합성 연결을 켠 상태에서 목록 호출 0, 분석 자료 표식·ID·경로 미포함, 빈 props, 비활성 버튼을 검증했다. 로컬 안내와 401·403·503, 페이지 인증 조회 예외의 리다이렉트 및 유지된 목록 로더 계약도 통과했다. 클라우드 관련 회귀 묶음은 55/55였다. REA·공용 API 인증 묶음은 338건 통과, 조건부 64건 건너뜀이었다. Next 생성물 없는 고정 사본에서 `tsc --noEmit --incremental false`, 변경 소스 ESLint, 고정 변경 `git diff --check`를 통과했다.

## Main PC 생산 빌드 보고 대조

Main PC 인계는 합성 인증과 목록 호출 계수를 주입한 격리 production에서 확인 계정 HTML, 초기 Flight와 기본·세그먼트 프리페치, 정적 파일 37개에 자료 표식·ID가 0이었고 목록 호출은 전체 0이라고 보고했다. 동적 레이아웃, 공급자 부재와 페이지 import 경계에 부합한다. 보고의 401 Flight는 HTTP 200 안에 redirect 지시가 들어간 경우이며, HTML 307과 따로 판정했다. Tester는 고정 커밋에서 합성 교체 코드나 원시 응답을 확인할 수 없어 이 빌드와 와이어 관측을 재실행하지 않았다. [Main PC 인계](T317-REA-CLOUD-ANALYSIS-PROTECTED-SHELL.md)

- **본인 이메일.** 공용 CloudLayout은 확인된 계정의 이메일을 `SessionBoundary`와 `AccountMenu`에 전달한다. Main PC가 HTML·Flight에서 본 이메일은 그 계정 표시 경계에서 설명된다. 분석 자료 로더나 셸 props를 복원하지 않는다. 계정 정보까지 레이아웃에서 제거할지는 별도 범위다. [공용 레이아웃](../../app/%28cloud%29/layout.tsx) · [렌더 인증](../../lib/auth/render.ts)
- **합성 인증 예외.** 페이지 자체의 인증 예외는 503 분기와 unavailable 로그인 리다이렉트가 단위 시험에서 확인됐다. 공용 레이아웃은 `currentAccountEmail`의 예외를 직접 잡지 않아 전체 라우트의 합성 throw에서 500이 가능하다. 기존 인증 구현은 SDK 호출 중 예외를 503 결과로 바꾼다. 인계의 500은 사이트 공용 오류 경계 관측으로 기록하며, 이 예외에서 보고된 분석 표식은 0이었다. [공용 레이아웃](../../app/%28cloud%29/layout.tsx) · [서버 인증](../../lib/auth/resolve.ts)

추가 독립 생산 재현이 필요하면 Main PC에서 고정 커밋과 고정 잠금 파일로 만든 격리 사본, 합성 인증·연결 교체 코드, 요청 목록과 원시 응답을 보존한다. HTML·Flight·두 프리페치의 헤더·바이트, 401 Flight 리다이렉트 지시, 공개 정적 파일 목록의 표식 검사, 요청 전후 목록 호출 계수를 기록한다. 계정 이메일 표식과 분석 자료 표식은 각각 집계한다. Tester 임시 사본을 정리했고 생산 빌드·운영·배포는 수행하지 않았다.
