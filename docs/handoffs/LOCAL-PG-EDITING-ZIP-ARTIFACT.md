# 로컬 PG 재편집 ZIP 생성과 재검증

`52d1d2c` 조사를 이어, 내부 함수 `useLocalPgEditingBundle`에서 현재 승인본을 읽고 실제 임시 ZIP을 만든다. 호출자는 재검증된 아카이브가 열려 있는 동안 파일·매니페스트·SHA-256·크기를 받는다. 작업 종료 뒤에는 임시 폴더가 정리된다. 영구 보관과 제품 다운로드는 후속 단위다.

## 변경 경로

- `lib/db/postgres/private-wav-upload/editing-bundle.sql` 소유자 RLS가 적용된 로컬 PG17 읽기 역할.
- `lib/export/local-pg-editing-input.ts` 현재 기획·제작·편집·검수 승인, 내용 리비전과 정규 타임라인 SHA, 선택 PNG 검증 영수증, 소유 WAV, 권리 메모의 조회.
- `lib/export/local-pg-editing-bundle.ts` 기존 v1/v2 매니페스트, 스트리밍 ZIP, 파일별 검증, 현재 승인과 원본 재확인, 임시 파일 정리.

선택한 PNG를 타임라인 순서로 넣고 WAV 원본은 자산별 한 번 넣는다. 원래 타임라인 JSON 바이트와 저장 리비전, 자막의 SRT/VTT, 편집 글자·폰트와 OFL, 기획·검수 및 권리 기록을 담는다. 권리 문서는 장면 등록 당시와 현재 원본 메모를 모두 표시한다. ZIP 검증과 해시 계산 후 원본 바이트와 승인 상태를 다시 확인하고 호출자에게 넘긴다.

## 실제 검증

`D:/starwork/p2-pg-first-work-e2e`의 `63c8ed9` 격리 사본에 변경 세 파일을 반영했다. 합성 인증과 스토리지, Next 개발 Turbopack 및 PG17.12를 사용했다. `T371_VERIFY_HTTP=1`, `T371_VERIFY_FIRST_WORK_ONLY=1`, `T371_VERIFY_FIRST_WORK_MODE=two`, `T371_VERIFY_FIRST_WORK_CAPTIONS=1`, `T371_VERIFY_EDITING_BUNDLE=1`에서 `node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs`를 실행했다. 시험 연결은 같은 사본의 `tests/postgres/editing-bundle-artifact.probe.mjs`에 있다.

- 한 프로젝트에 서로 다른 PNG 두 장을 제품 API로 등록·선택했다. WAV 없는 승인 r4의 v1 ZIP은 13개 항목·2,072,926바이트였다. WAV와 한글 두 줄을 저장하고 재승인한 r6의 v2 ZIP은 17개 항목·2,088,402바이트였다.
- ZIP을 다시 열어 항목 순서, 모든 SHA와 크기, 타임라인 원문과 ID, PNG와 WAV 원본 바이트, 한글 줄바꿈 및 SRT/VTT 프레임 시각, 권리 메모·검수·OFL을 대조했다. v2 ZIP SHA-256은 `5cb13f48006c7c8235633f6bf379da5b2b5764093688250e9304fbc34d738d6b`였다.
- 타 계정과 이전 리비전, 보관 처리된 WAV, 변경된 WAV와 변조된 스토리지 PNG를 거절했다. 별도 ZIP 복사본의 바이트를 바꾸자 재검증에 실패했다. PNG 조회 중 새 타임라인을 저장한 경우에도 아카이브를 넘기지 않았다.
- 정상 생성 전후 내보내기·활동 데이터가 같았다. 콜백 반환 뒤 파일을 읽을 수 없었고, 시험 역할과 PG 리스너·임시 클러스터까지 정리됐다. 최종 실행 종료 0.
- `npm.cmd run typecheck`, 변경 모듈 ESLint, 기존 ZIP·매니페스트·복원 관련 Vitest 7파일·92건을 통과했다.

아카이브 보관 단계는 이 파일을 소유자 키로 확정하기 직전에 현재 승인·원본을 트랜잭션에서 다시 대조해야 한다. 시험에서 복원 범위는 ZIP 재개봉과 원본 바이트 대조였다. 영속 PG 내보내기 행과 ZIP을 함께 복원하는 검증은 보관 구현 이후에 이어간다.

> 현재 승인된 PG 프로젝트에서 재편집 ZIP v1과 WAV가 포함된 v2를 생성했습니다. 실제 ZIP을 열어 PNG 순서·원본 SHA·권리와 한글 자막을 대조했고, 타 계정·구버전·누락·변조 및 생성 중 새 저장을 거절했습니다. 보관·다운로드가 이어서 사용할 임시 아카이브 인터페이스를 인계합니다.
