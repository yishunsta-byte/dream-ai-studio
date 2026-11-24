# 관리자 스펙트럼 랩 결합본 독립 UI 검수

2026년 11월 20일 · Design · 결합 후보 `2436e5d444ba07f12f047b770a6e9f6ab788c7f9`. Git 아카이브로 격리한 동일 코드에서 Chromium 390px·1440px로 검수했다. [검수 기준](../design/admin-content-analysis-options/SPECTRUM-PRODUCT-UI.md)

- 분석 컴포넌트는 합성 전송 대역과 실제 응답 형식을 사용했다. 입력·결과 한 열과 두 열 배치, 가로 넘침 0, 분석 권리 체크박스 제외, Threads 링크 인라인 안내와 요청 차단, URL·파일 라디오의 화살표 이동을 확인했다.
- 키보드로 단일 분석 실행, 취소 초점, 실행 버튼으로 복귀, 취소된 요청의 지연 응답 차단, 성공 제목 초점을 확인했다. 예시 응답의 200–5600ms, 2채널, 최대 정규화 RMS 37.25%, 510ms, 추정 118 BPM과 관련 관찰 근거 번호가 화면에 일치했다.
- 생성 프롬프트 원문, 편집한 수정본, 결과별 초안 유지와 별도로 동의해야 공개 버튼이 활성화되는 것을 확인했다.
- 결합 관리자 화면의 소스와 CSS 해시를 대조했다. 기본 내 프로젝트와 직접 메뉴는 분석기를 한 번 렌더링했다. 사용 매뉴얼의 지원 형식 구분, 실제 소유 검수 JPG의 브라우저 로컬 미리보기, API 연동 탭 및 분석기로 돌아올 때 제목 초점을 확인했다. API 확인 응답은 루프백 대역을 사용했다.
- 근거 `D:/starwork/design-analysis-check/spectrum-ui-2436e5d.json`, `D:/starwork/design-analysis-check/spectrum-hub-2436e5d.json`. 제품 변경 및 운영·인증 Preview 검수는 이 실행 범위 밖이다.

**Master 전달문** · 결합 `2436e5d`의 390·1440 독립 UI 검수를 통과했습니다. 분석과 공개 동의 분리, 취소 및 결과 초점, 관찰 근거·수정본, 관리자 메뉴와 파일 미리보기를 확인했습니다. 배포된 동일 SHA에서 인증 분석과 운영 접속 상태를 이어서 확인합니다.

## 최종 문구 반영 후보 검수

후보 `d4ddb6c10167d2a36d15f84f8fce8e16c2ac9508`도 별도 Git 아카이브에서 두 화면 폭의 동일 절차를 통과했다. **URL 주소**, **파일 업로드**, **권리 확인하고 분석**의 표시와 입력 설명 연결, 사용 매뉴얼 문구 일치를 확인했다. 근거 `D:/starwork/design-analysis-check/spectrum-ui-d4ddb6c.json`과 `D:/starwork/design-analysis-check/spectrum-hub-d4ddb6c.json`.

## 운영 반영과 인증 검수

`ce2cdf8e5db5e742d8696fbb5ba981803b203a02`가 운영에 배포됐다. 이전 UI 검수본 `d4ddb6c`와 비교해 마지막 변경은 분석 서버 임시 파일 처리 한 경로다. [운영 관리자 분석기](https://dream-ai-studio-orpin.vercel.app/admin#admin-reference-analysis) · [배포 상태](https://vercel.com/yishunsta-6158/dream-ai-studio/HW3MJm5nt3H9n9ERBKjPSfXY3vUs)

- 운영 관리자 화면에서 URL 주소, 파일 업로드, 단일 권리 확인 버튼, 분석 권리 체크박스 없음, 매뉴얼과 API 연동 탭을 확인했다. 인증 공개 목록 GET은 200이다.
- 승인된 JPG·MP3·MP4의 직접 URL과 동일 파일 업로드를 각각 실행했다. 분석 응답은 여섯 건 모두 422였고 결과를 생성하지 못했다. 공개·철회 운영 요청은 보내지 않았다.
- 별도 JPG 직접 URL 진단의 응답은 `analysis_failed`, `stage=inspect`, `detail=unverified_analysis`, `requestAborted=false`, `x-dream-request-signal=live`였다. 원인을 확정할 추가 검사가 필요하다. 운영 근거는 `D:/starwork/design-analysis-check/spectrum-production-verification.json`이다.

## 운영 `2a75573` 복구 확인

운영 Vercel Ready와 원격 `master`가 `2a7557348fa44097806fd8edd21d9aed28d66d71`로 일치함을 확인한 뒤 같은 관리자 인증 브라우저와 표본으로 여섯 입력을 다시 실행했다. 직접 URL은 1440px, 파일 업로드는 390px에서 검사했다. [수정본 운영 배포](https://vercel.com/yishunsta-6158/dream-ai-studio/2wvKAJNG9vAwtEKyNjYUUGtCWSe6)

| 실제 매체 | URL | 파일 업로드 |
|---|---|---|
| JPG 이미지 | HTTP 200 · 결과 17개 | HTTP 200 · 결과 17개 |
| MP3 음악 | HTTP 200 · 결과 1개 | HTTP 200 · 결과 1개 |
| MP4 영상 | HTTP 200 · 결과 1개 | HTTP 200 · 결과 1개 |

가로 넘침과 오류가 없었다. 관리자 공개 목록 GET 200, API 연동의 분석 POST 경로 및 공개 목록 조회 확인, 사용 매뉴얼의 **권리 확인하고 분석**과 4 MiB 문구를 확인했다. 운영 공개·철회 요청은 보내지 않았다. 별도 복구 증거 `D:/starwork/design-analysis-check/spectrum-production-2a75573.json`.
