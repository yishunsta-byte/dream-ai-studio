# T-132 P2-5A 오디오 저장·복원 기반 — CC-DATA-01 반환

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_2b9d09bedbb0 · 근거: `docs/handoffs/T-130-AUDIO-UX-PLAN.md`(060145…), 최신 규칙·TEAM
- 상태: 자체 검수(독립 검수 아님). UI·DSP·렌더 실행기는 범위 밖이라 열지 않았어요.
- 실제 사용자 DB·자료·고정 fixture(s4~s7)·발행 migration 0001~0007은 열거나 바꾸지 않았어요. 모든 DB 시험은 OS 임시 폴더의 가상 s4 사본이에요.

## 1. 결정과 근거
| 항목 | 결정 |
|---|---|
| 형식 | **timeline v1은 그대로 읽고, v2는 클라이언트가 `schemaVersion:2`로 보낼 때만 저장해요(opt-in).** 읽기로 자동 변환하지 않아요. v1을 저장하면 v1, v2를 저장하면 v2예요. |
| 시간 단위 | 30fps 정수 프레임, 48kHz에서 1프레임 = 1600샘플(`SAMPLES_PER_FRAME`) |
| 출력 길이 D | `max(영상 프레임 합, 글자 끝)`. 소리는 `start+duration ≤ D` 안에서만 쓸 수 있어요. 소리 때문에 영상을 늘리거나 반복하지 않아요. |
| 겹침 | 음악 두 곡은 `audioJoins`(crossfade, equalPower)로만 겹쳐요. 이어지지 않은 음악 겹침과 세 곡 동시 겹침은 거절해요. 목소리·효과음은 자유롭게 겹쳐도 돼요. |
| 예전 v1 소리 | v1에 소리 항목이 있으면 추정해서 변환하지 않아요. **원래 행은 바이트 그대로 두고**, 저장·되돌리기·렌더에서는 "예전 형식(v1)의 소리 항목은 지원하지 않아요"로 명시 거절해요. |
| 권리 | `audioRights`는 **버전마다** 쓰는 소리 파일 하나에 정확히 한 줄이에요. 값을 모르면 null로 둬요("직접 확인 필요"). 기록이 있어도 검수는 자동 통과하지 않아요. |
| 렌더 | 렌더 envelope 1은 **소리 없는 v1만** 받아요. v2(소리 0개 포함)와 소리 있는 예전 v1은 `AUDIO_RENDER_UNSUPPORTED`로 렌더에 들어가지 않아요. 소리를 빠뜨린 채 무음 성공으로 끝나는 일이 없어요. envelope 1 + audioPlan 1은 후속 C에서 해요. |
| migration | **0008 필요 — 추가했어요(`0008_timeline_audio.sql`, 열 변경 없음).** 근거는 아래와 같아요. |

### 0008을 넣은 근거 (코드 판독, 가상 DB로 확인)
- 0007까지의 앱은 `timelineSchema`가 `schemaVersion:1`만 받아요. 그래서 v2 행이 하나라도 있으면 편집·검수·내보내기·렌더 준비가 그 행을 읽다가 실패해요. 복원할 때도 `checkTimelineRows`에서 일반 오류로 멈춰요.
  - 시험: `timelineV1Schema.safeParse(v2)`가 false예요.
- 저널에 0008이 기록되면 예전 앱의 `compareMigrations`가 `too_new`를 줘요.
  - 시작할 때는 버전이 맞지 않는다고 막아요.
  - 복원할 때는 `BACKUP_TOO_NEW`로 깔끔하게 거부해요. 그래서 예전 앱이 새 자료를 예전 DB로 잘못 읽지 않아요.
  - 시험: 8단계 저널을 7단계 목록과 비교하면 `too_new`예요.
- 0008은 열이나 표를 바꾸지 않고 **INSERT 트리거 1개만** 추가해요. 새 timeline 행은 "소리 없는 v1"이거나 "고정 프로필 `p2-5-local-v1` v2"여야 해요.
  - 기존 행은 다시 쓰지 않아요. 0008의 데이터 확인(`checkTimelineRows`, 읽기 전용)이 모든 행을 한 번 읽어요.
- `checkTimelineRows`에 검사를 하나 더했어요. v2 행의 소리 `assetId`가 이 DB에 있는 `kind='audio'` 자료여야 해요. JSON 안의 참조라 외래 키가 없기 때문이에요.
  - 복원과 0008 적용 때 함께 검사해요.

