# B26-R 업로드 예약 거래 계약 독립 설계 검토(권한·잠금·지연 검사)

- 검토자: Codex(Front)(term_a0a6f98c), 저자와 별도 입장 · 배정: CX-MASTER-01 `msg_4190db95455f`
- 대상: `docs/handoffs/B26-UPLOAD-RESERVATION-TRANSACTION-CONTRACT.md` @ `8d53575241b45588e2a8cd1e799f39b8466e335d`(153행)
- 대조 근거
  - SQL4 `lib/db/postgres/0004_storage_verification.sql`: 261–423 storage_guard, 436– storage_consistency_guard, 555–575 RLS/grant
  - 계약 본문
- 실제 확인
  - 제 소유 임시 클러스터 PostgreSQL **18.7**(`.tools/b3-postgres-18.7`, 127.0.0.1 임시 포트)에서 작은 native 프로브를 했어요.
  - 역할 구성: 비superuser `mig`(마이그레이션 소유자 역할), `api` LOGIN, `reserver` NOLOGIN NOINHERIT NOBYPASSRLS. 표는 모두 FORCE RLS예요.
  - 끝난 뒤 정지(`server stopped`, 포트 닫힘 확인)하고 데이터 폴더를 지웠어요.
  - 운영·3013·공유 .next·다른 소유 클러스터는 쓰지 않았어요.
- 상태: **검토 완료(설계 판단 근거)**. SQL5·역할·grant·API 구현이 아니에요. 제품·계약 문서는 바꾸지 않았어요.

## 1. 결론 요약
- 권장 경로(NOLOGIN 함수 소유 역할 + SECURITY DEFINER 진입 함수 2개 + append-only SQL5)는 실제 PG 18.7 동작과 대체로 맞아요.
- 다만 **필수 보완 2건**, **명확화 권고 3건**, **미검증 3건**이 있어요.

| 구분 | 항목 |
|---|---|
| 필수 gap | G1 비superuser 마이그레이션의 함수 소유자 이전 절차(일시 멤버십+스키마 CREATE)와 "멤버십 없음" 문구 충돌 |
| 필수 gap | G2 정책 anchor `FOR SHARE`가 정책 범위 밖이면 **오류 없이 0행** → 반드시 FOUND 확인 후 fail-closed |
| 권고 | C1 지연 트리거 실행 역할은 "이벤트가 쌓인 때의 역할"(18.7 실측) → 대상 운영 PG 메이저 버전에서 같은 확인을 수용 조건으로 |
| 권고 | C2 래치는 READ COMMITTED·VOLATILE 전제 → 함수 안에서 격리 수준 확인 후 아니면 fail-closed |
| 권고 | C3 잠금 전용 UPDATE(col)+WITH CHECK false는 실측대로 동작 → SQL5 시험에 "보이지만 UPDATE USING 밖 행"도 포함 |
| 미검증 | B3 unknown COMMIT·커넥션 정리, 동일 payload 정규형 문법, 다른 PG 메이저의 지연 트리거 역할 |

## 2. 실측 결과(native, PG 18.7)

