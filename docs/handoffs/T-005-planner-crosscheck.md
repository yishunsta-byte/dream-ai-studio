# T-005 플래너 기준 교차 확인

후속 수신: Claude의 msg_abd66b3b5cd3에 따라 문서2건/질문5건이 기준에 반영됐다. 설치 본문 OFL 검사·기존 Pretendard 경로 유지, 효과 포함 폭/중앙.74·실측, 권장 글자 수/줄 수 경고, 기존P1값 유지 이관/정수 프레임 반올림, 표준 표기, USD·센트미만·정수비교 B-7을 확인했다. 아래는 수정 전 교차 확인 기록을 보존한 것이다. 현재 P1 SRT 누락은 별도 F-014-1 보완으로 닫았다.

2026-11-15 · Codex · 기준 구현 `07e0884`, PLAN v2.4 보완·DESIGN v1.4. 문서/JSON/현재 코드를 읽고 수치 계산과 공식 출처 확인만 수행했다. 플래너 소유 기준·프리셋·글꼴 파일은 수정하지 않았다. P1 종료 독립 검수를 대신하지 않으며 P2/P3 구현 승인이 아니다.

## 고칠 것

1. **fonts.json 설치 검사 문구**: `installRule`의 "라이선스 파일 첫 줄·본문에 SIL…Version1.1"은 첫 줄에도 그 문구를 요구하는 것으로 해석될 수 있다. 현재 정식 Pretendard OFL.txt와 Google Fonts OFL 파일들은 저작권 안내로 시작한다. **본문 전체에서 공백/줄바꿈·대소문자를 정규화한 OFL1.1 표제를 확인하고 원문 저작권/Reserved Font Name을 그대로 보존**하는 조건으로 명확히 해 달라. 첫 줄 일치 조건으로 정상 글꼴을 제외하면 안 된다.
2. **fonts.json 장 번호**: ZIP의 LICENSES 동봉 근거가 "PLAN12장"으로 되어 있으나 ZIP은13장이다. "PLAN11.3 T-5·13장"으로 바로잡으면 된다.
3. **현재 P1 구현 보완(플래너 수정 대상 아님)**: DESIGN6.6의 읽기 전용 SRT 미리보기와 끝≤시작일 때 칸 옆의 정확한 한글 오류가 현재 편집 UI에 없다. 저장/내보내기의 서버 시간 검증과 SRT 생성은 구현돼 있다. Codex가 별도 P1-8 후속으로 UI를 보완하고 직접 확인하겠다.

## 물어볼 것 · 사용자 결정 없이 플래너가 정리 가능

- **그려지는 바깥 경계**: 9:16 중심 프리셋6개의 기본 박스는 x=.5,width=.76이라 오른쪽이 정확히 .88(안전영역 끝)이다. 외곽선/그림자/배경 padding을 박스 밖으로 그리면 넘어갈 수 있다. widthRatio가 시각 효과까지 포함한 바깥 폭인지, 또는 효과 여유를 남겨 재배치할지 명시가 필요하다. 예: 자막 외곽선7px를 바깥으로 더하면 우측 약.8865다. 실제 렌더링 측정 전 "모든 글자가 안전"이라고 보증할 수는 없다.
- **최대 글자 수는 길이 보증이 아님**: 한글1글자≈1em이라는 보수적 가정에서 자막16×56=896px인데 세로형 박스 폭은820.8px다. 실제 폰트 측정·자동 줄바꿈·최대 줄 수 초과 검출을 우선할지 명시하면 좋다. 글자 수만 보고 잘림이 없다고 판정하지 않는다.
- **P1→P2 표기 이관**: 현재 P1은 "AI 생성"/"가상인물", 새 fixedTexts는 "AI 생성 콘텐츠"/"가상 인물"이다. PLAN12장의 가상인물 표기는 붙여 쓴다. 기존 저장 스냅샷을 조용히 바꾸지 않도록 표준 문구/별칭과 이관 시 유지 정책을 정해 달라. 기존 문구·크기64·색·위치·시간은 첫 타임라인 버전에 그대로 옮기고 새 프리셋은 새 항목에만 적용하는 방식을 권한다. 수동 초→30fps 정수 프레임 반올림 정책도 P2 시작 전에 고정하면 된다.
- **설치 경로 호환**: P1 Pretendard와 OFL은 `public/fonts/` 바로 아래에 있고 layout/내보내기가 이 경로를 쓴다. fonts.json의 하위 폴더로 옮길 때 이 두 소비자를 함께 갱신하거나 기존 경로를 유지해야 한다.
- **P3 표시 정밀도/통화**: 정수 마이크로 저장·비교는 적절하다. 센트 미만 금액은 `$0.00` 대신 `<$0.01` 등으로 표현할지 정해 달라. 한도/확인 금액 비교는 반올림된 표시가 아니라 정수 마이크로 값으로 한다. 실제 제공자 통화를 USD만 지원할지, 다른 통화는 명시적으로 거절할지도 정하면 통화가 섞인 합계를 막을 수 있다. 샘플의 KRW0과 실제 USD를 합산하지 않는다.

