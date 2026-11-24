# T253 합성 PG17 공개 승인 저장 계약

설계 `c9d5674`, 재검수 `33f6c64`에 따라 시험용 승인 상태 SQL과 로컬 runner를 작성했다. **범위 TypeScript·ESLint 및 runner의 인자 누락 거절은 통과했다. PG17 도구를 찾지 못해 SQL 적용과 DB 검증은 미실행이다.**

## 구현 범위

- `tests/fixtures/postgres/t253-showcase-publication.sql`은 유효한 이름의 폐기용 PG17 DB로 제한한다. 고유 slug 상태 행의 잠금 아래 버전 증가, 준비 세대 예약, 완료 시 활성 세대 교체, 철회 시 활성·준비 세대 동시 무효화를 구현한다. 준비와 완료에서 합성 완료 이미지의 소유 UUID·리비전·SHA를 검사하고 준비 시 기록한 승인 문구·권리 참조·사본 SHA/크기를 완료와 대조한다.
- 요청 원장은 합성 actor와 요청 UUID를 키로 쓰고, 명령·slug·버전·세대·전체 manifest의 정규화된 JSONB를 지문으로 보존한다. 같은 지문은 당시 결과를 돌려준다. 지문 변경은 거부하고 저장 상태는 다시 바꾸지 않는다. 철회 후의 과거 성공 응답은 원장 재생 결과다. 접근 가능 여부는 새 파일 조회에서 결정한다.
- 목록과 파일 역할은 자신에게 허용된 함수만 실행한다. 두 함수는 테이블을 소유하지 않는 서로 다른 NOLOGIN·NOBYPASSRLS 역할에서 실행되고, FORCE RLS 활성 행 정책과 필요한 열만 부여받는다. 목록은 epoch ms와 C collation의 slug 순서로 상위 25개와 기준 ms를 돌려준다. 파일 함수는 slug·세대가 같은 활성 cover의 배포 키·MIME·길이·SHA만 반환한다.
- 쓰기 함수의 actor는 **신뢰된 합성 서버 호출자**가 세션에 주입한다. SQL은 이 UUID의 발행 허용과 소유자 범위를 검사한다. 실제 인증·권리 증빙·Storage 바이트 검증과 애플리케이션 DTO/HTTP 연결은 후속 범위다. 완료 함수에 전달한 manifest는 그 외부 검증이 끝났다는 합성 입력이다. Storage 쓰기와 정리 작업을 실행하지 않는다.

## 검증 상태와 재실행 조건

PATH와 표준 설치 경로를 조사했고, `D:/starwork`의 기존 `postgres.exe` 19개 파일 버전은 모두 18.7이었다. WSL 목록에도 설치된 배포판이 표시되지 않았고 Docker와 Podman CLI도 확인되지 않았다. PG18을 대신 실행하지 않았다. 파일 목록 조사와 로컬 정적 검증만 했다.

서명된 동일 패치 버전의 Windows EnterpriseDB PostgreSQL 17 `postgres.exe`, `initdb.exe`, `pg_ctl.exe`가 있는 절대 `bin` 경로와 실행 가능한 로컬 임시 포트가 필요하다. 경로와 major가 검증된 뒤 runner가 고유 `tmp/t253_<uuid>`와 새 UTF-8/C/SCRAM 클러스터를 만든다. DSN 입력 없이 직접 loopback 연결을 생성하고, SQL 실행 전에 DB·major·데이터 경로·주소·포트의 일치를 확인한다. 종료 시 자기 데이터 경로의 postmaster만 정지한다.

```powershell
node --import tsx tests/t253-showcase-publication-native-owned.ts --bin 'C:\path\to\pg17\bin'
```

위 명령은 후속 실행용이다. runner의 미실행 검증 묶음은 다음과 같다.

| 묶음 | 기대 결과 |
|---|---|
| 스키마 | 빈 DB에서 이관 트랜잭션 롤백 후 역할·스키마 부재, 기존 합성 스키마 옆에 재적용 후 기존 행 보존 |
| 권한 | 목록·파일의 반대 함수와 직접 조회·쓰기 거부, 함수 소유자의 실제 열·RLS 제한, anon 계열 미노출, 발행 허용 및 일치 소유자만 상태 변경 |
| 원장·경쟁 | 지문 재생과 문구·권리·SHA 변경 충돌, 두 연결의 실제 잠금 확인, 철회 선행 시 지연 완료 거부, 완료 선행 시 최신 버전 철회와 이전 요청 재생 후 비공개 유지 |
| 상태·정렬 | 준비/활성/철회 조회, 교체 시 이전 URL 비활성화, 롤백 시 예약과 원장 동시 제거, ms 정밀도와 ASCII 동률 24/25 경계 |

실행한 검증은 runner 파일의 strict `tsc --noEmit`, 파일 단위 ESLint(경고 0개), `--bin` 없는 호출의 종료 코드 1과 안내 문구 확인이다. 네이티브 SQL 구문, GRANT/RLS 실효성, 잠금·롤백의 결과는 PG17에서 첫 실행 후 판정한다. 최초 네이티브 결과가 나오기 전에는 관리형 적용 근거로 사용하지 않는다.

| 파일 | SHA-256 |
|---|---|
| SQL | `0ca4bde5fd5caf02a022d0f012d35770b35cb2864a0ef58c22ce07a737540511` |
| runner | `8035ea055435f6cf63367d928a8d697ff7bd06b07e3b0c174c13c9a31c7372bb` |

Master 전달문 — T253 합성 전용 SQL·로컬 runner·보고 세 경로를 반환한다. TypeScript·ESLint 및 무인자 거절 통과. 소유 PG17 도구를 찾지 못해 SQL과 DB 검증은 미실행이며 PG18 대체 실행도 없다. 독립 소스 검수와 서명된 로컬 PG17 확보 후 runner 첫 실행이 필요하다.
