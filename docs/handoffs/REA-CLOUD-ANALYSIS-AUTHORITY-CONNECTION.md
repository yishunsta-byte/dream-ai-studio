# 클라우드 콘텐츠 분석 권한 연결

2026-11-20 KST · Codes(Backend) · Master 배정 `msg_b0e1543b4185`

격리 환경에서 기존 서버 인증, T307 PostgreSQL 등록 권한 저장소, 비공개 저장소의 검증된 파일과 단건 분석을 연결했다. 두 조회가 같은 저장소와 버킷·용량 제한을 사용한다. 현재 제품 기본 공급원은 미연결 상태다. [T307 등록 권한 저장소](T307-REA-REGISTERED-AUTHORITY-STORE.md)

## 연결 계약

- `createIsolatedStudioAnalysisConnection`에 루프백 PostgreSQL 시험 설정, `synthetic` 비공개 저장소 설정과 서버 인증 함수를 명시적으로 제공한다. 초기 검증이 끝난 저장소 하나로 `loadMaterials`와 분석 POST를 조립한다. 설정 누락·불일치나 권한 사전 검사 실패는 미연결로 처리한다.
- 목록은 인증된 본인 계정의 현재 승인 자료에서 표시 이름과 프로젝트·자료 ID만 반환한다. 이 로더는 격리 호출용이며, 기존 클라우드 셸은 초기 HTML·RSC 렌더에서 자료를 읽지 않는다.
- POST가 확인한 사용자와 파일 분석을 시작할 때 재확인한 사용자 ID가 같아야 한다. 파일을 읽기 전과 분석 앞뒤에 현재 등록과 권한을 대조한다. 현재 권한, 스토리지 세대, 원본 크기·해시가 일치하는 비공개 사본만 분석하며, 응답은 기존 제안 DTO를 사용한다.

## 확인 결과

| 시험 | 결과 |
| --- | --- |
| 실제 소유 루프백 PG17.12와 합성 Auth·비공개 Storage | A·B 각자의 등록 PNG에 서로 다른 색상 제안. 각 정상 분석의 파일 다운로드 1회. 타인·미등록·철회·분석 시작 직전 계정 교체는 자료 다운로드 전에 차단. 미설정 POST 503, 비허용 Auth 403, 현재 등록 증거 변경과 같은 길이의 파일 변조는 결과 차단. 다운로드 디렉터리·PG 프로세스와 리스너 정리 확인. |
| 실제 격리 Next 개발 응답 | 시험 사본에 표식이 든 공급원을 연결하고 POST 호출 1회를 확인했다. 같은 사용자 HTML, Flight, 라우터 프리페치, 세그먼트 프리페치가 모두 200. 목록 호출 0회. 네 응답에 등록 자료 표식·프로젝트 ID·자료 ID가 없고 HTML은 미연결 셸을 유지했다. 임시 사본과 서버를 정리했다. [T317 셸 계약](T317-REA-CLOUD-ANALYSIS-PROTECTED-SHELL.md) |
| 회귀 및 정적 검사 | 기존 T307 PG17 시험과 참고 분석 Vitest 224건 통과, Vitest 실행 조건부 67건 제외. 변경 파일 ESLint와 `tsc --noEmit -p tsconfig.typecheck.json` 통과. |

```powershell
$env:STUDIO_ANALYSIS_VERIFY_CONNECTION='1'
node --conditions=react-server --import tsx tests/reference-analysis/studio-analysis-authority-store.pg17.mjs
Remove-Item Env:STUDIO_ANALYSIS_VERIFY_CONNECTION
```

현재 시험은 등록 PNG를 사용했다. T307 저장소가 지원하는 등록 영상도 같은 조회 정책을 사용하며, 음악 등록 권한 연결은 별도 범위다. 기존 운영 셸에서 자료를 표시할 보호 목록 경로와 운영 등록 증거 발급은 후속 작업이다. 운영에서 보호 응답을 보내려면 T323의 승인된 별도 호스트·TLS 송신 경계·독립 원장·종료 증거가 필요하다. 이번 격리 시험은 앱에서 결과를 반환하기 전의 권한 확인까지 검증했다. [T323 운영 준비 조건](T323-REA-TWO-HOST-STAGING-READINESS.md)
