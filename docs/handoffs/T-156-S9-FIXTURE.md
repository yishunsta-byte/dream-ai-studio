# T156 stage9 오디오 고정 백업 s9 후보

- **구현 반환 / 자체 검증 완료 / Master 통합·독립 수용 전.** 이번 작업은 검수가 아니며 이 작성본을 독립검수 PASS라고 부르지 않는다.
- 생성 기준: Master 당시 HEAD **`927abc8e7b5ab5350ff4dc17e9d1de86a7df9af1`**, 발행1~9단계. 검수 worktree HEAD는 `e1345bc`여서 실행은 고정 archive 안전 사본에서 했다.
- 이후 Master의 현재10단계 알림을 수신했다. **생성 앱을 바꾸지 않았고**, 현재 앱 **`2c79ee999f65416150424fe663e793bc6706c338`**은 별도 사본에서 9→10 복원만 검증했다.
- 허용 신규6파일만 반환: `tests/fixtures/backups/s9-build.ts`, `s9-compare.ts`, `s9.json`, `s9.zip`, `tests/s9-fixture.test.ts`, 이 문서. 제품/발행 migration1~9/기존 fixture/공유 문서 변경 없음. s8 fixture 생성 없음.

## 고정 후보 식별

| 항목 | 실제 값 |
|---|---|
| s9 ZIP SHA256 | **`50e850aec0c2c8a3137c4280943e3de295d32e6bad9b998f0e02cf20af41ca95`** |
| ZIP bytes | **1,304,161** |
| backupId | `01a1e8a4-0000-7000-8000-000000000011` |
| 원형 journal | **1~9**, 마지막 `0009_render_audio.sql`; manifest는 backup schemaVersion1 |
| 원형 내용 | main 프로젝트 timeline3행(r1/r2/r3), 실제 성공 render2행(A/B), 합성 audio원본2개, storage inventory11파일 + DB/manifest |
| 실제 A / v1 | render `01a1e8a4-0000-7000-8000-000000000003`, timeline `01a1e8a4-0000-7000-8000-000000000001` |
| 실제 B / v2 | render `01a1e8a4-0000-7000-8000-00000000000d`, timeline `01a1e8a4-0000-7000-8000-00000000000b` |
| A MP4 | SHA `14cb78c5eb90d4708214b8e058039ab9535cacdaccfe6520c4a0e7863c6e3edf`, 12,751 bytes |
| B MP4 | SHA `8ac6ab8486d2fbef9ae9527e41b39f416f3a1442aeb0f4d52a1081e2e68bfcab`, 112,914 bytes |
| B 실제 최종 수치 | **-14.0 LUFS / -11.5 dBTP**, normalized/accepted=true, AAC-LC·48kHz·2ch, 192,000 decoded samples, initialPadding1024 |
| A/B 영상 packet SHA | `b276e947227777334aa1ba07fbba64f33b31f86550c87c07db392826ee4dcdbc` |

원본 s5 ZIP을 읽어 발행1~9로 올린 새 가짜 DB에서 생성했다. 장면2개×2초, 실제 Remotion child→FFmpeg 경로로 먼저 v1 무음 A를 만들었다. 다음 v2에 voice/music을 넣어 실제 AAC B를 만들고 앞 v1/A가 변하지 않았음을 확인했다. 원래 s5의 r1도 그대로 남는다. A/B 모두 샘플 영상이고 최종 배포 승인·청취 품질 승인이 아니다.

voice는 880Hz sine 4초, music은 pink noise seed156 4초를 자체 생성했다. voice/music 역할·gain(-4/-8)·3frame fade·music duck과 곡별 rights를 담는다. 원본 `rights_note`와 timeline `licenseNote`에 자체 합성/외부 음원·실제 사람 음성 없음/fixture 전용을 명시했다. 표시상의 voice 역할은 실제 사람의 녹음이 아니다. 사용자 DB/실제 개인정보/외부 음원/3013 서버를 쓰지 않았다.

## 생성·보존 계약

- `s9-build`는 실제 서비스 request→jobs claim→`runClaimedRender`를 A/B 모두 실행한다. 성공 행을 stand-in MP4로 조립하지 않는다.
- 실제 `backupService.request`→claim→`runClaimedBackup`가 만든 ZIP을 보관 후보로 삼았다. 백업 순간 자기 backup job은 실행 중이라, 복원본에서는 `RESTORE_INTERRUPTED`로 중단되는 것이 정상이다. 끝난 A/B/input/verify와 source/MP4는 그대로다.
- `S9_WRITE=1`만 최초 생성이며 **ZIP 또는 기록이 이미 있으면 거절**, `wx`로 새 파일만 만든다. 기본 시험은 native 재생성을 하지 않는다.
- UUID만 생성 시 고정한다. 부모/child 시계·deadline·타이머는 실제 시각을 사용한다. 초기 실험의 Date 고정 방식은 최종 생성에 사용하지 않았다.
- native 생성은 OS-temp 고정 사본·새 빈 runtime·명시 DREAM_DATA_ROOT·실제 물리 FFmpeg/ffprobe/브라우저 사본을 요구한다. 현재 앱이10단계면 native 생성을 거부하여 stage9 기준을 몰래 바꾸지 않는다.
- 고정 ZIP의 전체 SHA/size, manifest inventory, DB journal/schema, timeline/input/verify 문자열과 모든 복원 파일 SHA는 엄격 비교한다. 현재 앱 복원은 원형9 확인과 구분하여 upgrade9→10을 확인한다. 8단계 구앱은 BACKUP_TOO_NEW로 거절한다.
- s4~s7 생성/비교 지침을 읽고 H1(보관 파일)과 재생성 논리를 구분했다. 발행 migration1~7은 s7 기록과 같고 8/9도 현재 고정 생성 원형의 이름·해시에 묶인다. 기존 ZIP의 before/after 해시와 기존 fixture 회귀가 통과했다.

