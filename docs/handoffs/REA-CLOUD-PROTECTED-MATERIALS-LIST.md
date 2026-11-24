# 클라우드 분석 등록 자료 보호 목록

2026-11-20 KST · Codes(Backend) · Master 배정 `msg_319175acd5f0` · 권한 연결 기준 `f90c374`

격리용 `createIsolatedStudioAnalysisConnection`에 등록 자료 목록의 GET 처리기를 추가했다. 단건 분석과 같은 T307 저장소로 현재 권한·연결·등록 증거를 조회한다. 제품의 공개 경로와 화면은 기존 미연결 상태를 유지한다. [권한 연결](REA-CLOUD-ANALYSIS-AUTHORITY-CONNECTION.md)

## 서버 계약

| 결과 | 응답 |
| --- | --- |
| 로그인 없음, 검증 중 계정 변경 | 401 `AUTH_REQUIRED` |
| 허용되지 않은 로그인 또는 다른 오리진 | 403 |
| 연결 없음·공급원 오류·취소 | 503, 자료 없음 |
| 정상 조회 | 200과 `materials`. 항목은 `projectId`, `assetId`, `label`만 제공한다. 조회가 성공했지만 일치하는 자료가 없으면 빈 배열을 반환한다. |
| RSC, 라우터·세그먼트 프리페치, 브라우저 사전 요청 | 204 빈 응답. 인증·목록 호출 없이 처리한다. |
| GET 이외 메서드 | 405와 `Allow: GET` |

모든 응답에 `Cache-Control: private, no-store`를 적용한다. 핸들러는 루프백 주소에서 명시적으로 주입된 권한 저장소를 사용한다. 같은 서버 인증 계정을 두 번 확인하고 두 읽기의 값이 일치하는 소유 자료만 반환한다. 자료별 내부 확인값에는 현 권한·등록·스토리지 정보가 반영되며 응답에 싣지 않는다. 조회 도중 철회되거나 등록 세대가 바뀐 행은 해당 응답에서 빠진다. 다음 요청은 현재 권한으로 다시 판정한다.

## 검증

- 실제 PG17.12의 두 소유자, 합성 인증과 기존 비공개 Storage 주입으로 401·403·503과 정상·빈 200을 확인했다. 조회 중 철회 및 같은 자료 ID의 등록 세대 변경은 응답에서 빠졌다. 새 요청에서는 현재 유효 자료가 보였다. 목록 조회가 파일 다운로드 횟수를 늘리지 않았고 PG·리스너·임시 사본은 정리됐다.
- 테스트 사본의 루프백 전용 Next GET에 합성 표식과 자료 ID를 주입했다. 직접 요청은 200과 최소 DTO, `private, no-store`를 반환했다. 클라우드 분석 HTML·Flight·라우터/세그먼트 프리페치 4종은 모두 200이며 표식과 자료 ID가 없었다. 테스트 GET의 RSC·프리페치 요청 4종은 204 빈 응답이었다. 클라우드 페이지와 사전 요청이 추가 자료 조회를 시작한 횟수는 0회였다.
- 전용 계약 시험은 다른 오리진·루프백 외 요청, 계정 교체, 중복·잘못된 행과 중단된 요청을 확인했다. 참고 분석 Vitest 233건 통과, 조건부 67건 제외. 관련 파일 ESLint와 TypeScript 검사도 통과했다. [T317 자료 없는 셸](T317-REA-CLOUD-ANALYSIS-PROTECTED-SHELL.md)

```powershell
$env:STUDIO_ANALYSIS_VERIFY_CONNECTION='1'
node --conditions=react-server --import tsx tests/reference-analysis/studio-analysis-authority-store.pg17.mjs
Remove-Item Env:STUDIO_ANALYSIS_VERIFY_CONNECTION
npx.cmd vitest run tests/reference-analysis/studio-protected-materials-get.test.ts
```

위 검증은 응답을 만들기 전 권한·등록 확인까지의 격리 시험이다. 운영에서 보호 목록을 전송하려면 T323의 승인된 별도 송신 호스트·TLS·독립 원장·실제 전송 종료 증거가 필요하다. 제품 공개 경로, 클라우드 분석 셸, 운영 DB와 배포를 변경하지 않았다. [T323 운영 준비 조건](T323-REA-TWO-HOST-STAGING-READINESS.md)
