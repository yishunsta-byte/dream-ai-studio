# P2 자막 경계 측정 · WebVTT

기준 커밋 `e8d334c2`. 통합 플랜의 자막 오차 0.2초 기준 중 로컬 합성 렌더와 자막 내보내기의 경계를 자체 검증했다.

`scripts/remotion/measure-subtitle.ts`는 제품의 timelineVtt 출력에서 레이어 ID로 네 자막을 찾고 수동 시각을 30fps로 변환한 기준과 시작·끝을 대조한다. 누락, 잘못된 형식, 오차 초과는 해당 화면 비율과 전체 실행의 실패로 기록한다. `tests/measure-subtitle.test.ts`에 기준값과 1ms 초과, 끝 시각 이탈, ID 중복, 출력 누락 회귀 검사를 추가했다.

| 실제 렌더 | 프레임 수 | MP4 표시 최대 오차 | SRT / VTT 최대 오차 | 대조 영역 표시 |
|---|---:|---:|---:|---:|
| 9:16 | 120 | 5프레임 | 각각 1/3000초 | 0프레임 |
| 16:9 | 120 | 5프레임 | 각각 1/3000초 | 0프레임 |
| 1:1 | 120 | 5프레임 | 각각 1/3000초 | 0프레임 |

재현 명령

```powershell
node --conditions=react-server --import tsx scripts/remotion/measure-subtitle.ts --out tmp/p2-vtt-boundaries/measure.json
node node_modules/vitest/vitest.mjs run tests/measure-subtitle.test.ts tests/p2-6-vtt.test.ts
```

실측 종료 코드 0, 관련 시험 19개 통과. 변경 대상 ESLint 및 대상 파일과 의존성 타입 검사 통과. 전체 타입 검사 최종 재실행은 기존 .next 및 .next/dev 생성 타입의 studio 페이지 참조 오류로 실패했다.

검수 요청은 세 화면 비율의 VTT 행과 전체 실패 판정이다. 수치는 단색 배경, 4개 자막, 픽셀 차이 기준 48에서 적용된다. 실제 사용자 영상·휴대폰·음성 의미 싱크는 후속 확인 대상이다.

> 플래너 전달문 — P2 자막 측정 도구에 WebVTT 합격 기준을 반영했습니다. 세 비율의 실제 합성 MP4 자막 오차는 최대 5프레임, SRT·VTT는 각각 최대 0.333ms로 자체 검증을 통과했습니다. 관련 시험은 19개 통과했습니다.
