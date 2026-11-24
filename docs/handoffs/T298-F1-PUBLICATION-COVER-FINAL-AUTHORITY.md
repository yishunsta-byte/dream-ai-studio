# T298-F1 표지 응답 생성 전 공개 권리 확인

기준 `71c1de2` · Backend 자체 검증

표지 공급자에 선택적인 `confirmCover`를 추가했습니다. T298 어댑터는 최종 확인마다 새 PostgreSQL 스냅샷으로 주소의 slug·세대를 조회해 반영 상태와 객체 키·MIME·길이·SHA-256이 최초 조회와 같은지 확인합니다. 서버는 받은 바이트를 복사하고 해시 및 WebP 디코딩까지 마친 뒤 이 확인을 실행합니다. 이후 HTTP 응답을 만들 때까지 추가 비동기 작업이 없습니다. [공개 표지 처리](../../lib/public-showcase/cover-source.ts) · [새 조회 어댑터](../../lib/public-showcase/publication-public-reader.ts)

최종 조회에서 만료·철회·교체나 메타데이터 변경이 확인되면 GET·HEAD 모두 빈 404를 반환합니다. 원본의 이미지 MIME이나 길이는 포함하지 않습니다. 조회 장애, 요청 취소와 마감 초과는 기존 안전한 503으로 처리합니다. 가드를 제공하지 않는 호출도 정상 동작하며 모든 응답에 `no-store`를 유지합니다.

## 검증

- 실제 루프백 PG17에서 GET과 HEAD의 비공개 파일 응답을 각각 보류했습니다. 보류 중 만료·철회·새 세대 게시를 적용한 뒤 정상 WebP를 반환해도 두 응답은 빈 404였습니다. 교체 세대의 정상 요청은 200이었습니다. 최종 DB 확인에 실제 잠금을 걸어 취소와 마감 초과 시 이미지 바이트를 반환하지 않고, 잠금 해제 후 정상 재조회되는 것도 검증했습니다. 시험 리스너와 임시 클러스터를 정리했습니다. [네이티브 시험](../../tests/public-showcase/publication-public-reader.native.ts)
- 집중 시험은 검증 실패 시 가드 미호출, 응답 복사본 보존, 동일 메타데이터 확인과 오류·취소의 노출 방지를 확인했습니다. 공개·관리자 큐·REA 회귀 **32개 파일 375건 통과, 1건 건너뜀**. 범위 TypeScript와 ESLint `--max-warnings 0` 통과. [표지 시험](../../tests/public-showcase/cover-route.test.ts) · [어댑터 시험](../../tests/public-showcase/publication-public-reader.test.ts)

## 연결 범위

검증한 경계는 새 응답 생성 전의 최종 DB 조회입니다. 이미 시작한 응답과 CDN·브라우저에 남은 응답, 마지막 DB 조회가 끝난 직후의 권리 변경은 운영 전송 경로에서 별도로 확인해야 합니다. 운영 DB·라우트·배포에는 변경 사항이 없습니다.
