# B26-R2 좁은 계약 재대조(G1/G2·C1~C3)

- 검토자: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_bb174abfd54c`
- 대상
  - `docs/handoffs/B26-UPLOAD-RESERVATION-TRANSACTION-CONTRACT.md` @ `1858550ee9ed12ee049f06a35db64c5a627340b0`
  - LF SHA256 `c6fd2820fe1fd25bb57bc60b62910d5b9db07a4fe5cebefb09d86b1f79178fbe`(직접 계산해 일치 확인)
- 기준: 원 검토 B26-R `3f0a44a`. `git diff 8d53575 1858550` 중 B26 계약 파일 변경분만 대조했어요(+63/−18행 범위).
- 추가 확인
  - 제 소유 임시 PostgreSQL **18.7** 클러스터에서 2개 항목만 프로브했어요(P4, P5).
  - 명령 기록은 검토자 scratchpad의 `b26r2-p4-commands.log`, `p5s1.sql`에 보존했어요(저장소에는 넣지 않음).
  - 정지(`server stopped`)·포트 닫힘 확인 후 `tmp/b26r2-probe`를 삭제했어요(남은 폴더 0).
- 바꾸지 않은 것: 원 보고·제품·SQL·역할·grant·실DB·runtime·Auth·package

## 1. 판정
| 항목 | 계약 보완 | 판정 |
|---|---|---|
| G2 | 두 함수 모두 anchor FOUND·정확히 1행·`asset-upload`·epoch/digest·현재 tuple 확인. 기대 기존 객체 0행은 실패. 새 ID는 별도 경로(unique INSERT)로 구분 | **수용 가능**. 원 지적과 정확히 맞아요. "현재 tuple 확인이 과거 replay의 원래 tuple 일치를 요구하지 않는다"는 구분도 맞아요 |
| C2 | 두 함수 VOLATILE 명시 + `transaction_isolation='read committed'` 확인, 아니면 잠금·쓰기 전에 실패 | **수용 가능** |
| C3 | 잠금 양성·변경 음성·0행 음성(보이지만 UPDATE USING 밖 포함)·권한 음성 4행 | **수용 가능** |
| C1 | 축소 픽스처 관찰로만 표기. 전체 SQL4+5와 실제 배포 메이저 버전에서 큐 시점·발화 시점 역할 기록을 수용 게이트로. 이름 지정 IMMEDIATE는 대안일 뿐 | **수용 가능**. 원 보고 범위를 과장하지 않았어요 |
| G1 | 일시 SET 멤버십+스키마 CREATE → 정확히 2개 OWNER 이전 → 회수 → 최종 inventory, 실패 시 전체 rollback | **조건부**. 아래 G1-a는 **필수 계약 gap**(현재 문구로는 비superuser에서 달성 불가), G1-b는 단순화 권고 |

## 2. 새 실측(PG 18.7, 축소 픽스처)

| # | 확인 | 결과 |
|---|---|---|
| P4-a | 비superuser `CREATEROLE` 역할 `mig`가 `CREATE ROLE reserver NOLOGIN …` | `pg_auth_members`에 **자동 간선 1개**: `mig admin=true inherit=false set=false grantor=probe_admin`(부트스트랩 superuser) |
| P4-b | `mig`가 `GRANT reserver TO mig WITH INHERIT FALSE, SET TRUE` | 간선 2개: 위 자동 ADMIN + `mig set=true grantor=mig` |
| P4-c | `mig`가 `REVOKE reserver FROM mig` | 자기가 준 SET 간선만 사라지고 자동 ADMIN 간선 1개가 남아요 |
| P4-d | `mig`가 `REVOKE reserver FROM mig GRANTED BY probe_admin` 및 `REVOKE ADMIN OPTION FOR … GRANTED BY probe_admin` | 둘 다 **거부**: "probe_admin 롤이 부여한 권한을 회수할 수 있는 권한 없음" |
| P4-e | ADMIN만 남은 `mig`의 `SET ROLE reserver` | **거부**("set role reserver 작업 권한 없음") |
| P4-f | ADMIN만 남은 `mig`가 스스로 `GRANT reserver TO mig WITH SET TRUE` → `SET ROLE` | **성공**("reacquired as reserver"). ADMIN은 언제든 SET 경로를 **다시 만들 수 있는 잠재 경로**예요 |
| P4-g | superuser가 자동 ADMIN 간선 회수 | 간선 0개. 그 뒤 `mig`는 reserver 멤버십 부여도, `DROP ROLE`도 **거부**돼요(관리 불가) |
| P5-a | 한 거래 안에서 함수 생성(생성 직후 `proacl NULL`, 기본값으로 PUBLIC EXECUTE) 후 4초 대기. 그동안 다른 세션 api가 호출 | **"r.entry() 이름의 함수가 없음"**. COMMIT 전에는 다른 세션에 보이지 않아요 |
| P5-b | 같은 거래에서 `REVOKE ALL … FROM PUBLIC` 후 COMMIT. api(부여 없음) 호출 | "entry 함수 접근 권한 없음". 커밋된 상태에서 공개 진입점이 한 번도 존재하지 않았어요 |

## 3. 필수 계약 gap

### G1-a 생성 역할의 자동 ADMIN 간선은 그 역할이 회수할 수 없어요
- 계약 G1 4단계: "Revoke … the entire temporary membership, **including any automatic creator/admin membership edges** … Do not leave ADMIN OPTION…"
- 계약 G1 5단계: "no migration/API/worker/login SET or membership path"
- 실측
  - PG 18.7에서 비superuser `CREATEROLE` 역할이 reserver를 만들면 ADMIN 간선이 자동으로 생겨요(P4-a). 부여자는 부트스트랩 superuser예요.
  - 만든 역할은 이 간선을 회수할 수 없어요(P4-d).
  - 이 간선만으로는 SET ROLE이 안 되지만(P4-e), 스스로 SET을 다시 줄 수 있어요(P4-f).
  - superuser가 이 간선을 지우면 그 뒤 마이그레이션 역할은 reserver를 관리·삭제하지 못해요(P4-g).
- 결과: 비superuser 마이그레이션만으로는 "최종 상태에 ADMIN·membership 간선 0"을 **달성할 수 없어요.** 현재 문구대로 inventory를 단언하면 SQL5가 항상 실패해요. 반대로 superuser가 지우면 이후 정책 관리 경로가 끊겨요.
- 계약이 정해야 할 선택지(하나를 Master가 고름)
  1. **생성자 ADMIN 간선 1개만 허용 예외로 명시**
     - 대상: 마이그레이션 소유자. 조건: `admin=true, inherit=false, set=false`, grantor는 부트스트랩
     - inventory는 "그 정확한 1개 + SET·INHERIT 간선 0"으로 단언해요.
     - 이 간선은 마이그레이션 credential에만 남는 재획득 경로라는 점을 위협 모델에 적어요. 런타임 풀과 credential은 분리해요.
  2. **역할 생성을 별도 provisioning 단계로 분리**
     - superuser 또는 관리형 제공 역할이 만들고, 마이그레이션 소유자에게 필요한 일시 권한만 줘요.
     - 그 뒤 superuser가 간선을 제거해요.
     - 이후 역할 관리(정책 변경·삭제)는 같은 provisioning 경로가 필요해요.
  3. 관리형 PG에 `createrole_self_grant` 등 다른 설정이 있다면 실제 값을 확인하고 그 결과로 문구를 정해요. 이 항목은 **미검증**이에요.
- 어느 쪽이든 API·worker·런타임 login에는 어떤 간선도 없어야 한다는 원칙은 그대로 유지돼요.

## 4. 권고(필수 아님)

### G1-b 전역 기본 권한 임시 변경 단계는 필수가 아니고 위험을 더해요
- 계약 G1 1단계는 다음을 요구해요.
  - 마이그레이션 역할의 **전역** 함수 기본 권한에서 PUBLIC EXECUTE를 회수해요.
  - 함수를 만들어요.
  - 같은 거래 안에서 기본 권한을 정확히 원래 상태로 되돌려요.
- 근거 대조
  - 공식 문서상 스키마 단위 REVOKE로는 전역 기본 PUBLIC EXECUTE를 지울 수 없다는 설명은 맞아요(PostgreSQL 18 ALTER DEFAULT PRIVILEGES: 스키마 기본 권한은 전역 기본에 **더해질** 뿐이에요). 읽기 검토만 했어요.
  - 하지만 함수는 COMMIT 전에는 다른 세션에 보이지 않아요(P5-a). 같은 거래 안에서 명시적 `REVOKE ALL … FROM PUBLIC, dream_api, dream_worker` + 최종 ACL inventory만으로도 "커밋된 공개 진입점 없음"이 성립해요(P5-b).
- 권고
  - 기본 권한 임시 변경은 **선택 강화**로 낮춰요.
  - 필수 조건은 "단일 거래, 생성 직후 명시 REVOKE, COMMIT 전 실제 ACL 단언"으로 둬요.
  - 기본 권한을 건드리지 않으면 "정확한 원상 복구" 실패 위험과 다른 객체에 미치는 영향이 없어져요.
  - 이 권고는 전제가 있어요. 마이그레이션 실행기가 문장마다 COMMIT하는 방식이면 이 근거가 깨지므로, 계약의 "one migration transaction" 요구를 그대로 필수로 유지해요.

### G1-c 순서 보충
- 이전 전에 `mig`가 api에 준 EXECUTE는 소유자 이전 때 부여자가 새 소유자로 바뀌어요.
- 이 동작은 이번에 따로 실측하지 않았어요. inventory는 부여자까지 포함해 최종 ACL 문자열로 단언하는 것을 권해요.

## 5. 남은 구현 native 게이트(계약 수용과 별개)
- 전체 SQL4+5 객체에서 P1~P5, R1~R3을 다시 확인해요. 축소 픽스처 결과로 대체할 수 없어요.
- 실제 배포 메이저 버전에서 C1(큐 시점·발화 시점 역할)과 G1-a(자동 ADMIN 간선·`createrole_self_grant`)를 확인해요.
- G1 단계별 실패 주입 → 전체 rollback(부분 역할·간선·ACL 없음)을 확인해요.
- 그대로 미검증으로 남은 항목
  - B3 unknown COMMIT·풀 위생
  - 클라이언트 정규형 문법
  - 다른 메이저 버전

## 6. 다음 최소 단계 권고
1. Backend가 G1-a 선택지(1 또는 2)와 G1-b 단순화 여부를 계약에 반영해요(문서 1개). 반영되면 이 재대조는 그 몇 줄만 다시 보면 돼요.
2. 그 뒤 **SQL5 오프라인 초안만** 배정해요.
   - 초안에는 DDL·ACL·소유자 이전 순서, 두 VOLATILE 진입 가드, inventory 단언 SQL을 담아요.
   - 실행·관리형 적용은 하지 않아요.
3. 초안 검토 뒤 소유 격리 PG에서 전체 SQL4+5 회귀를 하고, 실제 대상 메이저 버전에서도 확인해요.

## 7. 검증 범위
- 문서 대조: `git diff 8d53575 1858550 -- B26 계약` 전 변경 줄
- 실측: P4-a~g, P5-a/b(PG 18.7, 축소 픽스처, 소유 temp)
- 그 밖의 계약 문단은 이번 범위가 아니라서 다시 보지 않았어요.
- 새 창·agent·worktree 없음. T236 서비스·Tester 브라우저에 간섭하지 않았어요. 비밀값 없음.
