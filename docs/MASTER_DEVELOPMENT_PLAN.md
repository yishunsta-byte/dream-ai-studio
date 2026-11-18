# 통합 개발 기준 계획

버전 1.3 · 상태 재정리 2026-11-18 02:19 +09:00 · 사용자 최종 결정 · Codex Master 총괄

이 문서는 사용자 지정 GitHub + Vercel + Supabase 개발의 현재 실행 기준이다. 제품 원칙·세부 완료 조건은 PLAN.md, 실제 배정/점유/수신/결과는 TEAM.md와 고정 SHA별 인수인계를 따른다. 과거 시점의 running/ready_review를 현재 배정으로 재사용하지 않는다. 구현·자체 검사·독립 검수·운영 배포·실제 개통을 구분한다.

## 현재 상태 요약

| 카테고리 | 확인된 현재 상태·근거 | 남은 작업 / 선행조건 |
|---|---|---|
| 로컬 제작 | P0/P1·타임라인/편집/영상·오디오/SRT/VTT/재편집 ZIP 지정 범위 수용 | native hidden·실제 휴대폰·청취 등 미검증은 유지. 기존 SQLite1~10·s4~s9 보존 |
| 웹·인증·세션 | T225 독립 수용, 운영 SHA8ffe3c75. T227/T228 Ready·Production Current·대시보드/HTTPS 확인 | 실제 사용자 로그인 후 사용은 미검증. 운영은 준비/읽기 화면이며 전체 작업실 개통 아님 |
| 프로젝트 읽기 | B3/B4 계열·GET2·T207/T210/T211 지정 독립 수용 | 실제 managed DB 미적용·read backend 기본 비활성. 인증 후 조회 불가 안내가 현재 예상 동작 |
| 생성·파일 검증 | B12 생성/B14 private byte 검증/B15 연결 adapter 로컬 수용 | 활성 메뉴 필수 image/video1개. 실제 비공개 Storage/등록/receipt 없이는 생성 열지 않음 |
| 업로드 프로토콜 | B16-FIX 설계·B19-FIX4 순수 상태 모델 수용 | DB 영속·권한·정책락/CAS·worker·provider IO는 별도 구현 |
| SQL4 증거 스키마 | B20-FIX2 9d38899·R3 수용, local source LF61ceb115…6089c | 선택 DDL 관계 보장만 수용, 실제 managed 이관 없음. 원 SQL1~3/v1 불변 |
| 버전별 DB 검사 | B22 f5d009e·R2 수용 | SELECT-only catalog·PG18.7 synthetic 한정. principal marker 충돌 수정 수용 |
| 버전별 이관 실행기 | B23 ea5a477·R 수용 | 원66·독립29 통과. 운영 대상 실행은 별도 정확한 범위 필요 |
| 버전별 CLI | B24 eccac35·R3b683d4 수용 | 원59·독립43, actual children22+20 검사. fingerprint는 사용자 승인 증명 아님 |
| 업로드 예약 DB 변환 | **B25 da0f740 독립85108b6 PASS 수용 / B26 G1-a Master 기술방향 확정·문서 반영 / B27 미발행 SQL5 초안 수락** | reserved-only codec·SQL parameter/row 변환·실PG roundtrip/rollback→고정본 독립검수 |
| 클라우드 개인 관리 | **누적 ebe84ea: T236 독립 PASS 수용. 원 T234 FAIL 이력 보존** | T237 하네스 보완 수용·T238 정확한 SHA 배포 준비 중. 운영 미배포 |
| 공개 멀티미디어 메인 | 사용자 신규 요구: 방문자가 완성 콘텐츠를 보는 화려한 쇼케이스. **T232 b918e42 새3안·정적시안 범위 수용, Master PC/390 정상6캡처 확인** | 새3안 비교index 제공·구조/화려함/탐색성 방향결정 후 제품범위 배정. 실제재생/API/실콘텐츠 공개는 미구현, 기존T208/private초안 보존 |
| 운영·비용 | 실제 Supabase Free50MB, 앱 요구2GiB 미충족. SSL DEC-SSL-01 미결정 | 무료 synthetic 개발 계속. 유료 전환·운영 SSL 변경은 승인 전 미실행 |
| 운영 정리 | kzxq 사용자 승인 삭제 보고·Master404 확인, 주운영 보존 | Vercel2FA는 사용자 보류. 같은 질문 반복 없음 |
| AI·확장 | 로컬 mock 기반 유지 | P3 실AI 예산/계정·P4분야·P5게시·P6고급·P7협업·P8전문은 아래 진입 기준 적용 |