## 괜찮음

- **P1 범위/복원**: PLAN7.2의 새 settings 스냅샷+현재 포인터는 현 구현과 맞다. schema_version/content_revision/created_at 및 DB 수정·삭제 보호를 추가했다. T-003/K-5/6.7의 새 빈 폴더 복원·현재 데이터 불변·확인 패널 불필요는 서로 일치한다. 현재 데이터 교체는 구현하지 않는다.
- **P2 프리셋 기본 기하**: 1080×1920,1920×1080,1080×1080에서 짧은 변1080을 적용하고 `fontSize×lineHeight×maxLines+배경 상하 padding`으로 높이를 보수적으로 잡았을 때8종 모두 기본 박스가 각 안전영역 안이다. 단, 위의 효과 바깥 경계/실제 글꼴 검증은 별개다. 계산 증거 `tmp/t005-preset-geometry.json`(git 제외).

| 종류 | 글꼴/굵기 목록 일치 | 세 비율 기본 박스 | 9:16 우측 |
|---|---|---|---|
| subtitle | Pretendard700 | 통과 | .88 |
| hook | Black Han Sans400 | 통과 | .88 |
| emphasis | Pretendard800 | 통과 | .88 |
| title | Pretendard800 | 통과 | .88 |
| ending | Pretendard700 | 통과 | .88 |
| lyric | Noto Serif KR600 | 통과 | .88 |
| brand | Pretendard600 | 통과 | .56 |
| disclosure | Pretendard700 | 통과 | .66 |

- **P3 예산 수치**: 표시 예시$0.40→$0.38,실패청구$0.12/반환$0.28,4개×$0.40=$1.60,남음$25.96→$24.36은 일관된다. 저장 시 각각400000/380000/120000/280000/1600000 마이크로다. B-1~B-6의 예상→원자적 예약→실제/추정→반환 및 한도 미설정 차단과 충돌하지 않는다. 달러 입력은 문자열 기반 정수 변환·안전 정수 범위 검사, 표시 때만 소수 둘째 자리 반올림을 권한다. 실제 제공자 청구 검증은 P3 연결 시 별도다.
- **공식 글꼴 근거**: 2026-11-15에 아래 공식 배포본에서 OFL1.1 명시를 확인했다. 아직 다운로드하지 않은 P2 글꼴의 바이너리/굵기/렌더링/라이선스 동봉 검증까지 했다는 의미는 아니다. 실제 설치 때 배포 커밋/해시와 라이선스를 함께 고정해야 한다.

| 글꼴 | 공식 라이선스 원문 |
|---|---|
| Pretendard | [공식 저장소 LICENSE](https://github.com/orioncactus/pretendard/blob/main/LICENSE) |
| Noto Sans KR | [Google Fonts OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/OFL.txt) |
| Noto Serif KR | [Google Fonts OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifkr/OFL.txt) |
| Black Han Sans | [Google Fonts OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/blackhansans/OFL.txt) |
| Do Hyeon | [Google Fonts OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/dohyeon/OFL.txt) |
| Jua | [Google Fonts OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/jua/OFL.txt) |
| Gowun Dodum | [Google Fonts OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/gowundodum/OFL.txt) |
| Nanum Pen Script | [Google Fonts OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/nanumpenscript/OFL.txt) |

진행: 문서2건 수정·질문 항목은 Claude에 바로 회신한다. 사용자 승인이나 P1-9 중단은 필요 없다. 현재 P1 UI 누락은 별도 후속 커밋으로 고친다. 최종 독립 검수와 은영님 흐름 확인 전 P2 시작 금지는 유지한다.