## 2. 바꾼 파일
| 파일 | 내용 |
|---|---|
| `lib/edit/timeline.ts` | `timelineV1Schema`(기존 그대로), 새 `timelineV2Schema`(audio clip: id·assetId·role·startFrame·sourceInFrame·durationFrames·gainDb −60~12·fadeIn/Out·duckUnderVoice / audioJoins / audioMixProfile / audioRights), 판별 합집합 `timelineSchema`, `audioIssues`(위치가 붙은 이유 목록), `outputFrames`, 상수 |
| `lib/services/timeline.ts` | 기존 "소리 줄은 다음 단계" 거절을 대체했어요. v1 소리는 거절하고, v2는 자료를 검사해요. 검사 내용은 표 아래에 적었어요. 되돌릴 때도 예전 v1 소리는 명시 거절해요. 모든 거절은 기존 즉시 트랜잭션 안에서 일어나서 행·버전·포인터가 그대로예요. |
| `lib/db/migrations/0008_timeline_audio.sql`(새), `lib/db/migrate.ts` | 기능 게이트·INSERT 트리거, `LATER_SQL_STEPS`에 8 추가, 데이터 확인 `checkTimelineRows` |
| `lib/db/timeline-data.ts` | 복원·0008 행 검사에 v2 소리 참조 확인 추가 |
| `lib/repo/library.ts` | `assetUsage`가 `project_assets` 연결과 **모든 타임라인 버전의 소리 참조**를 합쳐 프로젝트 수를 세요. 그래서 타임라인에만 쓴 소리도 "사용 안 함"으로 보이지 않아요. |
| `lib/services/review.ts` | 저장한 타임라인(v2)에 실제 음악이 있으면 프로젝트 답이 `usesMusic≠true`여도 `x.music-rights`(필수) 항목이 생겨요. 근거 문구는 "곡별 기록 수 · 사용권은 직접 확인"이고, 상태는 unchecked에서 시작해요(자동 통과 없음). |
| `lib/render/input.ts`, `lib/services/renders.ts` | 렌더 입력 1의 timeline은 소리 없는 v1만 받아요. 준비 단계에 `AUDIO_RENDER_UNSUPPORTED` 차단을 넣었어요. |
| `components/render-panel/copy.ts` | **UI 한 줄(최소)**: 새 차단 이유 문구예요. 이 줄이 없으면 렌더 화면이 이유 없이 "준비 안 됨"만 보여요. 화면 구조와 디자인은 바꾸지 않았어요. 범위상 Master 확인을 부탁해요. |
| tests | 새 `tests/p2-5a-audio.test.ts`(15). 0008 때문에 "최신 = 7단계"를 전제한 기존 시험의 기대값을 정리했어요. 정리 내용은 표 아래에 적었어요. |

- **timeline 서비스의 v2 자료 검사:**
  - 새로 넣거나 바꾼 clip은 보관하지 않은 소리 자료여야 하고, 저장 파일이 있어야 해요.
  - 그대로 둔 clip은 나중에 보관한 자료여도 계속 저장할 수 있어요. 저장된 값은 다시 쓰지 않아요.
  - 모든 clip은 `sourceInFrame+durationFrames ≤ floor(durationMs×30/1000)`이어야 해요. 길이를 모르는 파일은 거절해요.
- **기존 시험 기대값 정리:**
  - s7-fixture와 0007 진단 시험은 원래 뜻을 지키도록 7단계 앱(`s7Migrations`, `slice(0,7)`)으로 고정했어요.
  - "최신 제품" 시험은 8단계로 바꿨어요.
  - `p2-3-text-editor`는 `.shape`를 `timelineV1Schema`로 바꿨어요.

## 3. 검증
| 항목 | 결과 |
|---|---|
| 새 시험 `p2-5a-audio` 15 | 아래 목록 참고 |
| 전체 vitest | **585 통과 + 13 skip** (51 파일 + 1 skip) |
| lint · tsc | 통과 |
| 운영 빌드(복사본) | 통과, 추적 37개에서 로컬 데이터·비밀 설정·렌더 도구 0 |
| 보호 대상 | `git diff`에서 `lib/db/migrations/0001~0007`·`tests/fixtures` 변경 0. s4 ZIP 해시를 시험 전후에 비교했어요. |

