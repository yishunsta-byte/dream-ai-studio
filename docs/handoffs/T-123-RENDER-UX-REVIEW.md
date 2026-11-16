# T-123 · 렌더 잔여 UX 검수 — Codex design

| 항목 | 결과 |
|---|---|
| 담당 / 날짜 | CX-DESIGN-01 / 2026-11-17 Asia/Seoul |
| 지시 | Master msg_2ec5f6748a32, 후속 msg_5b2338268a54·msg_68b519b34060 |
| 고정 대상 | **3580883**, T117 렌더 UI. 현재 root의 T119/T120 WIP와 구분 |
| 판정 | 직접 확인한 범위 **확정 B 0, C 4**. 초기 hydration 경계 포커스 관찰 U1 및 미검증 조건은 남음. 전체 P2/렌더/API 무결성 PASS 아님 |
| 변경 | 이 고유 보고서만. 제품·공유 build·spec·기존 시안·공유 상태·WORK-HISTORY 변경 없음 |
| 상태 | ready_review, Master 회수용. T119 최종 커밋 추가 검수는 별도 |

## 1. 격리 환경과 증거 성격

`git archive 3580883`을 OS 임시 폴더에 풀었다. 다른 담당의 `.t118-work`나 3118 서버를 사용하지 않았다.

작업 폴더와 증거 폴더:

`C:/Users/Administrator/AppData/Local/Temp/dream-t123-f8f3f11a4bc14073a694b15458c2b699`

- `source/`: 고정 소스, 검수 보조 스크립트. `runtime/`: **검수용 s5 가상 백업 사본**만 저장.
- 제품 `verifyBackupArchive`로 고정 s5를 풀고, 이 사본에만 현재 migration을 적용했다. 프로젝트 분야 스냅샷을 실제 메뉴 스냅샷으로 보강했다. 기존 queued/running 가상 작업을 취소하고 빈 장면을 보관한 뒤, 제품 `timelineService.save`로 타임라인을 저장했다. 원본 fixture와 실제 사용자 DB/storage에는 접근하지 않았다.
- 최초 node_modules 연결은 C/D 드라이브가 달라 Next의 클라이언트 경로 해석에 실패했다. 자기 junction을 제거하고 의존성을 자기 임시 폴더에 복사한 뒤 재시작했다. 공유 node_modules의 내용은 수정하지 않았다. `.tools`는 읽기용 연결이며 도구 설치·교체 없음.
- 화면 서버: 복사본 `next dev --webpack --hostname 127.0.0.1 --port 3123`, 데이터 루트는 위 `runtime`으로 명시.
- 브라우저: ego-browser v2.2.1 가이드를 읽고 자기 TaskSpace **17**의 p1만 사용했다. CDP 폭 설정은 각 실행 내 실제 `innerWidth/scrollWidth`로 기록했다.
- Watchpack의 C드라이브 시스템 파일 lstat 경고가 있었지만 이후 페이지/API 요청은 정상 응답했다. 이 환경 경고를 제품 결함으로 세지 않았다.

**실행 증거 구분:** 새 영상 요청→queued는 실제 제품 API를 클릭해 확인했다. 이번에는 Remotion worker를 실행하지 않았다. 이후 running/verify/terminal 행은 자기 DB의 제품 서비스·repository를 이용한 **UI 상태전환 주입**이다. SQL guards를 제거하지 않았고 `checkRenderRows`를 확인했다. 실패 원인이 실제 renderer에서 발생했다고 주장하지 않는다.

재생 가능한 상태용 MP4는 자기 임시 폴더에서 ffmpeg로 만든 30초 단색 영상이다. 제품 ffprobe 확인은 실제로 통과했고 그 해시·크기를 가상 행에 넣었다. 따라서 재생 버튼·행·HTTP 표시 검증용이며 Remotion 합성 성공 증거가 아니다. 확인 실패 항목도 UI 검사용 값으로 명시해 주입했다.

## 2. 직접 확인한 결과