## 1. 확정 구성과 운영 경계

| 영역 | 기준 | 실제 상태 |
|---|---|---|
| 저장소 | GitHub yishunsta-byte/dream-ai-studio | 운영 원격master8ffe3c75. 후속 backend 기반/CLI는 로컬 미배포 변경이며 임의 push 없음 |
| 웹/API | Vercel | https://dream-ai-studio-orpin.vercel.app · 3QDyZWKqj9ddY8Aw2ZXcCiyEeUEV Current |
| 인증 | Supabase Auth·허용계정 | 로그인/출처/세션 경계 수용·배포, 실제 사용자 계정 조작 없음 |
| DB | Supabase Postgres 목표 | 로컬 SQLite 보호, PostgreSQL SQL3/4·이관/검사/CLI는 owned synthetic PG18.7 검수 수용 |
| 파일 | Supabase private Storage 목표 | 실제 bucket/업로드·권한·등록 미개통. 2GiB 요구를 Free50MB에 맞춰 낮추지 않음 |
| worker | 메인 PC 또는 별도 서버 | 기존 로컬 렌더와 새 Storage worker를 구분. Vercel 대용량·native render 실행 없음 |
| 관리자 | 기존 개인 관리 + 클라우드 읽기 보기 | T180 A1/A2 로컬 기반, T229 클라우드 읽기 화면 구현. 새 관리자 역할/위험 조작 없음 |

## 2. 담당·점유·검증 책임

- Master: 플랜 갱신·우선순위·범위/점유 조정·결과 판정·다음 배정·공식 기록. AI_TEAM_RULES v1.4 적용.
- Backend: B25 고정da0f740 codec 수용. B26 G1-a/b 기술결정 문서 반영 + B27 drafts SQL5/고유인계 작성 수락. 실제 SQL5/role/권한 실행·registry/API/runtime 변경 없음.
- Front(메인 PC): T235 누적ebe84ea 수정본 제출. T236 동일SHA artifact/소유서비스만 지원, 브라우저는 Tester 단독 소유. 배포는 독립검수 수용 후 묶음 처리.
- Design: T230 명세8507612 수용. 사용자 신규 T232 공개 멀티미디어 메인3안 우선. T231은 현재 증거 보존 후 후순위; 기존 관리자 구현을 막지 않는다. 시안/고유보고만, 제품 파일 수정 없음.
- Tester: T234 원고정 최종보고 후 B25-R 고정da0f740 순차 검수 배정. B25 최종반환 후 T236 누적ebe84ea UI 재검수로 전환. 단일 활성 검수·브라우저 소유, production build·배포는 Front 지원.
- 현재 연결된 Tester는 Windows이며 Mac mini 연결은 미확인이다. 맥미니 Tester 배정 원칙을 장비 연결 확인 없이 기존 handle에 덮어쓰지 않는다.
- 새 Codex 창·agent·worktree 없음. 기존 세션만 사용한다. 예약은 30분마다 기존 Master 대화에 메시지만 전달한다.

## 3. 지금 실행할 작업

