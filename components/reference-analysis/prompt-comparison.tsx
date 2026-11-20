import styles from "./studio-registered-analysis.module.css";

export function PromptComparison({ original, edited }: { original: string; edited: string }) {
  const before = Array.from(original);
  const after = Array.from(edited);
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start++;
  let end = 0;
  while (end < limit - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
  const removed = before.slice(start, before.length - end).join("");
  const added = after.slice(start, after.length - end).join("");
  return <div className={styles.comparison}>
    <h5>분석으로 생성한 초안</h5>
    <p>{original}</p>
    <p className={styles.muted}>제작자가 공개한 프롬프트는 확인되지 않았어요.</p>
    <h5>변경 내용</h5>
    {(removed || added) && <p className={styles.muted}>첫 수정부터 마지막 수정까지의 구간을 표시해요. 중간에 그대로인 문구가 포함될 수 있어요.</p>}
    {removed && <p>초안 구간 · <span>{removed}</span></p>}
    {added && <p>수정본 구간 · <strong>{added}</strong></p>}
    {!removed && !added && <p>분석 초안과 같아요.</p>}
  </div>;
}