| 항목 | 직접 확인 | 증거 |
|---|---|---|
| R1 저장하지 않은 편집 | 실제 편집 화면에서 장면 순서를 바꾸면 렌더 진입이 disabled, 저장한 타임라인만 만든다는 이유 표시. 변경 취소로 되돌림 | `dirty1280.png`, browser09 출력. 파일명과 달리 이 실행은 기본 뷰포트이며 폭 1280 검증 증거로 사용하지 않음 |
| R1 타임라인 없음 | 자기 DB의 현재 포인터를 잠시 비움 → 이유 + 편집 링크 + 버튼 막힘, 원래 포인터 복구 | `no-timeline390.png`, `blockers-layout.json` |
| R1 파일·글꼴 없음 동시 | 자기 storage의 장면 파일을 잠시 이름 변경, 자기 public 글꼴 OFL 파일을 잠시 분리 → **두 이유를 동시에** 표시, 장면/편집 링크, 버튼 막힘. 모두 원위치 | `file-font-missing390.png`, `blockers-layout.json` |
| R1 파일 변경 | 자기 장면 파일에 1바이트 추가 → 결과 파일이 달라졌다는 이유, 장면 제작 링크. 원래 바이트 복구 | `blocker-file-changed.png` |
| R1 TIMELINE_STALE | 자기 DB에서 장면 선택을 비워 저장된 타임라인과 다르게 함 → 편집에서 다시 저장하라는 이유·링크·버튼 막힘 | `blocker-stale.png`, `extra-blockers.json` |
| R1 결과 미선택 | 제품 timeline save로 현재 빈 선택을 저장 → 장면1 미선택·장면 제작 링크·버튼 막힘 | `blocker-empty.png`, `extra-blockers.json` |
| R1 장면 없음 | 자기 가상 장면을 보관하고 제품 timeline save로 video=[] 저장 → 장면 없음·장면 제작 링크·버튼 막힘 | `no-scenes390.png`, `final-observations.json` |
| R3 확인 실패 | 틀린 색 정보 항목을 설명, 실패 표시, 다시 만들기. **재생·download 링크 0** | `result-rows.json`, `results-1280.png`·`results-390.png` |
| 그 밖의 실패 | DISK_FULL, RENDER_BROWSER_CRASHED 3회, RENDER_INTERRUPTED 3회, STORAGE_FAILED 1회 각각 이유/시도 수/다음 행동 표시, 재생·download 0 | 같은 rows 증거. 실제 ENOSPC·crash·권한 실패를 발생시킨 시험은 아님 |
| 취소 뒤 끝남 | 보관만·자동 사용 안 함·백업 포함 문구, 재생·download 0. 실제 파일 route 요청 **404** | `late390.png`, `final-observations.json` |
| 파일 없음 | 성공 행의 파일만 자기 storage에서 분리 → 파일 없음 오류, 확인 요청·다시 만들기, 재생·download 0 | `result-rows.json`, results 캡처 |
| 대기 표시 | 실제 API 요청 뒤 처리기 꺼짐·queued, 진행 제목에 초점. starts=0인데 시도1/3 표시 C3 재현 | `queued1280.png` |
| 재생 버튼 | 누르면 video가 열림, metadata 로드 뒤 readyState4/1080×1920지만 **paused=true, currentTime=0, autoplay=false** | `playback.json`. 파일명 playback1280은 기본 뷰포트에서 찍혀 정확한1280 증거로 사용 안 함 |
| R10 hydration 후 | 취소 확인창을 열고 닫아 이벤트 동작을 확인한 뒤 제목 focus→2초 poll 사이 verify/success 전환: **2/2 새 결과 H3로 이동**. 카드 밖 설정 링크에 둔 경우 **1/1 유지** | `hydrated-focus.json` |
| 1280/390 | 실패/late/누락/정상 결과들이 함께 있는 화면의 실제 폭1280/390, scrollWidth1265/375. 가로 넘침0, 측정한 main의 보이는 버튼/링크 높이44px 미만0 | `layout-results.json`, results 캡처 |
| 확대 | 640 CSS px / DPR2 재배치에서 scrollWidth625, CSS zoom2에서 scrollWidth1265≤1280 및 상단 육안 확인 | `reflow-200-equivalent.png`, `css-zoom-200.png`, `blockers-layout.json`. **실제 브라우저200% 배율 검증과 구분** |