`P_S9_REGEN`은 원형 DB의 lifecycle 시각을 비교할 때만 유효 ISO 시각 text를 표식으로 바꾸며 NULL/SQLite 타입 차이는 남긴다. 새 job 시작시각 setting과 자기 백업 절대경로만 환경별 차이로 취급한다. 사용자·timeline/input/verify JSON은 이 profile에서 정규화하지 않는다. 보관 NULL 상태 변화를 숨기지 않는 반례 시험이 있다. **이 논리 profile은 고정 ZIP/복원 파일의 전체 해시 검사를 대체하지 않는다.**

## native 새실행의 비결정성 및 Master 결정

엄격한 fresh-byte 비교 중 실제 B 결과가 두 형태로 나왔다:

| 관찰 | 후보 원본 | 다른 실제 실행 |
|---|---|---|
| MP4 SHA | `8ac6ab8486d2fbef9ae9527e41b39f416f3a1442aeb0f4d52a1081e2e68bfcab` | `2a20bc48d8379b5c75c269979b9e34ad725f1ad08675aa083d35c73de640939d` |
| MP4 bytes | 112,914 | 112,610 |
| PCM mix SHA | `cc7fe6f2bf32dc1bcb205202642c76346c630e798427b05e53cd0428f432f75d` | `4f24547a3b3a4624285730e2a6e3d7168e4dbb97e7a9333800f61c35f157ebad` |
| 최종 I / TP / samples | -14 / -11.5 / 192000 | -14 / -11.5 / 192000 |

source SHA·input·profile/tool pin·영상 packet은 같았다. **재현 결정성은 보장하지 않으며 원인은 미확정이다.** 단순 MP4 metadata 차이라고 단정하지 않는다(PCM mix SHA도 다름). 이 과정의 bitexact FAIL 로그와 두 실행 기록을 지우지 않았다.

Master 질문 `msg_b56899113a4b`에 대한 결정 **`msg_2008113a6320`**으로 다음을 분리했다:

1. **고정 보관/복원 계약:** 기존 전체 SHA·행·파일 엄격 검증 유지.
2. **새 native 실행:** source/input/profile/tool/video identity·정확 samples·기존 **-14 I±1 / TP≤-1**·codec/frames·측정/manifest 정합성을 검사한다. 새 mix/MP4 SHA와 output을 그 실행의 증거로 기록한다. bitexact 재생성 PASS라고 하지 않는다.

`nativeS9Issues`는 실제 출력 행과 activity_log의 새 digest를 보관본 전체 논리 hash와 같다고 요구하지 않는다. 다른 안정 테이블·원본/입력/영상 pin은 유지하고 새행의 파일/manifest binding, verify items와 실제 최종 측정 일치, child/final 측정·정확 samples를 검사한다. source/pin/video 변경, -15.8 LUFS·TP0·NaN, 샘플 불일치, codec 변조를 거절하는 독립 비교기 시험과, 허용된 새 digest 차이만의 양성 대조가 있다. 깨진 고정 ZIP 및 source/render 참조를 뺀 재포장 ZIP도 별도로 거절한다. 음량 기준을 완화한 결정이 아니다.

이 비교기와 video packet 목록은 후보 작성 중 보강한 메타데이터이며 보관 ZIP bytes는 처음 선택한 위 SHA 그대로다. 다른 실제 실행을 새 비교기로 재평가한 기록에서도 통과했다. 그 재평가에서 A packet은 동일 전체 파일 SHA로부터 추론했고 B packet은 원 worker 기록을 사용했다(`t156-approved-captured-variant.log`); 최종 새 native 실행은 packet을 직접 다시 측정했다.

## 자체 실행 결과

