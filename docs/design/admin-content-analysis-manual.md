# 관리자 콘텐츠 프롬프트 분석기 사용 매뉴얼

## 분석하기

1. 관리자 화면의 **내 프로젝트** 또는 **콘텐츠 분석·공개**를 열어요.
2. **URL 주소** 또는 **파일 업로드**를 선택한 뒤 **이미지**, **음악**, **영상** 중에서 해당하는 항목을 골라요.
3. 분석 권한이 있는 자료의 주소나 파일을 넣고 **권리 확인하고 분석**을 눌러요.
4. 분석 근거와 생성 프롬프트를 확인해요. 결과를 공개하려면 공개할 항목의 제목·요약·프롬프트를 확인하고 공개에 동의해요. 공개한 목록에서 철회할 수 있어요.

| 매체 | 지원 형식 | 확인할 수 있는 내용 |
| --- | --- | --- |
| 이미지 | PNG, JPG/JPEG, WEBP | 영역별 색상 팔레트와 밝기 분포 |
| 음악 | MP3, WAV, M4A · 24초까지 | 채널, 구간별 음량, 근거를 확보한 구간의 박자 추정 |
| 영상 | MP4, MOV, WEBM · 20초 및 240프레임까지 | 프레임 시각, 장면 전환 후보, 생성용 프롬프트 |

- 파일 업로드는 최대 **4 MiB**예요. 파일을 서버 임시 공간에서 분석하고 처리 후 정리해요. 공개 화면에는 선택한 결과의 제목·요약·프롬프트가 표시돼요.
- URL은 **최대 64 MiB**의 HTTPS 직접 파일 주소를 입력해요. 허용 도메인은 `interactive-examples.mdn.mozilla.net`, `mdn.github.io`, `tonejs.github.io`이고 주소에 로그인 정보, 쿼리, 프래그먼트를 포함할 수 없어요.
- Threads 등 게시물 주소를 가진 경우 권한이 있는 원본 미디어를 직접 업로드해요.
- 영상·음악 형식이 맞아도 분석에 필요한 트랙이나 시간 정보를 확인하기 어려운 파일은 거부할 수 있어요.

## API 연동

관리자 화면의 **API 연동**에서 **API 응답 확인**을 누르면 분석 POST 경로와 공개 목록 조회 응답을 확인할 수 있어요.

| 작업 | 메서드와 경로 | 요청 |
| --- | --- | --- |
| URL 분석 | `POST /api/admin/reference-analysis` | JSON `{ "url": "…", "authorized": true, "media": "image" }`. `media`는 생략할 수 있어요. |
| 파일 분석 | `POST /api/admin/reference-analysis` | `application/octet-stream` 본문, `x-dream-media`와 `x-dream-filename: encodeURIComponent(file.name)` 헤더 |
| 공개 목록 | `GET /api/admin/reference-publications` | 관리자 세션 |
| 공개와 철회 | `POST` 또는 `DELETE /api/admin/reference-publications` | 공개는 선택한 결과와 명시 동의, 철회는 해당 결과 ID |

두 분석 요청 모두 관리자 세션과 현재 페이지와 동일한 요청 출처가 필요해요. 매체 값은 `image`, `music`, `video` 중 하나예요. 성공 응답은 `{ result: { schemaVersion, status, media, proposals } }`예요.

- `400 invalid_input`은 매체 값이 잘못된 상태예요. `400 invalid_file`은 파일 이름이나 본문을 확인해야 해요.
- `413 too_large`는 직접 업로드 한도 초과예요.
- `422 unsupported_format`과 `file_type_mismatch`는 지원 형식이나 선택한 매체와 실제 파일 내용을 확인해야 해요. `422 invalid_file`은 파일이 손상됐거나 읽을 수 없는 상태예요.
- `429 analysis_busy`는 분석이 진행 중인 상태예요. 앞선 분석이 끝난 뒤 다시 시도해요.

4 MiB 직접 업로드 한도는 배포 환경이 허용하는 요청 본문 크기 4.5 MB 이내에 맞췄어요. [Vercel Functions 제한](https://vercel.com/docs/functions/limitations#request-body-size)
