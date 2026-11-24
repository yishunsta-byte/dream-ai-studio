# 등록 PCM WAV의 읽기 전용 분석 어댑터

2026-11-20 KST · Codes(Backend) · Master 배정 `msg_ebaac34d5ba8` · 등록 시험 `f1d2b53`, 시간축 `4d0d53b`

`createIsolatedRegisteredPcmWavAnalysis`는 음악 등록 자료를 조회하는 전용 서버 어댑터다. 기존 `createStudioAnalysisPost`가 받는 `resolveAuth`와 `analyzeRegisteredSource`를 반환한다. 명시적인 격리 설정이 있어야 조립되며, 운영 기본 공급원은 미연결 상태다. [기존 WAV 권한 시험](REA-REGISTERED-PCM-WAV-AUTHORITY-VERIFICATION.md)

## 공급자 인터페이스

| 입력 | 책임 |
| --- | --- |
| `profile: "isolated-registered-pcm-wav"`, `workRoot` | 명시적으로 선택한 격리 환경과 기존 비공개 로컬 작업 디렉터리. 상대 경로·공개 경로·UNC를 거절한다. |
| `resolveAuth()` | 기존 검증 계정 결과를 제공한다. 요청의 검증 계정과 새 인증에서 확인한 사용자가 같아야 한다. |
| `readRegistration(actor, { projectId, assetId }, signal)` | 조회 시점의 본인 `rea-reference` 승인, 현재 등록 및 바이트를 하나의 증거로 반환한다. 권한이 불명확하면 자료를 반환하지 않는다. |
| 읽기 증거 | `status: "authorized"`, 소유자·프로젝트·자료 ID, 용도, 스토어·복원·링크·계정 및 범위 승인 세대, 등록 세대와 승인에 묶인 등록 세대, `audio/wav` 크기·SHA-256·원본 바이트. |

어댑터는 승인에 묶인 등록 세대가 현재 등록 세대와 동일한지 확인한다. ID·크기·해시와 기존 16비트 PCM 등록 검사를 통과한 1 MiB 이하 원본만 비공개 요청별 사본에 쓴다. 기존 분석기는 등록 사본을 다시 검증하고 실제 음악 분석을 실행한다. 분석 뒤 재인증 및 재조회에서 권한·스토어·등록 값이 달라지면 결과를 폐기한다. 종료·오류·취소에서는 생성한 사본과 디렉터리를 정리한다. 응답에는 기존 음악 제안 DTO만 사용한다.

## 검증

- 소유 루프백 PG17.12의 기존 WAV 등록 핸들러로 실제 PCM을 두 계정에 등록했다. 전용 테스트 역할과 RLS 조회를 어댑터에 주입했다. 두 계정의 본인 승인 자료에서 125ms 음악 DTO와 RMS 0.25·0.125를 확인했다. 제작용 첨부, 권리 메모 단독, 타인·미승인, 철회, 사본 준비 후 등록 세대 변경·철회에서 결과를 차단했다. 사본 SHA-256 일치, 임시 디렉터리 및 PG 리스너·클러스터 정리까지 확인했다.
- 전용 계약 시험에서 등록 제공자가 없거나 계정이 바뀐 경우, 승인·등록 세대와 해시·PCM 정합성이 깨진 경우 사본 생성 및 분석을 차단했다. 정리 시험에서는 사본 준비 후 최종 공급자 응답을 보류하고 요청을 취소해 사본 제거를 확인했다.
- 관련 Vitest 27건 통과, 조건부 1건 제외. 공동 작업공간의 참고 분석 회귀는 256건 통과, 조건부 74건 제외. TypeScript와 변경 파일 ESLint를 통과했다. 기존 이미지·영상과 보호 목록, HTTP 라우트·화면은 이 변경의 파일 범위 밖이다.

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-authority-run.mjs
npx.cmd vitest run tests/reference-analysis/studio-registered-pcm-wav-analysis.test.ts tests/reference-analysis/studio-analysis-http.test.ts tests/reference-analysis/studio-analysis-connection.test.ts tests/reference-analysis/studio-protected-materials-get.test.ts --maxWorkers=2
```

운영 연결은 신뢰할 수 있는 음악 등록·승인·철회·복원 증거의 발급과 승인된 제한 읽기 역할이 선행돼야 한다. 시험 스키마와 합성 권한은 해당 운영 증거에 해당하지 않는다. 보호 목록·단건의 공통 권한 연결과 T323의 실제 전송·종료 검증 이후에만 활성화를 검토한다. [등록 권한 범위](REA-CLOUD-MUSIC-AUTHORITY-SCOPE.md) · [T323 운영 전송 조건](T323-REA-TWO-HOST-STAGING-READINESS.md)
