# 로컬 PG 자막 부분 수정 후 재승인·재출력

제품 기준 `e30db53d9fd6a4e16b8322844f9a37e5a7342031`. 격리 Next 개발 서버와 PG 17.12에서 새 쇼핑 숏폼 프로젝트를 만들고 승인 r6으로 MP4·SRT·VTT·ZIP을 받았다. 같은 프로젝트에서 `POST /api/projects/{id}/timeline/subtitles`로 자막 첫 줄의 `가나다`를 `수정`으로 바꿔 r7을 저장했다. 영상·음원·권리 데이터와 자막 두 번째 줄·타이밍은 같았다.

## 승인 전 차단과 새 출력

- r7 저장 직후 이전 MP4·SRT·VTT·ZIP은 409 `CURRENT_TIMELINE_CONFLICT`를 반환했다. 승인 전 r7 렌더 접수와 SRT·VTT 다운로드는 409 `REVIEW_APPROVAL_REQUIRED`, ZIP 생성은 409 `EXPORT_REVIEW_REQUIRED`였다. 작업·내보내기·파일 개수에 변화가 없었다.
- 편집 완료, 필수 검수 항목 통과, 검수 승인 순으로 r7을 승인했다. 새 렌더 작업과 내보내기 ID가 생겼다. 다운로드 네 경로는 각각 200이었다. r6 URL은 재승인 뒤에도 모두 409로 차단됐다.
- r7의 타임라인 ID는 `01a1f4db-d255-7191-a144-d9f014a55784`다. 렌더 작업 스냅샷, ZIP 생성 요청, ZIP에 든 타임라인 원문은 같은 리비전·타임라인과 SHA-256 `704a687c5f3a9907954971237a8f5e4c0234c6a737f3aa83f482b47013fccf01`에 연결됐다. MP4 작업은 리비전별 1개, ZIP도 리비전별 1개였다.

| r7 출력 | 바이트 | SHA-256 |
| --- | ---: | --- |
| MP4 | 70,310 | `8db71e21b585450fc5f43b855ca721e0b8abc36555fd4475c7a39f0180851c08` |
| SRT | 79 | `d6b3355019677400928fefaefb3ea7bac88c6db67268681725f58bc2e6f5d1ff` |
| VTT | 122 | `4f7e174e0814b5e0aa61c2fa57efe441ec377032bd6cc45f1f62378d5484e5ba` |
| ZIP | 2,088,390 | `8a647742e2c10d4e17c0c94fd538cd07da30e8cc225be7ad5b8e5d28cce2edab` |

## 영상·음원 재사용 확인

- SRT/VTT는 두 줄 중 수정된 첫 줄을 반영했다. VTT 큐는 `00:00:00.500`에서 `00:00:02.333`까지였다. ZIP 속 SRT/VTT와 개별 다운로드가 같았다. ZIP 속 PNG 2개·WAV·권리 메모는 r6과 바이트 단위로 같았다.
- 두 MP4는 1080×1920, 30fps, 90프레임, AAC였다. 0부터 센 프레임 29·30·89의 샘플 RGB가 일치했다. 프레임 45에서 회색조 밝기가 48보다 많이 달라진 픽셀은 수정한 첫 줄 영역 10,424개, 두 번째 줄과 광고 표기 영역 각각 0개였다.
- 48kHz 단일 채널로 디코딩한 오디오 144,000개 샘플이 바이트 단위로 같았다. SHA-256 `53d624916217aafc7f75c8c7d46d2ec250b7e2f631a1946c3013f5643582b349`.
- 승인 기획과 장면 버전·원본 자료 ID·SHA가 유지됐다. 시험 소유자의 자료 4개와 해당 프로젝트의 장면 버전 2개가 그대로였고 생성 이력은 전후 0건이었다.

## 재현 및 범위

`D:/starwork/p2-first-work-all-outputs`의 시험 전용 `tests/postgres/first-work-reapproval.probe.mjs`와 기존 격리 실행기를 사용했다. 결과는 `subtitle-reapproval.log`에 있다. 종료 코드 0과 PG 프로세스·리스너·임시 클러스터 정리를 확인했다. API·파일을 제품 동작으로 확인한 로컬 합성 시험이며 운영 Storage와 실기기 재생은 별도 검증 범위다.

```powershell
$env:T371_VERIFY_HTTP = '1'
$env:T371_VERIFY_RENDER_AUDIO = '1'
$env:T371_VERIFY_FIRST_WORK_MODE = 'two'
$env:T371_VERIFY_FIRST_WORK_CAPTIONS = '1'
$env:T371_VERIFY_EXPORT_API = '1'
$env:T371_VERIFY_ALL_OUTPUTS = '1'
$env:T371_VERIFY_SUBTITLE_REAPPROVAL = '1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```

> 자막 첫 줄만 수정하고 r7을 재승인해 새 MP4·SRT·VTT·ZIP을 받았습니다. 이전 URL은 계속 차단됐습니다. PNG 두 장과 WAV, 권리 메모, 장면 전환 샘플, 디코딩한 144,000개 오디오 샘플이 유지됐고 새 장면 생성은 0건이었습니다.