| # | 확인 | 결과 | 계약 대조 |
|---|---|---|---|
| P1-a | 정의자 함수(reserver 소유) 안 `SELECT … FOR SHARE`(정책 anchor) + INSERT | 성공. 반환 `current_user=reserver` | 계약 2절 표·SECURITY DEFINER 경로와 일치 |
| P1-b | 같은 함수 권한으로 `UPDATE d.pol SET id=id`(UPDATE(id)만, `WITH CHECK (false)`) | **거부**: "새 자료가 pol 테이블의 로우 단위 보안 정책을 위반" | "lock-only, 저장 금지"와 일치 |
| P1-c | SELECT·UPDATE USING 모두 밖인 행 `FOR SHARE` | **0행**(오류 아님) | → G2 |
| P1-e | SELECT 정책으로는 보이지만 UPDATE USING 밖인 행 `FOR SHARE` | **0행**(오류 아님) | "UPDATE USING이 잠금 SELECT에 적용"과 일치, 실패 방식은 조용한 제외 → G2 |
| P1-d | `UPDATE(id)` 회수 뒤 `FOR SHARE` | **권한 오류**: "pol 테이블에 대한 접근 권한 없음" | "SELECT만으로는 잠금 불가"와 일치 |
| P2-a | INVOKER 지연 constraint trigger(INITIALLY DEFERRED)를 정의자 함수 안 INSERT로 쌓고, 함수 반환 뒤 api 세션이 COMMIT. api는 트리거가 읽는 표에 SELECT 없음 | COMMIT 성공. 트리거 안 `current_user=reserver, session_user=api` | 계약은 "API로 돌아간 뒤 지연 발화 시험 필요"라고 적음 → 18.7에서는 **이벤트 쌓인 때 역할**로 실행 → C1 |
| P2-b | 정의자 함수 안 `SET CONSTRAINTS d.obj_consistency IMMEDIATE`(이름 지정) | 함수 안에서 reserver로 실행, 성공 | ALL 금지와 별개로 **이름 지정** 즉시 발화는 버전 무관 대안 |
| P2-c | 트리거 함수 EXECUTE를 PUBLIC에서 회수(reserver·api에 부여 안 함) | 트리거는 그대로 발화 | "EXECUTE 회수가 트리거 발화를 막지 않음"과 일치 |
| P3-a | 비superuser `mig`가 `ALTER FUNCTION … OWNER TO reserver`(멤버십 없음) | **거부**: "SET ROLE reserver 작업이 있어야 함" | → G1 |
| P3-b | `GRANT reserver TO mig WITH INHERIT FALSE, SET TRUE` 뒤 같은 명령, reserver에 스키마 CREATE 없음 | **거부**: "r 스키마 접근 권한 없음" | → G1 |
| P3-c | + `GRANT CREATE ON SCHEMA r TO reserver` 뒤 | 성공 | |
| P3-d | 이전 뒤 CREATE·멤버십 회수 | 소유자 reserver 유지, `has_schema_privilege(reserver,r,CREATE)=false`, `pg_has_role(mig,reserver,MEMBER)=false`, 함수 실행 정상 | 일시 부여 → 회수 절차가 성립 |
| R1 | 두 연결, 같은 owner/request·같은 payload, 정의자 함수 `INSERT … ON CONFLICT (owner,rid) DO NOTHING RETURNING` 뒤 새 문장으로 승자 읽기. s1이 3초 보유 후 COMMIT | s2 약 2초 대기 후 `replay:p1`, s1 `new:p1` | 계약 4단계 "대기 뒤 새 문장에서 승자 읽기"와 일치 |
| R2 | 같은 키·다른 payload | s2 `conflict:p1` | 일치 |
| R3 | s1 ROLLBACK | s2 대기 후 `new:p1`(새로 입장) | "rollback 뒤 직렬화된 부재에서만 새 입장"과 일치 |
| R* | 래치 표에는 reserver에 SELECT·INSERT 정책만 있음(UPDATE 없음) | `ON CONFLICT DO NOTHING` 정상 | DO NOTHING은 UPDATE 권한·정책이 필요 없음 확인 |

## 3. 필수 보완

### G1 함수 소유자 이전 절차가 계약에 없음, "멤버십 없음" 문구와 충돌
- 계약 2절 2항은 이렇게 적어요.
  - reserver는 "Owns only the two bounded entry functions … No API/worker/login membership in this role"
  - 1항은 런타임 CREATE를 회수한다고만 해요.
- 실측
  - 비superuser 마이그레이션 역할은 **reserver에 SET 가능한 멤버십** 없이는 소유자를 넘길 수 없어요(P3-a).
  - 멤버십이 있어도 **reserver가 대상 스키마에 CREATE**를 가져야 해요(P3-b).
  - 관리형 PG의 마이그레이션 역할은 보통 superuser가 아니에요.
- 요구
  - SQL5는 **한 마이그레이션 거래 안에서** 다음 순서를 명시해야 해요.
    1. `GRANT reserver TO <migration owner> WITH INHERIT FALSE, SET TRUE`
    2. `GRANT CREATE ON SCHEMA dream_reservation TO reserver`
    3. `ALTER FUNCTION … OWNER TO reserver`(정확한 서명 2개)
    4. CREATE와 멤버십 회수
    5. 회수 결과 inventory 확인(P3-d 형태)
  - "login membership 없음"은 **COMMIT 시점 상태**로 정의하고, 거래 안의 일시 멤버십은 예외로 명시해요.
  - 소유자 이전 전 함수는 PUBLIC EXECUTE를 회수한 상태로 만들어요. 그래야 "일시적 공개 진입점 없음" 요구가 지켜져요.
  - superuser 경로를 쓰는 배포라면 그 credential은 마이그레이션 전용이어야 하고, 런타임 풀 금지 원칙과 함께 적어요.

### G2 정책 anchor 잠금은 범위 밖이면 조용히 0행
- 계약 4절 2단계 "Acquire policy anchor FOR SHARE"와 "unavailable/corrupt anchor … is a safe data/configuration error"는 의도는 맞아요.
- 실측
  - `FOR SHARE`는 SELECT 정책 밖(P1-c)이든, SELECT로는 보이지만 UPDATE USING 밖(P1-e)이든 **오류 없이 0행**이에요.
  - `PERFORM … FOR SHARE`만 쓰면 잠금 없이 다음 단계로 넘어갈 수 있어요.
- 요구
  - 진입 함수 2개 모두 anchor 잠금 직후 `IF NOT FOUND THEN` 닫힌 실패 태그 또는 예외를 둬요.
  - 잠근 행의 `policy_id`가 정확히 `asset-upload`이고 epoch/digest가 읽은 current와 같은지 확인해요.
  - 객체 ID 잠금(`UPDATE(id)` lock-only)도 같은 규칙을 적용해요. 0행은 "존재하지 않음"이 아니라 "잠금 실패"로 다뤄요.
  - 시험 행렬에 "보이지만 UPDATE USING 밖"(P1-e)과 "UPDATE(id) 회수"(P1-d)를 넣어요.

