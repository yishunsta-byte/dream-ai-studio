# 로컬 URL 분석 결과의 버전 저장·복원 검수

기준 `26065fd`. 통합 개발 계획의 **분석 근거 비교** 항목은 실제 URL 분석 저장 뒤 같은 자료의 두 버전과 근거 위치를 다시 열 수 있어야 한다. 고정 `LocalUrlAnalysis`와 결과 컴포넌트를 별도 루프백에서 그대로 렌더링하고 분석 서버 액션의 응답만 합성 DTO로 대체했다. 같은 시험 URL에 1차 `0·1000 ms`, 2차 `0·2000 ms`의 영상 근거를 반환했다. [개발 계획](../MASTER_DEVELOPMENT_PLAN.md)

| 흐름 | Chromium 390×844 및 1440×900 |
| --- | --- |
| 한 분석의 결과 전환 | 원본 URL과 프레임 위치가 표시됐다. 두 결과의 수정본을 독립적으로 편집한 뒤 방향키로 오가면 결과별 수정본이 복원됐다. 생성 초안과 수정본 차이도 표시됐다. |
| 같은 URL 재분석 | 새 관찰값과 생성 초안만 표시됐고 첫 분석의 결과와 수정본은 사라졌다. 결과 영역에는 두 실행을 저장하거나 다시 선택하는 조작이 없었다. |
| 새로고침 | 주소 입력, 권리 확인, 분석 결과와 편집이 초기화됐다. 검수 출처의 localStorage·sessionStorage·IndexedDB에 저장된 항목은 0이었다. |

로컬 화면은 현재 `result` 하나와 결과별 `drafts`를 컴포넌트 상태에 둔다. 재분석은 그 상태를 먼저 지우고 새 결과를 표시한다. 서버 액션은 확인된 로컬 요청의 분석 DTO를 반환한다. 이 진입점에서 이전 실행의 읽기 또는 두 버전 비교를 제공하는 저장 경로는 확인되지 않았다. [로컬 화면](../../components/reference-analysis/local-url-analysis.tsx) · [결과 화면](../../components/reference-analysis/studio-registered-analysis.tsx) · [서버 액션](../../app/(studio)/studio/reference-analysis/actions.ts)

**판정** · 한 분석 안의 편집과 근거 비교는 확인됐다. 동일 자료의 두 실행을 저장·복원하는 완료 기준은 이 경로에서 미충족이다. 후속 시험에서는 같은 URL로 두 분석을 저장하고 새 문서에서 양쪽 초안·수정본과 각각의 실제 근거 위치를 다시 확인한다.

증거 `D:/starwork/tester-evidence/local-url-version-26065fd/browser-results.json`. 각 화면의 최초 진입과 새로고침에서 루프백 HTML·JS·CSS만 받았다(총 12건, 전부 200). 실제 URL 요청과 분석 서버 실행은 없었다. 검수용 탭과 루프백은 종료했다.
