# 관리자 분석 프로그램 사용 매뉴얼

관리자 화면 맨 위 메뉴의 첫 항목은 **콘텐츠 분석기**예요. 그 뒤로 **개요**·**내 프로젝트**·**완성본 검수·게시**·**렌더 대기열**·**계정설정 및 API 연동**·**운영 연결 범위**·**사용매뉴얼**이 이어져요. 맨 오른쪽 **사용매뉴얼**에서 세 분석기 사용법, Gemini API연동, YouTube·Suno 이용 방법, 공개와 철회를 한 화면에서 볼 수 있어요.

**콘텐츠 분석기**를 열면 위쪽 메뉴 아래에 분석기 카드 세 개(**이미지 분석**·**음악 분석**·**쇼츠 분석**)와 **분석 결과 관리** 화면이 보여요. 분석기 카드는 콘텐츠 분석기와 이미지·음악·쇼츠 분석 화면에서만 보이고, 다른 메뉴에서는 숨겨져요. 카드를 누르면 해당 분석 화면이 열리고 그 화면 제목으로 초점이 가요. 공개 준비와 공개한 결과는 지금처럼 **분석 결과 관리**에서 다루고, 주소도 예전 그대로 `/admin#admin-analysis-results`예요. 예전 **콘텐츠 분석·공개** 화면은 없어졌어요. 예전 주소 `/admin#admin-reference-analysis`와 이전 이름(Style DNA) 때의 주소 `/admin#admin-style-dna`로 들어와도 **이미지 분석**이 열려요. 예전 **API연동** 주소 `/admin#admin-api-integrations`는 **계정설정 및 API 연동** 안의 **API연동** 부분을 열어요.

| 분석기·메뉴 | 하는 일 | 넣는 자료 |
| --- | --- | --- |
| **이미지 분석** | 이미지의 인물·사물·행동·맥락·구도·조명을 읽고 한국어·영어 이미지 생성 프롬프트를 만들어요. | 이미지 직접 URL 또는 이미지 파일 |
| **음악 분석** | 장르, 악기, 추정 템포, 구간 구조를 살펴보고 Suno용 프롬프트를 제안해요. | 음악 파일 |
| **쇼츠 분석** | 공개 YouTube 영상의 첫 장면, 화면 구성, 소리, 시간대별 근거를 확인하고 새 영상 연출 초안을 제안해요. | 공개 YouTube 쇼츠·시청 주소 |
| **분석 결과 관리** | **콘텐츠 분석기** 안에서 공개 준비한 결과를 확인해 공개하고, 공개한 결과를 철회해요. | 각 분석 화면의 **공개 준비** |
| **운영 연결 범위** | 아직 운영에 연결되지 않은 관리 기능을 모아 보여 줘요. | — |

다른 분석기나 메뉴로 옮기면 진행 중인 분석은 취소되고, 늦게 도착한 결과는 표시하지 않아요.

## 분석하기

세 분석 모두 Gemini 모델을 써요. 분석기를 열면 먼저 서버 설정을 확인하고, 설정이 없으면 **Gemini 서버 설정 필요**와 **API연동 보기** 링크가 나와요. **설정 다시 확인**으로 다시 조회할 수 있어요.

### 이미지 분석

1. **입력 방식**에서 **직접 URL** 또는 **파일 업로드**를 고르고 이미지를 넣어요.
2. **분석할 권리가 있으며 Gemini에 분석용 이미지 사본을 보내는 데 동의해요**에 체크하고 **이미지 분석 실행**을 눌러요.
3. **스타일 리포트**에서 항목별 추정·미확인 여부와 근거, **이미지 생성 프롬프트**(한국어·영어)를 확인해요. 추정은 원본과 대조해 주세요.