## 4. 명확화 권고
- **C1 지연 트리거 실행 역할**
  - 계약 2절은 operations/receipts/asset_receipt_state SELECT를 reserver에 주며 "pristine deferred guard reads"를 근거로 들어요.
  - 18.7 실측(P2-a)에서 COMMIT 때 실행된 INVOKER 지연 트리거는 **이벤트를 쌓은 역할(reserver)**로 실행됐어요. 그래서 이 grant 근거는 18.7에서 맞아요.
  - SQL4의 `storage_consistency_guard`도 pristine INSERT에서 storage_objects, asset_receipt_state, storage_verification_operations, storage_verification_receipts를 읽어요(436행 이후).
  - 다른 메이저 버전의 동작은 확인하지 않았어요.
  - 권고 1: 운영 대상 PG 메이저 버전에서 P2-a와 같은 확인을 SQL5 수용 조건으로 넣어요.
  - 권고 2: 또는 버전 무관하게 만들고 싶다면, 진입 함수 끝에서 **정확한 이름의** 관련 지연 constraint만 `SET CONSTRAINTS … IMMEDIATE`로 함수 안에서 발화시켜요(P2-b). 계약의 "ALL 금지"와는 충돌하지 않아요. 이 경우 같은 거래에 쌓인 다른 지연 이벤트를 함께 발화하지 않는지 이름 목록을 고정해 시험해요.
  - 어느 쪽이든 API에 새 직접 grant를 더하지 않는다는 계약 원칙은 유지돼요.
- **C2 래치의 격리 수준 전제**
  - R1~R3은 READ COMMITTED, plpgsql 기본 VOLATILE에서 확인했어요. 계약 4절의 "새 READ COMMITTED 문장" 전제와 같아요.
  - 함수가 다른 격리 수준(REPEATABLE READ 등) 거래에서 호출될 때의 동작은 확인하지 않았어요.
  - 권고: 진입 함수 첫 줄에서 `current_setting('transaction_isolation')='read committed'`를 확인하고, 아니면 닫힌 실패로 끝내요. 함수 VOLATILE도 명시해요.
- **C3 잠금 전용 권한 시험 범위**
  - P1-a/b/d/e로 lock-only 설계가 맞다는 것을 확인했어요.
  - 권고: SQL5 시험에 아래 네 가지를 각각 넣어요.
    1. 잠금 성공
    2. 같은 행 UPDATE 거부(WITH CHECK false)
    3. 범위 밖 0행 → 실패 처리(G2)
    4. UPDATE(col) 회수 시 권한 오류

## 5. 미검증(확정 FAIL 아님)
- B3 `PG_TRANSACTION` unknown COMMIT 분류, 응답 유실 뒤 같은 키 재조정, 풀 재사용 시 역할·GUC 누출
  - 실제 B3 코드와 응답 유실 주입이 필요해서 이번 프로브에서는 하지 않았어요.
- 클라이언트 payload 정규형(`upload-reservation-client:v1`) SQL 문법 검증과 JS 정규형의 일치
  - 문법이 아직 확정되지 않았어요(계약 결정 2번).
- PG 18.7 외 메이저 버전의 지연 트리거 실행 역할(C1)
- 실제 SQL4·SQL5 객체 위에서의 확인
  - 프로브는 같은 구조를 축소한 표·정책으로 했어요(SQL4 원본 적용 안 함).

## 6. 다음 안전 구현 범위 추천
1. Master가 G1·G2를 계약 보완으로 수용한 뒤, SQL5 **오프라인 초안**만 별도 배정해요(실행 없음).
2. 초안 수용 뒤 소유 격리 PG에서 SQL5를 실제 적용해 다음을 실측해요.
   - 위 표 P1~P3, R1~R3을 실제 SQL4+SQL5 객체로 다시 확인
   - 운영 대상 메이저 버전의 C1 확인
3. B3 결과 경계(C4 결정)는 별도 범위로 분리해요.

## 7. 프로브 원본과 정리
- 프로브 SQL은 검토자 scratchpad에만 두었어요. 저장소에는 넣지 않았어요.
- 주요 정의
  - `r.reserve`: SECURITY DEFINER, `SET search_path=pg_catalog,pg_temp`, `SET row_security=on`
  - `d.pol` 정책: `FOR SELECT TO reserver USING (id='a')`, `FOR UPDATE TO reserver USING (id='a') WITH CHECK (false)`
  - 지연 트리거: `CREATE CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`, INVOKER 함수
- 정리: `pg_ctl -m fast stop` → "server stopped", 포트 닫힘 확인, `tmp/b26r-probe` 삭제(남은 폴더 0)
- 새 창·agent·worktree 없음. 비밀값 없음(프로브는 trust 인증 임시 클러스터).
