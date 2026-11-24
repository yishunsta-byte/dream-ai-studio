# 로컬 PG 재편집 ZIP 백업·복원 검증

제품 기준 `e30db53d9fd6a4e16b8322844f9a37e5a7342031`. 격리 Next 개발 서버와 PG 17.12에서 새 쇼핑 숏폼 프로젝트를 만들고 PNG 두 장, WAV, 한글 자막이 있는 리비전 6을 승인했다. 제품 내보내기 API가 생성한 ZIP을 백업에 포함하고, 별도로 초기화한 PG 17.12 클러스터의 빈 DB에서 복원했다.

## 백업·복원 절차

1. 합성 원본 DB에서 소유자의 내보내기 POST가 201을 반환했다. 내보내기·검수 조회와 다운로드를 확인하고 최신 타임라인·기획 승인·내보내기 메타데이터·요청 키·성공 활동·ZIP 바이트를 대조했다.
2. 원본에서 `pg_dump --format=custom`으로 일관된 DB 덤프를 만들었다. `pg_dumpall --roles-only --no-role-passwords`로 역할 정의와 멤버십을 내보냈다. 대상 클러스터의 초기 관리자 역할은 재사용하고, 내보내기·검수 조회용 로그인 두 개에는 대상 전용 시험 암호를 설정했다.
3. 별도 포트에서 새 클러스터를 초기화하고 `template0`에서 빈 `dream_test_t367`을 만들었다. `dream`과 `local_editing_bundle` 스키마가 비어 있음을 확인한 뒤 `pg_restore --single-transaction --exit-on-error`로 복원했다.
4. 대상 포트만 가리키고 원본 Storage 연결이 없는 Next 서버에서 실제 제품 GET API를 호출했다. 복원 데이터베이스와 원본의 내보내기·승인 관련 행을 다운로드 후 다시 대조했다.

## 결과

| 확인 항목 | 복원 결과 |
| --- | --- |
| 승인과 타임라인 | 리비전 6, 타임라인 `01a1f4d7-1dfc-7014-91e0-97c3c3556176`, 편집·검수·내보내기 단계 승인 유지. 타임라인 원문 SHA-256 `f11c5e3dce9a09ac1aa5215f721f641e5ac5329a58fc7f3c6212a59a2d8eb57b` |
| 내보내기 | ID `01a1f4d7-2af2-72ca-8dcf-a152da9b876d`, 성공 상태와 매니페스트 v2, 요청 키 및 성공 활동 각 1건 유지 |
| 소유자 조회·다운로드 | 목록·검수·ZIP 각각 200. 같은 파일명, `application/zip`, 첨부 및 `private, no-store` 헤더. ZIP 2,088,402바이트, SHA-256 `29d7687f5500f3a585cb203c68ea20463dea1280629597318e6f7814c64e2bfd` |
| ZIP 내용 | 17개 항목 전체 바이트 일치. 매니페스트에 등록된 PNG·WAV·자막 등 파일별 크기와 SHA-256 재검증. `provenance/rights.md` SHA-256 `d1d6c9cc44a908ff693936cb9bc2fde1ad2f3b9b84bf64163f96fae35aa18d2f` |
| 접근 범위 | 다른 계정의 목록·다운로드는 404와 `PROJECT_MISSING`, 비로그인은 401. 타 계정에 파일 첨부 없음 |
| 원본 보존 | 복원 및 다운로드 후 원본의 타임라인·승인·내보내기 기록·활동·ZIP 바이트가 이전과 같음 |

DB 덤프 크기는 2,827,826바이트였다. ZIP 다운로드는 복원된 DB의 기존 바이트로 완료됐다. 시험 종료 코드는 0이며 양쪽 PG를 종료하고 임시 클러스터와 덤프를 정리했다. 원본 Storage를 포함하는 프로젝트 전체 복구, 운영 권한·스케줄링, 제품 백업 UI는 추가 검증 범위다.

## 재현 경로

`D:/starwork/p2-first-work-all-outputs`의 `tests/postgres/editing-bundle-backup.probe.mjs`와 격리 시험 부트스트랩을 사용했다. 실행 결과는 `editing-bundle-backup.log`에 있다.

```powershell
$env:T371_VERIFY_HTTP = '1'
$env:T371_VERIFY_RENDER_AUDIO = '1'
$env:T371_VERIFY_FIRST_WORK_MODE = 'two'
$env:T371_VERIFY_FIRST_WORK_CAPTIONS = '1'
$env:T371_VERIFY_EXPORT_API = '1'
$env:T371_VERIFY_EXPORT_BACKUP = '1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```

> 승인된 로컬 PG 재편집 ZIP을 별도 빈 PG 클러스터에 복원했습니다. 소유자는 같은 승인 r6과 내보내기 ID로 같은 SHA의 파일을 받았고, ZIP 17개 항목과 권리 메모가 보존됐습니다. 타 계정은 404, 비로그인은 401이었으며 원본 DB의 기록과 바이트가 유지됐습니다.