| 실행 기준/명령 | 실제 결과 |
|---|---|
| 원 stage9 사본에서 최초 `S9_WRITE=1` + Vitest s9 | 실제 A/B와 backupjob 생성1 PASS; final ZIP 선택 |
| 원 stage9에서 `S9_REGENERATE=1` + Vitest s9 | **9 PASS / 2 skip**, 승인된 native identity/정책 비교 포함. bitexact 보장 아님 |
| 현재10에서 Vitest s9 | **9 PASS / 2 skip**, 원형9 same과 현재9→10 upgrade 구분 |
| 현재10에서 s9+s5+s6+s7 fixture 회귀 | **29 PASS / 5 skip**, 4 files |
| 현재10 사본 `tsc --noEmit --incremental false` | exit0 |
| 신규 TS3파일 ESLint | exit0 |
| 이미 있는 s9에 `S9_WRITE=1` | **의도한 exit1** / already exists, ZIP SHA 동일. 통과 시험으로 합산하지 않음 |

기본 s9 시험에는 원 s5 r1 JSON/SHA 보존, A/v1·B/v2 input/verify, 복원 모든 inventory 파일 SHA, missing audio/render 참조, 원형9/구앱8/현재10, 손상 ZIP과 비교기 거부 대조를 포함한다. metadata/manifest를 다시 맞춘 missing-reference도 DB 참조 단계에서 거절하며 목적지·restore staging이 남지 않는다. 전체 앱 build·전체 제품 회귀·UI·실기기·청취는 실행하지 않았다. 변경은 시험/fixture뿐이며 이번 자체 실행을 독립 검수로 표시하지 않는다.

재현은 **두 사본을 구분**한다. 원 stage9 archive `927abc8`에 이번 신규 파일을 얹고 물리 의존성/도구를 복사한 사본에서는:

```powershell
# 원본은 이미 있으므로 최초 발행 플래그는 사용하지 않는다.
$env:S9_REGENERATE='1'
node node_modules/vitest/vitest.mjs run tests/s9-fixture.test.ts --reporter=verbose
```

현재 앱(stage10 이상)의 안전 사본에서는 native 플래그 없이 `vitest run tests/s9-fixture.test.ts`로 원형/upgrade를 검증한다. 새 고정 버전이 필요하면 별도 s번호/작업으로 만들며 s9를 지우거나 덮어쓰지 않는다.

## 보호·증거·정리

실행/설치본 전후 FFmpeg SHA `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`, ffprobe SHA `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52` 동일. 설치본 수정/변조 시험 없음. 코드/도구 검증은 명시 로컬 신뢰 경계의 물리 사본 검사이며 OS 격리 보장으로 확대하지 않는다.

- stage9 최종 사본/증거: `C:/Users/Administrator/AppData/Local/Temp/dream-t156-final-a10d8b7d2d`
- 초기 실험 사본(선택한 ZIP이 아님): `C:/Users/Administrator/AppData/Local/Temp/dream-t156-build-8312ae57ba`
- 현재10 복원/회귀 사본: `C:/Users/Administrator/AppData/Local/Temp/dream-t156-current10-cf47673b49`

최종 사본에는 `t156-generate`, `t156-approved-final`, `t156-refuse-existing`, `t156-repeat-1`, `t156-render-diff` 로그와 `t156-failed-record.json`/`t156-failed-render-rows.json`, 비교 재평가 로그를 보존했다. 최신 앱 사본에는 `t156-current10-final.log`와 lint/type 로그가 있다. 임시 비교 profile/packet 산출 스크립트도 같은 자기 사본에 있다. 초기 Windows 8.3 경로 가드와 restore 목적지 형제 경로 등 harness 오류는 수정하고 재실행했으며 제품 FAIL로 세지 않았다.

Vitest가 만든 가짜 runtime/restore 폴더는 각 시험의 소유경계 확인 후 정리됐다. 자기 render/native node·FFmpeg·browser 프로세스가 남지 않은 것을 확인했고 서버3013을 사용하거나 중단하지 않았다. 세 자기 사본의 node_modules 경로를 resolve한 뒤 삭제하려 했으나 **자동 승인 검토가 `blocked by policy`로 거절**했다. 우회하지 않았으므로 사본·물리 도구/의존성·일부 캐시·ZIP/로그 증거가 위 경로에 잔존한다.

다음 조건: Master가 신규6파일의 diff/고정 ZIP SHA와 자체 결과를 통합 검증한 뒤 공식 고정한다. 별도 독립 검수 전이며 native bitexact 미보장/원인 미확정과 청취 미검증은 유지한다.

복사용 전달 메시지: T156 구현 ready_review 반환합니다. 확정927abc8 stage9에서 실제 v1/A와 voice/music v2/AAC B를 만들고 실제 backupjob s9 ZIP(50e850aec0c2c8a3137c4280943e3de295d32e6bad9b998f0e02cf20af41ca95,1304161bytes)을 생성했습니다. 고정행/원본/복원MP4 전체SHA, 참조거절·구앱8 차단 및 현재2c79ee9의9→10복원, 관련29/lint/type가 자체 통과했습니다. Master승인에 따라 새native실행은identity/정확sample/원래음량정책으로 분리했으며 바이트결정성 미보장과 이전FAIL·두결과 증거를 유지했습니다. 신규6파일만 통합·검증 후 공식고정해 주세요; 독립검수PASS가 아니며 자기프로세스 종료/삭제정책 거절 잔존을 기록했습니다.