- 형식: PNG, JPG/JPEG, WEBP
- 파일은 최대 **4 MiB**예요. 서버 임시 공간에서 분석하고 처리 후 정리해요.
- URL은 최대 **64 MiB**의 HTTPS 직접 파일 주소예요. 지원 주소는 `interactive-examples.mdn.mozilla.net`, `mdn.github.io`, `tonejs.github.io`이고, 주소에 로그인 정보·쿼리·프래그먼트를 넣을 수 없어요. 화면의 **지원 URL**에서도 확인할 수 있어요.

### 음악 분석

1. MP3, WAV, M4A 파일을 골라요. 최대 **4 MiB**예요.
2. **이 파일을 분석할 권리가 있고, 음악 분석을 위해 Gemini에 원본 파일을 전송하는 데 동의해요**에 체크하고 **음악 의미 분석 실행**을 눌러요.
3. 장르·악기·추정 템포·구간 구조를 확인하고, **Suno 프롬프트 복사**로 제안 프롬프트를 복사할 수 있어요.

### 쇼츠 분석

1. **공개 YouTube 영상 주소**에 쇼츠 주소(`youtube.com/shorts/…`), 시청 주소(`youtube.com/watch?v=…`) 또는 `youtu.be/…` 주소를 넣어요.
2. **분석 권리를 확인했고 영상 주소를 Gemini에 보내는 데 동의해요**에 체크하고 **쇼츠 분석**을 눌러요. 주소를 바꾸면 동의가 풀려요.
3. 첫 장면, 화면 구성, 소리, 시간대별 근거와 새 영상 연출 초안을 확인해요.

Threads 등 다른 게시물 주소는 지원하지 않아요. 권한이 있는 원본 이미지나 음악은 파일로 올려 주세요.

## 공개와 철회

분석만으로는 아무것도 공개되지 않아요.

1. 각 분석 결과 아래의 **공개 준비**를 누르면 **콘텐츠 분석기**의 **분석 결과 관리**(`#admin-analysis-results`)로 이동해요. 이미지 분석은 공개할 프롬프트 언어를 고를 수 있어요.
2. **공개 준비**에서 제목(80자)·요약(600자)·생성 프롬프트(2000자)를 확인하고 고쳐요. **웹 공개 미리보기**에 공개 화면 모습이 보여요. 링크, 파일 경로, 계정 정보, API 키는 넣을 수 없어요.
3. **이 결과를 공개할 권리를 확인했고, 공개 결과 페이지에 표시하는 데 동의해요**에 체크하고 **공개하기**를 눌러요. 체크한 뒤 내용을 고치면 동의가 풀려서 다시 체크해야 해요.
4. 공개 페이지에는 제목·요약·생성 프롬프트, 매체, 공개 시각만 보여요. 원본 주소와 파일은 공개되지 않아요.
5. **공개한 분석 결과** 목록에서 **공개 철회**를 누르고 **공개 철회 확인**을 누르면 철회돼요. **목록 새로고침**으로 최신 상태를 다시 읽어요.

공개가 연결 문제로 실패하면 같은 요청으로 다시 시도해요. 같은 공개 요청이 다른 내용으로 이미 처리됐다는 안내가 나오면 목록을 확인한 뒤 다시 동의하고 공개해요. 로그인이 끝나면 공개·철회 버튼 대신 다시 로그인하라는 안내가 나와요.

## API 연동

**계정설정 및 API 연동**의 **API연동**에서 **API 응답 확인**을 누르면 세 프로그램의 Gemini 서버 설정 상태(**서버 설정 확인** 또는 **Gemini 서버 설정 필요**)를 한 번에 조회해요. 모델 응답은 각 분석 화면에서 확인해요.

Gemini를 연결하려면 Google AI Studio에서 Gemini API 키를 준비하고, Vercel 프로젝트 환경 변수에 아래 이름으로 키와 모델 ID를 넣은 뒤 새로 배포해요. 키 값은 서버 환경 변수에만 두고 화면·문서·저장소에 적지 않아요.