새 시험 15개가 확인한 것:
- **스키마 5개**
  - 정상 조합, 1600샘플, v1·v2 읽기, D 계산
  - 형식 거절: 모르는 키, 프로필, NaN/Infinity, 소수 프레임, 음수, 범위, 길이 0
  - 중복 id, D 넘김, 서서히 합 초과, 음악 아닌 낮추기
  - 곡 연결: 위치·서서히 중복·길이·대상·한 번씩, 이어지지 않은 겹침, 세 곡 겹침
  - 권리 행: 누락·중복·남음, URL·날짜·공백
- **가상 s4 사본 10개**
  - v2 저장 왕복: 원값·해시·버전+1이 맞고, 읽기만으로는 쓰지 않으며, r1 바이트가 그대로예요. v1로 다시 저장하면 v1로 남고, v2 되돌리기는 같은 JSON이에요.
  - 원자 거절 6종: 행·버전·포인터 그대로
  - CAS 충돌 2종
  - 보관 뒤 그대로 둔 clip 허용과 바꾼 clip 거절, 사용 수
  - 검수 음악 권리 항목 생성·unchecked
  - 렌더 차단: v2 소리 있음/없음, 렌더 입력 스키마
  - 0008 트리거 4종 거절과 `too_new`
  - 0008 전에 쓴 소리 있는 v1 행: 올린 뒤 바이트 그대로, 저장·되돌리기 거절
  - 그 행이 현재 버전일 때 렌더 차단
  - **실제 백업 → 다른 폴더 복원**: v2 행이 바이트까지 같고 소리 파일 sha가 같아요. 참조가 깨진 DB는 `Timeline audio reference differs`로 거절해요.

## 4. 확인 못 한 것 · 후속 · 충돌
- **UI는 열지 않았어요.** 지금 편집 화면은 v2를 만들지 않아요. 저장된 v2를 다시 저장하면 `applyEditView`의 펼침이 소리 값을 보존한다는 것은 코드로 확인했고, 브라우저로는 확인하지 않았어요.
- **편집용 내보내기 ZIP:** v2를 고르면 `edit/timeline.json`에 소리 설정과 권리 기록이 들어가요. 하지만 소리 원본 파일은 묶음에 넣지 않았고 README 안내도 없어요(`lib/services/exports.ts`는 허용 범위 밖). P2-6 묶음 구성 때 다뤄야 해요.
- 7단계 앱이 8단계 백업 ZIP을 실제로 거부하는 경로는 이번에 새로 돌리지 않았어요. `compareMigrations`가 `too_new`를 주는 것과, 그 값을 `BACKUP_TOO_NEW`로 바꾸는 기존 코드(s7 시험이 같은 방식으로 확인함)로 갈음했어요.
- 소리 파일의 실제 샘플 수·채널·코덱 검사는 하지 않았어요. 길이 상한은 `duration_ms` 기준 정수 프레임이에요. 정밀 디코드 길이는 B·C 단계에서 해요.
- 자료 전역 권리 메모 수정 API, 선택 자료 상세 preflight, timeline GET의 실제 프로젝트 revision 추가, `fieldErrors` 응답 확장은 하지 않았어요(T-130 Q3, 후속).
  - 지금 v2 스키마 오류는 기존처럼 ZodError(400)로 가요. `audioIssues`가 필드 위치를 함께 주니 나중에 그대로 연결할 수 있어요.
- 최종 음량 목표(-14 LUFS / TP -2 / LRA 7, AAC 48k stereo 192k)는 후속 DSP의 실험 기본값이에요. 이번 PASS와는 관계없어요.
- 실제 사용자 DB는 열지 않았어요. 그래서 "역사적 v1에 소리가 있는 행이 있는지"는 실제 데이터로 확인하지 못했어요. 다만 이전 저장 서비스는 항상 거절했고 0005는 `audio:[]`로 옮겨서, 제품 경로로는 생길 수 없었어요. 있으면 위 규칙대로 원형을 보존해요.

## 5. 정리
- 새로 띄운 프로세스는 없어요(시험·빌드만 실행). 임시 DB는 시험이 끝나면 지워요.
- 패치 보조 스크립트는 `tmp/t132-*.cjs`에 있어요(커밋하지 않음).
