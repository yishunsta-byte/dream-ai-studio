# T-082 · P2-3 명세 확정과 공식 글꼴 7종 설치 (Claude design)

| 항목 | 내용 |
|---|---|
| 담당 / 지시 | Claude design (CC-DESIGN-01) / Master `msg_a8fa43b50304` |
| 근거 | T-080 2장·12장(`b3c7af7`), Master 수용 `msg_045764d19a46`·`msg_c6438d3ed41c`, `docs/spec/fonts.json`(source·folder·weights·installRule), T-081 계약 `msg_7cdbc56d1a83` → 수용 `msg_94e35f0564b7` |
| 커밋 | 자산 `b9b1961`(public/fonts 7폴더, 21파일) · 문서 이 커밋(spec·DESIGN·이 보고·history) |
| 안 바꾼 것 | Pretendard 파일·OFL·SOURCE(`public/fonts/` 바로 아래), 제품 TS/CSS, package, fonts.json, TEAM·REVIEW, 시안 |
| 사용자 결정 | 없음 |

---

## 1. 글꼴 자산 (실제 설치 완료 7/7)

### 1.1 받은 곳·방법

- **출처:** fonts.json `source`가 가리키는 Google Fonts의 공식 배포 저장소 **google/fonts**(Google Fonts 사이트가 내려 주는 파일의 원본 저장소). `main` 커밋 **`cc39c4c2c304bc368c9b7c311ea2bcc6013299fe`**(2026-11-14T17:50:12Z)로 7종 모두 고정.
- **방법:** 로그인 없는 GitHub 공개 API로 폴더 목록·크기·git blob 값을 읽고, `raw.githubusercontent.com/google/fonts/<커밋>/ofl/<폴더>/<파일>`을 curl로 받음. 계정·유료 서비스·외부 코드 실행 없음. 받은 파일은 대화용 임시 폴더(내려받기 전용 폴더)에 먼저 두고, 검사 스크립트는 다른 폴더에서 경로만 넘겨 **읽기만** 했다.
- **바꾸지 않음:** 파일 이름·글꼴 안 이름·내용 그대로. 변환(woff2)·부분 글꼴·굵기 합성 없음. 배포본에 woff2가 없어 TTF 그대로.

### 1.2 파일

| 폴더 | 글꼴 파일 | bytes | SHA-256 | 굵기(파일 안) | 글꼴 안 버전 |
|---|---|---|---|---|---|
| black-han-sans | `BlackHanSans-Regular.ttf` | 998,424 | `31960809284026681774a8e52dc19ebcad26cf69b0ad9d560f288296fbb52739` | 400 | Version 1.001 |
| do-hyeon | `DoHyeon-Regular.ttf` | 879,764 | `35644be7f28e0a68a447b1f7af351dcde5674b870f24f7b5f43e26d00b4ab653` | 400 | Version 1.001 |
| gowun-dodum | `GowunDodum-Regular.ttf` | 7,229,088 | `a6e457933227483a11758fd0947bc74422a106d46f0bf057fdaa5af94a30067d` | 400 | Version 2.000 |
| jua | `Jua-Regular.ttf` | 2,119,352 | `769677aef240bfc3b9965f2b50748075bff885e6c6992fc591a3fb268279f898` | 400 | Version 1.001 |
| nanum-pen-script | `NanumPenScript-Regular.ttf` | 3,201,664 | `6f0d1ab29c7894010dc88831fb7a0a51edb79136e450344183de5b1a8b52bd43` | 400 | Version 1.10 |
| noto-sans-kr | `NotoSansKR[wght].ttf` | 10,414,588 | `194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252` | 가변 wght 100–900 | Version 2.004-H2 |
| noto-serif-kr | `NotoSerifKR[wght].ttf` | 23,795,420 | `11f8d5de6f1b79195efba3828aaa2ec95c1178f5ae976fb23c8d53250a9938f3` | 가변 wght 200–900 | Version 2.003-H1 |

