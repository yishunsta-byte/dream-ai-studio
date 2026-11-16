# T-165 T162 시험 타입 좁히기

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_0c569a56682c · 기준 `5b82727`(df62033 시험 원본)
- 바꾼 파일은 `tests/t162-audio-bundle.test.ts` 하나예요. 서비스·UI·스키마는 바꾸지 않았어요. 작업트리에 있는 디자인 UI 작업(exports-panel, t164)은 stage하지 않았어요.

## 수정
- 시험 맨 위에 두 가지를 추가했어요.
  - `manifest2()`: `expect(manifestVersion).toBe(2)`를 단언하고, 2가 아니면 throw해서 타입을 `BundleManifestV2`로 좁혀요.
  - `isAudioFile()`: `entry is Extract<ManifestFile,{audio:unknown}>` 타입 가드예요. `"audio" in entry`이고 값이 있을 때만 참이에요.
- 강제 cast 세 곳(81–86행 근처 두 곳, 163행)을 `filter(isAudioFile)`과 `manifest2(...)`로 바꿨어요.
- `as unknown`, expect 삭제, skip은 쓰지 않았어요. 검사하는 내용(소리 2개, 경로, roles, isMock, 샘플 정합)은 그대로예요.
- DB 행이나 오류 객체를 읽을 때 쓰는 기존 `as`(TS2352와 관계없음)는 남겨 두었어요.

## 재현 근거 (환경 차이인지 구분)
| 항목 | 값 |
|---|---|
| 새 사본 | `git archive df62033`을 OS 임시 폴더에 풀고 `npm ci --ignore-scripts`(397개 패키지)로 설치했어요. 공유 node_modules는 쓰지 않았어요. |
| TypeScript | 6.0.3이에요(package.json 고정값, 새 사본과 공유 node_modules가 같아요). |
| package-lock.json SHA-256 | `7d619f2d366052f1ed28b02245292593fb32491f2920e40f9b038daba8c6b2fc` |
| package.json SHA-256 | `74c7064b5047d0eb42914536021e19d1726fdbed335cba8f4b9ec3c324730235` |
| df62033 시험 파일 SHA-256 | `28ee5256f496ef35f4de04b32ca7fef6be2ea3c748f20062bfedf44f6f9cbcb8` |
| 수정한 시험 파일 SHA-256 | `079214fa8fcb7368030fbe6715ad50d87eb90ed40599953a59e4908a35100a63` |

- 새 사본, **df62033 원본 시험**
  - `tsc --noEmit --incremental false`가 exit 0이에요.
  - `next typegen`을 한 뒤 `tsc --noEmit`(= `npm run typecheck` 경로)도 exit 0이에요.
  - 결론: **TS2352는 깨끗한 설치에서 재현되지 않았어요.** 보고된 오류는 그 사본에만 있던 상황(설치 상태, 생성 타입, 진행 중이던 UI 변경과 함께 검사한 것 등) 때문일 가능성이 커요. 원인을 확정하지는 못했어요.
  - 다만 cast는 실제로 타입 보장이 약한 코드였어요. 그래서 환경과 상관없이 좁히기로 바꿨어요.
- 새 사본, **수정한 시험**: `tsc --noEmit --incremental false` exit 0, `eslint` exit 0
- 작업트리
  - `tsc --noEmit --incremental false` exit 0, `eslint` exit 0
  - `vitest run tests/t162-audio-bundle.test.ts`는 **8/8 통과**예요.
  - 이 tsc는 작업트리 전체를 검사해서 디자인 UI의 미커밋 작업도 함께 들어가요.
- 새 사본 임시 폴더는 지웠어요.
