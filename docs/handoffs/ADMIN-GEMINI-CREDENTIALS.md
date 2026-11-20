# 관리자 Gemini 키 등록과 연결 확인

2026-11-21 KST · Backend · 기준 `22936b6` · Master 배정 `msg_d94ffa982c4b`

관리자 인증에서 확인한 현재 계정 UUID로 키를 읽고 저장한다. 이미지와 쇼츠는 같은 키를 사용하며 각각 모델 ID를 가진다. 음악은 별도의 키와 모델을 사용한다. 등록된 설정이 있으면 해당 계정에 우선 적용하고, 저장본이 없는 경우 기존 서버 환경 변수의 설정을 읽는다. 설정된 저장소의 조회 오류는 장애로 표시한다.

## 서버 계약

- `GET /api/admin/analysis-credentials`는 저장소 준비 상태, 그룹별 숫자 버전·마지막 저장 시각, 분석기별 설정 출처·모델 ID·최근 연결 확인을 반환한다.
- 같은 주소의 `PUT`은 `group`, `expectedVersion`, `models`와 최초 또는 교체 시 `apiKey`를 받는다. `reference`에서는 `image`, `shorts` 두 모델을, `music`에서는 `music` 모델을 받는다. 고정 Gemini Models GET으로 키와 모델의 `generateContent` 지원을 확인한 뒤 저장한다. 제공자가 거절하면 기존 설정을 보존한다.
- `POST /api/admin/analysis-credentials/test`는 `program`, `group`, 현재 저장 `version`을 받는다. 저장된 버전의 모델에 GET을 보내 확인하고 `program`, `version`, `status`, `code`, `checkedAt`을 반환한다. 저장 버전이 바뀌면 409다. 키·모델을 저장할 때 해당 그룹의 이전 확인은 지운다. 검증과 명시적 시험 모두 모델 메타데이터를 읽으며 콘텐츠 분석 호출은 실제 분석 요청에만 사용한다. [Google Gemini Models](https://ai.google.dev/api/models) · [Gemini API 키](https://ai.google.dev/gemini-api/docs/api-key)
- 쓰기는 현재 출처의 JSON 요청과 관리자 세션을 요구한다. 키 원문·접미사·암호문·상류 오류 본문은 응답과 애플리케이션 로그에 싣지 않는다. 분석기의 기존 동의, 파일·URL 검사와 결과 응답 형식은 사용을 유지한다.

## 운영 연결 조건

1. 승인한 Supabase 프로젝트의 관리자 역할로 [저장소 SQL](../../lib/db/postgres/analysis-credentials/0001_install.sql)을 적용한다. `dream_gemini_credentials`는 Data API에 노출할 필요가 없다. `dream_gemini_app`은 전용 로그인 역할로만 운영하고 `anon`, `authenticated`, `authenticator`에 역할을 부여하지 않는다.
2. 승인된 관리자가 전용 로그인 인증을 설정한다. Vercel의 서버 환경에 해당 프로젝트의 `DREAM_ANALYSIS_CREDENTIALS_DB_URL`, `DREAM_ANALYSIS_CREDENTIALS_KEYS`를 등록한다. 직접 호스트 또는 프로젝트 참조가 포함된 공급자 풀러 주소만 허용한다. 기본 데이터베이스는 `postgres`이며 TLS 인증서 검증을 사용한다. 공급자가 별도 CA를 요구하면 `DREAM_ANALYSIS_CREDENTIALS_DB_CA`에 지정한다. [Supabase PostgreSQL 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres)
3. 암호화 구성은 `{"primary":"v1","keys":{"v1":"<32바이트 base64url>"}}` 형태다. AES-256-GCM에 랜덤 nonce와 계정·그룹·버전·모델 바인딩을 사용한다. DB는 그룹별 암호문과 메타데이터만 저장한다. 저장소 키 교체는 새 기본 ID를 추가하되 기존 키를 복호화 목록에 유지하고, 기존 레코드를 새 기본 키로 재저장한 뒤 기존 키를 회수한다. 운영 키·DB 로그인 및 환경 간 이전 권한은 별도로 관리한다.
4. 먼저 승인된 시험 대상에서 관리자 설정 저장, 다른 계정 격리, 두 그룹의 저장·교체, 세 분석 GET과 합의한 분석 실행을 확인한다. 실제 키로 검사하는 작업은 이 로컬 검증에 포함되지 않았다.

Master 전달문. 전용 DB 역할과 암호화 키 구성을 승인한 환경에 준비하면 기존 계정설정에서 등록한 키를 세 분석기에서 사용할 수 있습니다. 연결 시험은 생성 호출 없이 최근 검증 결과를 저장합니다.