공개 메인 최신 결정(2026-11-18 10:55 KST): Design msg_4204fa0e183d의 사용자 직접 선택으로 T232 01 NEON SCREEN 확정. Front T240는 msg_df4a8cac5e22로 신규 격리 제품컴포넌트/샘플·허가자산/반응형·검색/상태 구현 수락·착수. 공개화 시 기존루트의 private 작업실/Auth/redirect를 보호할 통합 방안은 실소스 근거로 반환 후 Master 별도 배정. 현 app/Auth/route/API/DB·글로벌스타일 변경·실private자료 공개·가짜 재생/조회수·build/deploy는 이번 범위 밖. 고정결과→Tester 독립 UI검수·Design 시각대조, Backend B44 검수는 별도 병행한다.

최신 판정(2026-11-18 11:08 KST): B45 1회/P5body M COMMIT/actual527facts·15SQLraw성공 후최종정규화FAIL 보고접수·고정전. AuthPK실수집반영constraints700/deps2996·noSQLSTATE/nohash, lastdispatch원인미확정. 보존batch unmodifiedmoduleFAIL/표시copy offline최초원인·OS정리/2경로고정반환준비, 추가query/제품수정/allowlist확대/입력patch/skipretry금지. 결과고정후Tester독립검수→최소수정별도판정. FrontT240 NEON구현병행·원FAIL/역사보호. Golden/reference/state/provenance/runtime·운영DB배포없음·ebe84ea 미배포 조건 유지. 이 최신 판정이 아래 과거 상태보다 우선한다.

최신 판정(2026-11-18 03:42 KST): T236 고정 ebe84ea 제품 독립 PASS 수용, T237 f38d170 시험하네스 보완 수용(작성자 실행). Front는 T238 정확한 ebe84ea 배포 준비만 진행하며 push/publish 전이다. Backend B27 dfb521c 오프라인 SQL5 초안 반환 후 Tester B27-R 독립 소스 검토 수락·진행 중이다. 어떤 DB에도 SQL5 실행하지 않는다. 아래 과거 배정 설명보다 이 판정과 TEAM 최신 기록을 우선한다.

| ID / 우선순위 | 단일 책임자 / 상태 | 허용 범위·완료 조건 | 검증 담당 / 다음 행동 |
|---|---|---|---|
| B26→B27 / P2 | Backend 기술결정 문서 반영·미발행 SQL5 초안 수락 | 예약전용 pure DB codec/parameter/decoder·test/ownedPG runner/인계. 원문/ID/정책/시간/owner 일치·음성 입력·실PG roundtrip/rollback | 작성자 검사 후 고정 SHA 제출→기존 Tester 독립검수→Master 판정 |
| T229-FIX / T235 / P2 | 목록FIX+focus 누적ebe84ea 제출, T236 기존Tester 후속 배정 | /cloud/manage 읽기 전용 UI·목록 표시건수/상태·조회오류·미연결 안내·목록 링크. Auth/layout/backend 불변 | Front 합성 동작·메인 PC 격리 build, 기존 Tester 독립검수·Design 시각 대조 |
| T232 / P2·사용자 우선 | Design 제출·새3안 정적시안 범위 수용 | 공개 방문자 중심 영상·음악·이미지 쇼케이스 새3안/비교index/1280·390캡처·상태/출처·추천안 | Master3안비교→선택/구현범위결정→Front구현·Tester검수. T231은 기존 증거 보존 후 후순위 |

차단이나 추가 권한이 보고되지 않은 실행 가능한 구현은 위 담당이 계속한다. 대기 시간을 채우는 중복 과제는 만들지 않는다. 고정본 수신 뒤 검수·결함 수정·후속 범위를 배정하며 문서/단위 검사 완료마다 운영 배포하지 않는다.
## 4. 클라우드 전환 순서