- 폴더마다 글꼴 파일 **1개** + `OFL.txt`(배포 원문) + `SOURCE.md`(받은 URL·커밋·크기·SHA-256·git blob·형식·굵기·이름).
- 합계(글꼴 + OFL) **48,669,055 bytes(약 46.4MiB)**. Noto Serif KR 하나가 약 절반.

### 1.3 검사 결과

| 검사 | 결과 |
|---|---|
| 저장소 기록과 같은지 | 글꼴 7개·OFL 7개의 git blob 값이 GitHub API 목록 값과 **모두 같음**. 커밋 뒤 `git ls-files -s`로 본 이 저장소 blob도 같음(바이트 동일) |
| 실제 파일 형식 | 7개 모두 TrueType(첫 4바이트 `00010000`), 표 목록·`name`·`OS/2` 정상 읽힘 |
| 굵기(fonts.json weights) | 고정 5종: `OS/2 usWeightClass` 400 = weights [400]. Noto Sans KR: `fvar` wght 100–900 ⊇ [400,700,900]. Noto Serif KR: wght 200–900 ⊇ [400,600,700]. **없는 굵기 없음, 합성 없음** |
| 내장 허용 | 7개 모두 `fsType 0`(설치형, 영상 삽입 제한 없음) |
| 라이선스 | 7개 `OFL.txt` 전체 본문을 공백·대소문자 정리 후 "sil open font license"·"version 1.1" 둘 다 있음(fonts.json installRule 방식). 저장소 METADATA.pb `license: "OFL"` 7개 |
| 저작권 줄 | Black Han Sans·Do Hyeon·Gowun Dodum·Jua Project Authors, Nanum Pen Script NHN(Reserved Font Name "Nanum" 등 — 이름을 바꾸지 않으므로 해당 없음), Noto Adobe/Google. 원문 그대로 |
| 보류한 자산 | 없음 |

### 1.4 T-081과 맞춘 계약 (수용 `msg_94e35f0564b7`)

- registry: `public/fonts/<fonts.json folder>/`의 `*.ttf|*.otf|*.woff2` **정확히 1개**(0개·2개 이상이면 설치 안 됨 + 이유), 라이선스 이름 `OFL.txt` 고정 + 전체 본문 검사. Pretendard는 `public/fonts/` 바로 아래 같은 규칙.
- URL: `/fonts/<folder>/` + `encodeURIComponent(파일명)` — Noto 파일 이름의 `[wght]` 때문.
- 굵기는 fonts.json `weights`를 믿고 registry는 fvar를 다시 재지 않는다(1.3 확인값이 근거).
- 큰 글꼴 때문에 미리보기 글꼴 대기 시간은 글꼴별 20초, 넘으면 "확인 전"(T-081 결정).
- 묶음(D-8, 코딩 담당): 쓰인 글꼴 = `fonts/<folder>/<원래 이름>`, 라이선스 = `LICENSES/<folder>-OFL.txt`. 기존 r1 묶음은 그대로.

### 1.5 알아 둘 점

- **글꼴 안 이름과 fonts.json 이름이 다른 것:** Nanum Pen Script 파일 안 이름(nameID 1)은 "Nanum Pen", Noto 2종은 nameID 1이 "Noto Sans KR Thin"·"Noto Serif KR ExtraLight"(대표 이름 nameID 16은 "Noto Sans KR"·"Noto Serif KR"). 앱은 `FontFace("<fonts.json 이름>", url)`로 등록하므로 동작에는 영향 없음 — 시스템에 설치된 글꼴 이름에 기대지 말 것(T-081 참고).
- **줄 끝:** 배포 `OFL.txt`는 LF만. 저장소 blob은 원문과 같지만 이 PC 설정(core.autocrlf=true)에서 새로 checkout하면 작업 폴더 사본이 CRLF가 될 수 있다(Pretendard OFL.txt와 같은 상황). `SOURCE.md`의 SHA-256은 **배포 원문(LF)** 값이다. 글꼴 파일은 이진이라 바뀌지 않는다. 라이선스 본문 검사는 공백을 정리하므로 영향 없음.
- **크기:** Noto Serif KR(가사 기본 글꼴) 23.8MB를 미리보기가 처음 읽을 때 느릴 수 있다. 부분 글꼴·woff2 변환은 새 도구·의존성이 필요해 하지 않았다. 필요하면 후속 판단.

