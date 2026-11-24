# T352-R 프로젝트 HTTPS 조회 어댑터 독립 검수

2026-11-19 KST · Codex(Tester) · 고정 커밋 `1c3c330` · Master 배정 `msg_ecadca6963ac`

**판정은 보완 필요.** 제공 집중 시험과 관련 회귀는 통과했다. 별도 모의 응답 두 건에서 상세 조회가 `Content-Range`와 본문 건수의 불일치를 판정에 반영하지 않는 것을 재현했다.

## 필수 보완

상세 조회의 `get()`은 `rows()`에서 본문만 꺼낸다. 정상 합성 Auth와 올바른 `Content-Profile`로 아래 HTTP 200 응답을 전달한 두 시험이 실패했다. 목록은 이미 정확한 범위와 행 수를 대조한다. [상세 조회](../../lib/services/project-https-read.ts#L207) · [PostgREST 16 건수·범위 계약](https://docs.postgrest.org/en/v16/references/api/pagination_count.html)

| 상세 응답 | 현재 결과 | 기대 결과 |
| --- | --- | --- |
| 빈 배열, `Content-Range: */1` | 404 `NOT_FOUND` | 503 `PROJECT_READ_UNAVAILABLE` |
| 요청 ID가 맞는 정상 상세 한 행, `Content-Range: 0-0/2` | 200 및 상세 DTO | 503 `PROJECT_READ_UNAVAILABLE` |

상세 404는 빈 본문과 `*/0`가 일치할 때, 200은 한 행과 `0-0/1`이 일치할 때 반환하도록 검증하고 범위 누락과 불일치도 회귀에 포함한다.

## 통과 범위

- 앱의 인증 거부는 상세 ID 평가와 네트워크보다 앞섰다. 합성 토큰의 사용자·issuer·audience·역할·만료를 대조하고 동일 프로젝트 Auth 응답의 UUID·이메일을 비교했다. 일치한 경우에만 동일 토큰으로 데이터 GET을 보냈다. 합성 Auth 응답을 사용한 경계 시험이다.
- 고정 프로젝트 origin과 프로필, 공개 키 유형, GET·리디렉션 거부·쿠키 제외·`no-store`, 응답 프로필을 확인했다. 불완전 목록·중복·잘못된 DTO, 4MiB 초과 본문, 취소와 전송 실패를 검증했다. 정상 목록·상세 DTO의 형태와 오류 상태 매핑, 공급자 오류 및 토큰 비노출을 확인했다.
- 고정 변경은 어댑터·집중 시험·인계 3경로였다. 제공 어댑터 시험 35건을 포함한 회귀 323건이 통과했고 조건부 30건을 건너뛰었다. 소스 타입 검사, 변경 TypeScript ESLint, diff 공백 검사가 통과했다. 추가 상세 범위 시험은 검수 사본에서만 실행했다.

실제 Supabase HTTPS·Auth, 관리형 PostgREST 연결과 제품 라우트 통합은 검증 범위 밖이다. 제품 라우트에는 이 팩터리의 호출이 없다. 검수 사본을 정리했고 작성자 파일과 운영·빌드·배포·세션을 변경하지 않았다.