| 단계 | 프론트 | 백엔드 | 의존성과 완료 기준 |
|---|---|---|---|
| C0 인증 보완 | 로그인/가입/재설정/로그아웃 상태 | 모든 보호 API 독립 getUser, 인증 공개 API 명시 | T187 PASS 후 Master 통합검증·배포. 실제 계정 변경은 별도 사용자 행동 |
| C1 접속 기반 | 기존 화면 유지 | pg pool/tx/verified actor/RLS·조회 | B3 실제 두 사용자 격리·pool재사용·commit/rollback 실패·독립 검수 |
| C2 프로젝트 읽기 | 비동기 loader/오류·로딩 | 프로젝트 조회 service와 API만 Postgres 연결 | 인증 UUID 전달·owner scope·타인 데이터 차단, 기존 DTO 유지 |
| C3 프로젝트 쓰기 | 생성·저장·충돌 복구 | 프로젝트/stage/link/audit 원자성·revision CAS | 동시 저장/실패 rollback·원문 hash 보존. 단계별 전환, 이중쓰기 금지 |
| C4 제작 데이터 | 기획/장면/글자/오디오 화면 연결 | 나머지18표 서비스 비동기 전환·append-only 규칙 | SQLite 대비 기능 회귀·기존 승인 무효화·불변 결과 보존 |
| C5 파일 | 큰 파일 직접 업로드·진행/취소 | 비공개 bucket/signed URL/upload-complete 검증 | 원본 덮어쓰기 방지·실제 MIME/크기/hash·소유권/만료/중단 정리 |
| C6 처리기 | 대기/진행/취소/결과 표시 | PC worker Postgres claim/fencing/global동시1·Storage 결과 | 웹 요청→worker 실제 렌더→파일 검사→게시, lease/retry/late cancel |
| C7 백업 복구 | 관리 화면의 범위/복구 안내 | Postgres+Storage 일관 백업·검증·복원/rollback 설계 | 로컬 ZIP을 클라우드에 그대로 적용했다고 하지 않음. 손상/타 owner 거절 |
| C8 관리자 | 개인 관리 개요·작업·자료·기록 | 안전한 상태 DTO·정확한 관찰 시각·권한 | 로그인 필수, 상태 읽기와 위험 조작 분리, 실패/이전환경 구분 |
| C9 전환/배포 | 보호 preview와 정식 주소 | 검증된 migration runner·환경변수·롤백 | 시험 Supabase 검수 후 실데이터 계획. 로컬3013 복구 기준 보존 |

모든 단계에 전체 사용자 재승인을 만들지 않는다. 일반 구현 판단은 Master가 정한다. 유료 자원·데이터 파괴·기존 승인 밖 외부 변경은 구체 산출물을 준비한 뒤 필요한 결정만 요청한다.

## 5. 관리자 상세

### 생성 개통의 실제 선행 조건 (2026-11-17 갱신)

B12 프로젝트 생성 service/repo는 고정83affcf 기준 B12-R 독립 검수로 미연결 서버 구현 범위를 수용했다. 실제 API·UI 생성 기능은 아직 개통하지 않았다. 현재 활성 shopping-shorts는 image/video 자료 최소1개가 필수이므로 C5의 비공개 Storage·소유 자료 등록·실제 존재/무결성 검증을 C3 생성 개통의 선행 작업으로 진행한다. `assetAvailable` 임의 true, 필수 첨부 제거, 링크형 자료로 우회하지 않는다. T218은 생성 UI/API 계약, T219는 준비 안내만이며 실제 쓰기 승인이 아니다. B13은 후속 저장·CAS·승인 무효화 계약을 구체화한다. 운영 SSL 변경 DEC-SSL-01 대기와 합성 DB에서의 독립 개발은 분리한다.

1. 개요: 저장 점검·worker 최근 응답·현재 환경 백업, 문제만 요약.
2. 작업: 대기/실행/실패/취소·재시도, 실제 서버 상태와 제한을 그대로 표시.
3. 자료: 원본/렌더/ZIP 사용량·참조·보관·권리 기록. 기록이 사용권 확인은 아님.
4. 백업: 최근 성공/실패·현재 파일 존재·이전 환경·복원 ticket/단계 보존.
5. 로그: 민감값을 제거한 오류/활동/요청 추적, 실패를 polling 성공으로 지우지 않음.
6. 인증/권한: 우선 개인 허용계정. 다중사용자/관리자 역할 확대는 별도 계약.
7. 운영 조작: worker 재시작·전체 삭제·복원 덮어쓰기 등은 초기 범위에서 제외.

