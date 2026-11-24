# T249 공개 승인 작품 변환 모델

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_0de41ec185e1`
- 상태: **ready_review**(Tester 독립 검수 대기)
- 바꾼 파일은 새 파일 3개뿐이에요. `works.ts`·화면·인증 파일은 손대지 않았어요.

## 1. 무엇을 만들었나
- `lib/public-showcase/published-works.ts`: 서버 안쪽의 원자료를 공개 화면 자료(`ShowcaseWork`)로 바꾸는 **순수 함수** `toPublishedWorks(records, policy)`예요.
- 결과는 `{ works, excluded: {index, reason}[], truncated }`예요. 모두 얼려서(frozen) 돌려줘요.
- 제외 이유에는 순번과 이유 코드만 남겨요. 원자료 내용은 담지 않아요.

## 2. 통과 조건(하나라도 빠지면 그 작품만 제외)
| 조건 | 규칙 | 제외 이유 |
|---|---|---|
| 원자료 모양 | 보통 객체만(배열·Date·다른 prototype 거절). 읽다가 오류가 나도 닫아요. | `invalid_record` |
| id | 공개용 짧은 이름 `^[a-z0-9](-?[a-z0-9])*`(64자 이하). 중복은 뒤쪽 제외 | `invalid_id`, `duplicate_id` |
| 발행 | `publication.state === "published"`(정확히) | `not_published` |
| 철회 | `revokedAt`이 있으면 제외 | `revoked` |
| 승인 | `approvedAt`이 시간대가 붙은 ISO 시각이고 미래가 아님 | `not_approved` |
| 공개 권리 | `rightsConfirmed === true`(문자열·1은 거절) | `rights_unconfirmed` |
| 결과물 | `artifact.state === "complete"` | `artifact_incomplete` |
| 표시 글 | 칸별 길이 제한, 빈 값·제어 문자·줄 구분 문자·메일 주소 모양 거절, 종류는 `SHOWCASE_KINDS`만 | `invalid_display` |
| 이미지 | 공개 주소 계약 + png/jpg/webp/avif, 가로·세로는 1~8192 정수 | `invalid_image` |
| 미디어 | 없으면 `null`. 있으면 video(mp4/webm)·audio(mp3/m4a/ogg/wav) + 공개 주소 계약. 틀리면 미디어만 빼지 않고 **작품째** 제외해요. | `invalid_media` |

- 통과한 작품은 승인 시각 최신순으로 정렬해요. 같으면 id 순이에요.
- 기본 24개, 1~100개까지 내보내요. 입력은 1000개까지만 봐요. 넘친 경우 `truncated`로 알려요.
- `sample`은 항상 `false`예요. 이 변환을 지나는 건 실제 승인 대상뿐이에요.

## 3. 공개 주소 계약(`publicAssetUrl`)
- **같은 사이트:** 고정 공개 경로 `/showcase/`·`/media/public/` 아래만 받아요.
  - 영문·숫자·`._-`와 `/`만 쓸 수 있어요.
  - `..`, `%`, `\`, 공백, `?`, `#`, `//`는 받지 않아요.
- **다른 출처:** 정책 `allowedOrigins`에 있는 **https 정확한 출처**만 받아요.
  - 계정·쿼리·조각이 붙은 주소는 받지 않아요. 그래서 서명 토큰이 붙은 주소는 막혀요.
  - 정규화로 모양이 바뀌는 주소(대문자 호스트, `:443`, `%` 인코딩)도 받지 않아요.
- **비공개 경로 조각:** `/sign/`·`/authenticated/`·`/private/`·`/signed/`가 들어 있으면 받지 않아요.
- **위험한 형식:** `javascript:`·`data:`·`file:`·`http:` 주소는 모두 받지 않아요.
- 정책의 출처 목록에서도 https가 아니거나 경로·계정이 붙은 값은 버려요.

## 4. 노출 방지
- 출력은 화이트리스트 11칸뿐이에요: id·title·subtitle·creator·kind·genre·format·description·image·sample·media.
- 원자료의 소유자 id·메일·저장 경로·서명 주소·내부 파일 경로·승인자 id·승인 시각·권리 표시는 출력에 없어요. 시험에서 JSON 전체를 검사해요.

## 5. 시험 `tests/public-showcase/published-works.test.ts`
- **통과하는 경우 3건:** 공개 칸만 새 객체로 옮기는지(노출 검사·얼림 포함), 허용한 CDN 출처와 미디어 없는 작품, 정렬·개수 제한·잘림
- **닫히는 경우 6건:** 발행 상태, 승인 시각(미래 포함), 권리 확인·철회, 결과물 미완료, 원자료 모양(오류를 던지는 getter 포함·오류 내용 미노출), id·중복
- **노출 방지 4건:** 표시 글(숫자가 섞인 보통 글은 통과), 이미지 주소 23종·크기, 미디어, 정책 출처
- **범위 1건:** import는 `works.ts`뿐이에요. fetch·supabase·fs·env·client 지시어가 없고 `sample: true`도 없어요.
- **결과:** `tests/public-showcase` 2파일 **28 passed (28)**(기존 neon-showcase 포함)
- tsc는 공유 `.next` 생성 파일 오류 말고는 0건이에요. 범위 eslint 0이에요.
- 고치는 중에 제어 문자 정규식에 숫자 `0·2·8·9`가 잘못 들어간 적이 있어요. 지금은 정규식을 코드값으로 만들고, 숫자가 섞인 글이 통과하는 시험으로 막아 두었어요.

## 6. 한계와 다음에 필요한 것
- 이 모델은 **발행·권한 검증 시스템이 아니에요.** 입력의 `published`·`rightsConfirmed`는 "믿을 수 있는 서버 코드가 확인한 값"이라고 가정만 해요. 그 값이 진짜인지는 이 함수가 보장하지 않아요.
- 실제로 쓰려면 다음이 필요해요(별도 승인·담당).
  1. 공개 승인 기록을 저장하는 DB 테이블과 RLS. 승인자 권한, 권리 확인 기록, 철회가 들어가야 해요.
  2. 그 기록을 읽어 이 함수에 넘기는 서버 전용 담당 코드
  3. 공개 파일을 `/media/public/`이나 허용 CDN 공개 버킷으로 복사하는 발행 작업. 비공개 저장소 서명 주소는 쓰지 않아요.
  4. 공개 메인 화면 연결(Design T250 경로와 별도)
- 지금은 DB·파일·Supabase·읽기 API·화면 어디에도 연결하지 않았어요. 실제 공개된 작품도 없어요.