추가 blockers(stale/empty/no-scenes)의 첫 확인은 실제 기본 폭1421이었다(`extra-blockers.json`). 별도 `final-observations.json`에서 장면 없음390을 재확인했다. 모든 캡처 이름이 뷰포트를 보증한다고 가정하지 않는다.

R1의 TIMELINE_STALE는 **장면 선택과 저장된 타임라인 차이**다. 검수 승인 stale 안내와 같은 개념으로 세지 않았다. 후자는 T117에서 API 값이 없어 표시하지 않았다고 보고된 상태이며 이번에 검증 완료로 올리지 않는다.

## 3. C 개선 항목과 권장 수정 범위

| ID | 관찰 / 사용자 영향 | 권장 범위 |
|---|---|---|
| C1 | 막힌 영상 만들기 및 dirty 진입 버튼은 native disabled, `aria-describedby=null`. 이유는 화면에 있으나 Tab으로 버튼에 갈 수 없어 버튼과 이유의 관계를 듣기 어려울 수 있음. 실제 스크린리더 사용성 결과는 아님 | 공용 Button 접근성 정책을 Master가 별도 조정. 이유 id 연결과 키보드 발견 가능성을 함께 검토. 렌더 한 곳만 임의 패치하지 않음 |
| C2 | '재생' 버튼은 영상 영역을 펼치며 실제 재생은 시작하지 않음 | 렌더 ResultRow 문구를 '영상 보기/영상 닫기'로 맞추는 작은 변경 권장. 자동재생 추가는 필수가 아님 |
| C3 | 시도0 queued인데 Math.max(attempt,1)로 '시도1/3' 표시 | 렌더 ProgressBody에서 attempt0을 '첫 시도 전'으로 표시하거나 시도 줄 숨김. 서버 시도 정책 변경 불필요 |
| C4 | 고정3580883 확인창에 '취소 / 취소하기'가 나란히 표시됨 | **T119 배정 항목**. 최종 closeLabel 커밋 후 확인. 현재 고정 버전 결과를 WIP 완료판정으로 사용하지 않음 |

T119 `renderWait`의 실제 대기 상태·키보드·focus는 최종 커밋 도착 후 별도 추가 검수다. 이번에 WIP를 수정하거나 검수 완료로 처리하지 않았다.

## 4. U1 — 초기 로딩 포커스: 중간 판정 정정 포함

1. 새로 연 running 화면에서 DOM selector만 기다린 뒤 스크립트 focus를 주고 빠르게 verify/success를 주입했다. 초기3회, 두 requestAnimationFrame 뒤까지 기다린 추가2회에서 body가 관찰됐다(`focus-results.json`, `focus-settled.json`).
2. 이때 hydration/effect 준비 완료를 보장하지 않았다. 그러므로 실제 상호작용 준비 이후의 일반 완료 흐름과 동일한 시험이라고 단정할 수 없다.
3. 취소 패널을 실제 열고 닫아 React 이벤트가 준비됐음을 확인한 대조는 제목2/2 결과H3 이동, 카드밖1/1 유지였다(`hydrated-focus.json`).
4. Master에게 최초 B후보(msg_d1c3c1f3f5af)를 보냈으나 후속 msg_23c56957b1e6으로 범위를 정정했다. Master msg_68b519b34060에서 일반 R10 필수결함 지정 철회를 확인했다.

**최종 분류: 확정 B 아님. 초기 hydration/검수 하네스 경계의 재현 관찰 U1.** 실제 사람이 첫 로드 직후 키보드로 진입한 경우와 느린 JS 로드 조건이 필요하면 별도 범위로 재현한다. 이 관찰만으로 제품 수정 범위를 확대하지 않는다.