## 6. 기존 구현과 검증 한계

P0/P1과 P2 타임라인·편집·영상/오디오 렌더·SRT/VTT·원본 재편집 ZIP은 로컬에서 범위 검수됐다. 고정 s4~s9/발행 SQLite1~10은 변경하지 않는다. Postgres는 별도 스키마/runner로 운영한다. 실제 휴대폰·청취·native hidden·스크린리더·일반 영상 전체에 대한 정확도는 미확인이다. 반복 렌더 바이트 결정성은 보장하지 않고 보관 파일 hash는 엄격히 유지한다.

## 7. 추가 개발·확장

| 묶음 | 내용 | 진입 기준 |
|---|---|---|
| 품질 | 모바일 제목/반응형·접근성·진단 요약 복사·오래된 상태 안내 | 핵심 결함 우선, 실제 재현·필요성 기반으로 배정 |
| AI(P3) | 기획/대본·이미지·캐릭터·영상·음성 | 인증/owner 데이터 경계·예산 제한·실제 청구/거절 기록 |
| 분야(P4) | 여행/쇼핑·플레이리스트·가사·공모전 | 기존 파이프라인 재사용·자료 권리·분야 검수 |
| 게시(P5) | 채널별 파일/설명 묶음·비공개/예약·지표 | 플랫폼 권한/최종 공개 승인과 재시도·중복 방지 |
| 고급(P6) | 장편·드라마·뮤직비디오·2D/3D 템플릿 | 짧은 합성 시험 후 품질·비용 확인 |
| 협업(P7 후속) | 여러 사용자·공유 프로젝트·RLS 역할 | 개인 클라우드 안정화와 명시 역할/공유 정책 |
| 전문(P8) | 별도 업무 공간 | 별도 저장소·분야 전문가·권한/보안 설계 |

## 8. 결과 수용

작업자 ready_review → Master 변경 범위/원검증 확인 → Tester 독립 검수 → 결함 보완/재검수 → 선택 통합 → 배포 전 확인 → 실제 URL/버전 검증. 테스트 PASS와 배포 완료를 구분한다. 공유 worktree는 선택 stage하며 다른 WIP를 보존한다. 보고서만 만들었다고 메시지 전달/구현 완료로 처리하지 않는다.

## 9. 다음 기능 단위와 재개 조건

| 순서 | 다음 기능 | 선행조건 / 검증·권한 경계 |
|---|---|---|
| 1 | 업로드 예약 DB 변환·개인 관리 읽기 UI | B25/T229/T230 현재 병행. 원문·소유·정직한 상태·세션 보호 검수 |
| 2 | 실제 업로드 예약 transaction·idempotency·policy lock | codec 수용 및 least-privilege 설계 확정. 원SQL·role 계약 변경은 별도 범위로 조정 |
| 3 | capability 발행·upload-complete·worker claim/lease/fencing | B16/B19 순서·전이 adapter와 durable outbox, 실SQL 경쟁/재시도/취소 검증. 실제 provider 연결은 준비·권한 확인 후 |
| 4 | byte 검증·final publication·receipt 등록·재검증/GC | 같은 artifact/no-overwrite/최종hash·1object:Nreceipt·영구tombstone·late write 차단·worker quiescence 근거 |
| 5 | 실제 프로젝트 생성·폼·필수 자료 연결 | 실제로 사용 가능한 검증된 owner asset/receipt 충족. assetAvailable=true·필수 첨부 제거 우회 금지 |
| 6 | 제작·저장 CAS·worker render·개인 관리 상세 | B13/기존 승인 무효·원본 불변·단계 gate와 실제 데이터 연결, local/cloud 계약 분리 |
| 7 | managed staging/운영 전환·묶음 배포 | 정확한 프로젝트/환경·TLS/권한·이관/rollback·Storage 한도/비용·실사용 흐름 검증. 로컬 PASS를 운영 개통으로 승격하지 않음 |

