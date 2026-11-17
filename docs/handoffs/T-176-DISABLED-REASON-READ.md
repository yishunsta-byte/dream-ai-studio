# T-176 막힌 버튼과 이유 연결 점검 (T126 C1, 읽기만)

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_3a4d4f3bc416 · 범위 msg_3a2341890b3e "T126 C1 disabled Button 이유 연결만 읽기"
- 기준 HEAD `fdbc9d1`
- 바꾼 파일: 이 보고서뿐이에요. 제품 코드·시험·공용 문서는 바꾸지 않았어요.
- 화면 마크업 확인용 로컬 스크립트는 `tmp/t176/`에 두었고 커밋하지 않아요.
- 실제 화면 읽기 프로그램이나 브라우저 접근성 트리는 확인하지 않았어요.

## 1. 현재 구현 (확인)
공용 `Button`(`components/ui/primitives.tsx:6-13`)은 `disabledReason`이 있으면 다음처럼 동작해요.
- 버튼에 **native `disabled`**를 걸어요(`disabled={props.disabled || loading || !!disabledReason}`).
- 이유는 **버튼 다음의 형제 `<span class=reason>`**으로 화면에 보여요.
- **id도 `aria-describedby`도 없어요.** 버튼과 이유를 이어 주는 연결이 없어요.

실제 렌더 결과(`renderToStaticMarkup`, 이번 실행):

```html
<span class="_disabledGroup_…"><button type="button" disabled="" class="…">영상 만들기</button><span class="_reason_…">편집에서 저장하지 않은 변경이 있어요. 영상은 저장한 타임라인으로만 만들어요.</span></span>
```

(편집 머리의 `RenderEntry` dirty 상태. 일반 `Button disabledReason`도 같은 모양이에요.)

**그래서 생기는 일** (코드에서 읽은 것이고, 실제 낭독기로 재현하지는 않았어요)
- native disabled 버튼은 Tab 순서에서 빠져요. 키보드 사용자는 버튼에 초점을 둘 수 없어요.
- 이유도 초점을 받지 않는 일반 글이라, Tab만으로는 "왜 막혔는지"를 만나지 못해요.
- 화면 읽기 프로그램의 읽기 모드에서는 "흐린 버튼 → 다음 줄 이유" 순서로 읽힐 수 있어요. 다만 프로그램이 버튼의 **설명(description)으로 연결해 주지는 않아요.**
- `loading`만 있을 때(이유 없음)는 `aria-busy`와 "저장 중" 같은 이름이 있어서 이번 문제와는 별개예요.

## 2. 영향 범위 (`disabledReason` 사용처 14곳, 9파일)

| 파일 | 버튼 |
|---|---|
| `components/render-panel/entry.tsx:7` | 편집 머리 "영상 만들기"(dirty) — **T123 C1 지적 지점** |
| `components/render-panel/render-panel.tsx:71` | "영상 만들기"(막는 이유 요약) — **T123 C1 지적 지점**. 자세한 막는 이유 목록은 같은 카드에 따로 있어요 |
| `components/editing-panel.tsx:137,138,162` | 변경 취소 · 저장 · 편집 완료 |
| `components/audio-editor/audio-editor.tsx:54,75,169,188` | 원본 듣기 · 넣기 · 이대로 연결 · 라이선스 메모 |
| `components/exports-panel.tsx:50` | 묶음 만들기 |
| `components/production-panel.tsx:45,48` | 확인 · 제작 완료 |
| `components/settings-panel.tsx:36,40` | 백업 폴더 · 복원 검사 |

- 모두 같은 공용 Button을 거쳐요. **렌더 한 곳만 고치면 나머지 13곳과 동작이 달라져요**(T123의 "렌더 한 곳만 임의 패치하지 않음" 권고와 같아요).
- `primitives.tsx`에는 `"use client"`가 없어요. 서버 컴포넌트 페이지(예: `app/(studio)/projects/[id]/render/page.tsx` 등 10곳)도 이 파일을 가져다 써요.

## 3. 고칠 방법 (추천 순서, 이번에는 구현하지 않음)

| 안 | 내용 | 장점 | 주의 |
|---|---|---|---|
| **A(추천, 최소)** | 공용 Button에서 이유 `span`에 id를 주고 버튼에 `aria-describedby`로 연결. 사용처는 바꾸지 않아요 | 14곳이 한 번에 같은 규칙. 클릭·Tab 동작 변화 없음 | 서버 컴포넌트에서 쓰는 파일이라 `useId`를 쓸 수 있는지 먼저 확인해야 해요. 안 되면 이유가 있을 때만 작은 client 하위 컴포넌트로 나누기. 버튼이 Tab에서 빠지는 문제는 그대로 남아요 |
| B(행동 변경) | native `disabled` 대신 `aria-disabled="true"`로 두고 초점은 받게 하되, 클릭·Enter·submit은 막기 | Tab으로 버튼에 가서 이름과 이유를 함께 들을 수 있음 | 14곳의 클릭·form submit(`editing-panel` 저장은 `type=submit`)·스타일·기존 시험 기대값(`disabled=""`)이 바뀌어요. 디자인·Master 결정이 필요한 범위예요 |

**A 완료 조건(제안)**
- 정적 마크업 시험: `disabledReason`이 있는 모든 Button에서 `aria-describedby`가 같은 문서 안의 이유 요소 id와 같고, 이유가 없으면 속성이 없어요.
- 관련 패널 시험(render-panel, editing, audio-editor, exports, settings)이 그대로 통과해요.
- 실제 브라우저 접근성 트리에서 "영상 만들기" 버튼의 description이 이유 문장이에요(1280/390 각 1회).
- 실제 화면 읽기 프로그램 확인은 따로 표시해요(자동 PASS로 쓰지 않음).

## 4. 판정
- **C1은 현재 코드에 그대로 남아 있어요.** T123·T126에 적힌 그대로이고, 새로 생긴 결함은 아니에요.
- 이유가 화면에 보이지 않는 것은 아니에요. 문제는 보조 기술에서 버튼과 이유가 이어지지 않는 연결과 키보드 접근이에요.
- 수정 담당과 A·B 선택은 Master가 정해요.