| 분석기 | 환경 변수 |
| --- | --- |
| 이미지 분석 | `DREAM_REFERENCE_GEMINI_API_KEY`, `DREAM_REFERENCE_GEMINI_MODEL` |
| 음악 분석 | `DREAM_MUSIC_SEMANTIC_GEMINI_API_KEY`, `DREAM_MUSIC_SEMANTIC_GEMINI_MODEL` |
| 쇼츠 분석 | `DREAM_REFERENCE_GEMINI_API_KEY`, `DREAM_REFERENCE_SHORTS_GEMINI_MODEL` |

| 작업 | 메서드와 경로 | 요청 |
| --- | --- | --- |
| 설정 확인 | `GET /api/admin/reference-analysis`, `GET /api/admin/music-semantic`, `GET /api/admin/shorts-analysis` | 관리자 세션. 응답 `{ "semantic": { "image" \| "music" \| "shorts": "configured" \| "not_configured" } }` |
| 이미지 분석 URL | `POST /api/admin/reference-analysis` | JSON `{ "url": "…", "authorized": true, "media": "image", "semantic": "image" }` |
| 이미지 분석 파일 | `POST /api/admin/reference-analysis` | `application/octet-stream` 본문, `x-dream-media: image`, `x-dream-semantic: image`, `x-dream-filename: encodeURIComponent(file.name)` 헤더 |
| 음악 분석 | `POST /api/admin/music-semantic` | `application/octet-stream` 본문, `x-dream-filename`, `x-dream-music-external-consent: true` 헤더 |
| 쇼츠 분석 | `POST /api/admin/shorts-analysis` | JSON `{ "url": "…", "authorized": true }` |
| 공개 목록 | `GET /api/admin/reference-publications` | 관리자 세션 |
| 공개 | `POST /api/admin/reference-publications` | JSON `{ "id", "title", "summary", "prompt", "media", "authorized": true }`. `id`는 요청마다 만든 UUID이고 재시도에는 같은 값을 써요. |
| 철회 | `DELETE /api/admin/reference-publications` | JSON `{ "id" }` |

모든 쓰기 요청은 관리자 세션과 현재 페이지와 같은 요청 출처가 필요해요. `reference-analysis`는 화면에서 이미지에만 쓰지만 API는 `media` 값으로 `image`, `music`, `video`를 받아요.

- `400 invalid_input`은 입력 값이 잘못된 상태예요. `400 invalid_file`은 파일 이름이나 본문을 확인해야 해요.
- `400 invalid_publication`은 공개 글자 수를 넘었거나 링크·파일 경로·계정 정보·API 키가 들어간 상태예요.
- `401`·`403`은 다시 로그인하거나 관리자 권한이 필요한 상태예요.
- `404 not_found`는 이 계정에서 철회할 공개 결과를 찾을 수 없는 상태예요. 이미 철회한 결과에 같은 요청을 보내면 성공으로 처리해요.
- `409 publication_conflict`는 같은 공개 ID가 다른 내용으로 이미 처리된 상태예요. 새로 동의하면 새 ID로 보내요.
- `413 too_large`는 직접 업로드 한도 초과예요.
- `422 unsupported_format`과 `file_type_mismatch`는 지원 형식이나 실제 파일 내용을 확인해야 해요. `422 invalid_file`은 파일이 손상됐거나 읽을 수 없는 상태예요. `422 analysis_failed`의 `detail`이 `timed_out`이면 시간 초과, `cancelled`이면 취소예요.
- `429 analysis_busy`는 다른 분석이 진행 중인 상태예요. 앞선 분석이 끝난 뒤 다시 시도해요.
- 쇼츠 분석은 `503 not_configured`(설정 없음), `502 provider_error`·`invalid_response`(모델 응답 문제), `504 timed_out`(시간 초과)도 돌려줘요.

4 MiB 직접 업로드 한도는 배포 환경이 허용하는 요청 본문 크기 4.5 MB 이내에 맞췄어요. [Vercel Functions 제한](https://vercel.com/docs/functions/limitations#request-body-size)
