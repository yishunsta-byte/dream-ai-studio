# T327-R 관리자 게시·공개 공급원 런타임 독립 검수

기준 `fa52ca4` · Master 인계 `msg_6c4cb53798d8` · Codex(Tester)

**판정은 고정 소스와 단위·회귀 검증 통과.** 관리자 화면과 API는 `createAdminPublicationHttp`에서 공용 런타임의 관리자 저장소를 조회한다. 공개 홈과 표지 GET·HEAD는 동일 모듈의 공개 리더를 조회한다. 런타임은 Node 프로세스의 `globalThis`에 등록한 `Symbol.for` 키로 구성과 T325 초기화 결과를 공유한다. 프로세스 간 공유는 이 구조의 범위 밖이다. [공용 런타임](../../lib/public-showcase/publication-runtime.ts) · [관리자 HTTP](../../lib/public-showcase/admin-publication-http.ts)

| 검토 항목 | 독립 확인 결과 |
| --- | --- |
| 기본 구성과 실패 | 기본 구성 로더는 `undefined`다. 관리자 목록은 `closed`, 쓰기는 503 `PUBLICATION_UNLINKED`, 홈은 예시, 표지는 404 `no-store`로 닫힌다. 로더 오류 및 관리자 핸들을 얻은 뒤 공개 초기화가 실패하는 경우도 같은 결과를 고정했고, 획득한 관리자 핸들을 종료했다. 대상이 불일치할 때 세 공급원을 함께 닫는 T325 회귀도 통과했다. |
| 동시 초기화와 요청 경계 | 세 호출은 같은 초기화 결과를 기다렸다. 옵션 로더와 관리자·공개 초기화가 각각 한 번이었다. 관리자 쓰기는 인증·출처·형식 판정 뒤 저장소를 조회하고, 잘못된 출처는 저장소 초기화 없이 403이었다. 요청 헤더와 쿼리는 구성 로더의 입력이 아니다. |
| 종료와 재진입 | 시작 전 종료하면 후속 요청이 초기화를 열지 않는다. 초기화 도중 종료하면 새 조회와 기존 대기 조회에 비활성 결과를 반환하고, 뒤늦게 획득한 관리자·공개 핸들을 한 번씩 닫는다. 완료된 런타임에서도 종료 호출은 같은 작업을 기다렸고 재초기화하지 않았다. |

고정 임시 사본에서 런타임·조립 13/13, 관리자·공개·공용 인증·기존 홈 및 게이트 회귀 21개 파일 557/557, Next 생성물 없이 `tsc --noEmit --incremental false`, 변경 파일 ESLint와 `git diff --check`를 통과했다. [단위 시험](../../tests/public-showcase/publication-runtime.test.ts) · [T325 회귀](../../tests/public-showcase/publication-provider-assembly.test.ts)

Main PC의 격리 production 인계는 미구성·부분 초기화 실패·정상 구성, 첫 관리자·홈·표지 동시 요청의 설정 조회 1회, 관리자 게시·철회 후 공개 목록과 GET/HEAD, 명시 종료 이후 닫힘과 핸들별 종료 1회를 보고한다. 고정된 HTTP 진행기와 합성 IPC 구성의 확인 항목과 일치한다. Tester는 해당 production 서버를 재실행하거나 빌드하지 않았고, 다른 담당자의 남은 임시 사본은 건드리지 않았다. [Main PC 인계](T327-ADMIN-PUBLICATION-RUNTIME-WIRING.md) · [HTTP 진행기](../../tests/public-showcase/t327-publication-runtime-next.mjs)

호스트 종료에 함수 호출을 연결하고 기존 요청을 배출하는 동작, 운영 DB 승인 대상·제한 자격·TLS 및 비공개 Storage의 실제 연결은 후속 범위다. Tester 임시 사본을 정리했고 운영·배포를 변경하지 않았다.