---

## 2. spec·DESIGN 정합 (T-080 12장, 적용함)

### 2.1 `docs/spec/text-presets.json` → specVersion **2026-11-16.2**

| 위치 | 바꾼 내용 |
|---|---|
| `units.fontSize` | 지금 컴포지션은 짧은 변 1080이라 값 = px, P1 값과 같은 크기라 **다시 계산하지 않음** 덧붙임 |
| `units.strokeWidth` | "글자 획 **바깥으로 보이는 두께**", box의 외곽선 두께와 같은 값 |
| `units.letterSpacing` (새) | fontSize와 같은 기준 px, **em 아님** |
| `units.backgroundPadding` (새) | 띠 paddingX·Y·radius도 같은 기준 px |
| `units.existingValues` (새) | P2-3 이전 경로는 letterSpacing 0·stroke null·background null만 썼고, 뜻을 정해도 저장값은 바꾸지 않음 |
| `safeArea.rule` 끝 문장 | 비율 버튼 = 미리보기 전용(저장 위치·비율 불변, 경고는 저장 비율 기준), "위치 확인 필요"는 안으로 옮기기를 누른 글자에만 화면에서·저장하면 사라짐, 실제 비율 바꾸기는 후속 |
| `textFit` | 검수 '글자 잘림' 자동 근거는 P2-4 렌더에서(D-2), P2-3은 안내 문구만 |
| 표기 `rules` | **위치만**, 시간은 처음부터 끝까지 고정(줄일 수 없음), 필수 표기 지울 수 없음, 표기 프리셋 모양은 **새로 만드는 표기에만**(D-4), 저장된 표기 값은 그대로 |
| 표기 `fixedTexts.isAd` | `["광고","유료 광고 포함"]` → **`["광고"]`**, `fixedTextsNote`에 뺀 이유와 P5 재검토 |

- 숫자 값(크기·색·위치·안전 영역·움직임)은 하나도 바꾸지 않았다. 코드가 읽는 곳(`lib/edit/preview.ts` SAFE_AREA, `lib/edit/presets.ts` — T-081 작업 중 파일, 0005는 주석만)에 영향 없음: `tests/p2-2-preview.test.ts` 13개 통과(spec safeArea 대조 포함).

### 2.2 `docs/DESIGN.md` 6.8·10장 (v1.4 보완 기록 추가)

| 위치 | 바꾼 내용 |
|---|---|
| 6.8 비율 전환 | 미리보기 전용(P2-2 구현 문구), 위치 확인 필요 조건, 실제 비율 바꾸기 후속 |
| 6.8 표기 글자 | 문구 "광고", 위치만, 시간 고정, 필수 표기 지울 수 없음 + 이유, ConfirmPanel은 필수 아닌 잠긴 글자가 생길 때, 새 표기만 프리셋 |
| 6.8 저장 | 명시 저장, 저장하지 않은 변경·변경 취소·떠날 때 확인, 자동 저장 없음, 버전 목록 별도 |
| 6.8 휴대폰 | 지금 안내 문구 1개, 목록 + 고른 글자 문구만, 경고는 글로만 |
| 10장 P2 | 위치 확인 필요 조건 · 필수 표기 지우기 불가·시간 고정·문구 수정 불가 |

---

## 3. 하지 않은 것·남은 것

- **fonts.json**은 이번 허용 범위 밖이라 그대로다. 변경안(다음 배정 때): `verified`에 "2026-11-16 T-082 — 7종 google/fonts `cc39c4c` 설치, 형식·굵기·OFL 본문 확인" 추가, Pretendard 외 `folderNote` 없음 그대로.
- 브라우저에서 각 글꼴이 실제로 그려지는지·줄 수 실측(T-080 A-4·A-6)은 **T-081 구현 뒤** 확인. 이 보고는 파일·라이선스·문서 검증만이다.
- 묶음에 글꼴·라이선스를 넣는 코드(D-8)는 코딩 담당.
- 실제 휴대폰·화면 읽기 프로그램 확인 없음.