## 10. 확인·배포·기록

- 실제 점검 시각/근거/판정/배정/미확인은 TEAM.md에 기록한다. 이 문서 갱신 시각이 실제 모든 기능의 재검증 시각은 아니다.
- 마지막 이후 보고·신규/수정/미등록 결과·사용자 타 세션 직접 지시를 대조한다. 과거 보고를 반복 실행하거나 오래된 running 표로 중복 배정하지 않는다.
- 자체 검사 → 독립 검수 → Master 수용 → 메인 PC의 고정 후보 build/배포 검증을 구분한다. 자잘한 수정은 묶어서 배포한다.
- 실제 로그인 뒤 사용·실Storage/DB 개통·휴대폰/청취 등 아직 하지 않은 확인은 미검증으로 유지한다. 새로운 비용·권한·제품 결정과 사람만 가능한 행동만 사용자에게 취합한다.
## 11. 사용자 신규 요구: 방문자용 멀티미디어 메인 (2026-11-18)

- 작업된 완성 콘텐츠를 방문자가 둘러보는 공개 쇼케이스를 메인의 중심으로 둔다. 창작/관리 작업실·private project·초안·원본 데이터 접근 경계는 유지한다.
- 영상 썸네일·음악 커버·이미지 작품·카테고리/검색·재생/상세 진입을 우선한다. YouTube/Suno/영상 사이트의 현재 공개 UI를 참고하되 로고·브랜드를 복제하지 않고 실제 참고 근거를 남긴다.
- T232 새3안은 대형 네온 시네마/사운드·앨범 중심/크리에이터 영상 피드처럼 구조부터 달리 제작한다. 화려한 색·커버·모션과 한국어 가독성·대비·390반응형·키보드·reduced motion을 함께 검증한다.
- 실제 공개 콘텐츠 목록/권한/출판 계약은 아직 없다. 시안의 샘플은 샘플로 표시하고, 운영 시에는 공개 대상으로 선택된 완성 콘텐츠와 허용 자산만 노출한다. 기존 private DB/PC 파일을 자동으로 게시하지 않는다.
- 현재 배정은 시안 제작이며 운영 root/Auth/layout/파일공개 변경은 아직 구현·배포하지 않았다. T208은 과거 후보로 보존하고, T229 개인 관리/B25 저장계층은 병행한다.
### B26 G1-a/b Master 기술선택 (2026-11-18)

- PG18.7 축소 native 검토 B26-R2 92c6a70에 따라, 비슈퍼유저 생성자가 직접 회수할 수 없는 자동 ADMIN 간선은 마이그레이션 전용 trusted owner의 정확한1개(admin=true/INHERIT=false/SET=false·검증된 native grantor)만 최종 예외로 설계한다. ADMIN의 SET 재획득 가능성을 숨기지 않고 런타임 DB credential과 관리 root를 분리한다. runtime/API/worker·기타 경로는 허용하지 않는다.
- createrole_self_grant와 실제 간선·대상 메이저는 preflight/native inventory로 검증하고 미확인은 실패 처리한다. 서버 global 설정을 자동 변경하지 않는다.
- 단일 migration transaction·함수 생성 직후 명시적 PUBLIC/API/worker REVOKE·COMMIT 전 exact ACL 검증을 필수로 한다. 이번 경로에서는 global default ACL을 임시 변경하지 않는다.
- 현재 B27은 drafts/0005_upload_reservation.sql 및 고유 인계의 **파일 작성만** 허용한다. 어느 DB에도 적용하지 않고 기존3/4 registry·SQL1~4·runtime을 바꾸지 않는다. 초안 검토와 실제 전체 SQL4+5/권한·경쟁·실패 회귀는 다음 별도 단계다.