## 5. 미검증·상속 근거·계약 문구

- T118의 실제 정상 렌더·취소·중복·다운로드/해시 결과는 T121에서 상속한다. 이번 상태 주입을 그 실제 renderer 증거 대신 사용하지 않는다.
- 시작 전 디스크 부족과 도구 없음/버전 불일치, 기타 일부 blocker는 이번 실제 브라우저에서 강제로 만들지 않았다. 고정 테스트10개에서 browser mismatch/disk 포함 정적 문구는 통과했고 T118에는 도구 없음 실제 관찰이 있다. 외부 디스크를 채우거나 공유 도구를 이동하지 않았다.
- unsupported_media, 모든 오류코드·대기 사유 조합, 취소 정리 실패 경로, 느린 요청/서버 오류 전부를 실행한 것은 아니다.
- R13 외부 네트워크0·R14 실제 용량/재시도·R15 실제 백업복원/해시 보존은 backend 독립검수의 근거를 별도로 받아야 한다. 이번에 PASS를 대신하지 않는다. T120 무결성 수정의 수용 판정은 Master/독립검수 소관이다.
- R16은 T119 완료 후 확인. 실제 휴대폰·스크린리더·자막 오차 측정도 미검증. 표시된 측정 전/확인 전을 바꾸지 않았다.
- 브라우저 Ctrl+Equal은 이번 자동화에서 실제 배율 변화를 확인하지 못했다. CSS zoom2와 640px/DPR2 재배치만 검증했으므로 native browser200% 완료라고 하지 않는다.
- **T102 R15 변경안만 제안:** 통과 MP4는 복원 후 해시·재생·받기를 확인하고, 취소 뒤 끝난 MP4는 해시·백업 포함·보관·자동 선택 없음·재생/받기404를 확인하도록 문장을 나눌 것. 현재 Master 계약은 late 결과를 제공하지 않는 것이다. T102와 API/버튼은 수정하지 않았다.

## 6. 실행 검사·정리·반환

- 자기 고정 복사본에서 `node node_modules/vitest/vitest.mjs run tests/p2-4-render-panel.test.ts`: **1파일 / 10개 통과**. 정적 화면 시험이며 브라우저·backend 통합시험과 구분.
- 문서·검수 작업으로 제품 코드를 바꾸지 않았으므로 전체 lint/type/build/렌더 suite를 반복하지 않았다.
- ego TaskSpace17은 별도 마지막 스크립트 `finish({keep:[]})`로 종료했다.
- 자기 서버 exec session86607에 Ctrl+C 전달 후 **3123 LISTEN0**, 자기 임시 경로가 있는 node 프로세스0을 확인했다. worker는 시작하지 않았다. 다른 담당 서버/브라우저를 종료하지 않았다.
- 자기 임시 소스·가상 DB·스크립트·PNG15개·JSON 증거는 재현용으로 위 OS-temp 폴더에 보존했다. 이전 담당 작업본은 건드리지 않았다.
- 검수 도중 helper SQL 열 이름 오류1건, snapshot/selector 형식 오류를 수정했다. 제품 실패로 세지 않았으며 완료하지 못한 동작을 성공으로 기록하지 않았다.

복사용 전달 메시지: T1233580883 잔여 UX 검수 반환합니다. 확인 범위 확정B0/C4, 초기 hydration 포커스 관찰U1은 일반 R10 결함 판정을 철회하고 상호작용 준비 후2/2 결과초점·카드밖1/1 유지와 구분했습니다. 가상 DB 주입으로 실패/late/파일누락 행과 blockers를 확인했고 실제 API queued 및 late파일404를 확인했습니다. 1280/390 넘침0, 정적10개 PASS. CSS200%/640px 재배치는 확인했지만 native200%·실기기·스크린리더·backend 무결성·T119최종 검수는 남습니다. 제품/WIP 변경 없음, 자기브라우저/3123서버 정리 완료. C2명칭/C3시도표시/T119closeLabel은 작은 UI 후속, C1공용Button은 별도 조정 권장합니다.
