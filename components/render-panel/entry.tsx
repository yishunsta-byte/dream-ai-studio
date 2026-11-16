// "영상 만들기" entry in the edit header (T-102 4장). An unsaved draft blocks it: renders use the saved timeline only.
import Link from "next/link";
import { Button } from "../ui/primitives";
import styles from "./render-panel.module.css";

export function RenderEntry({projectId,dirty}:{projectId:string;dirty:boolean}){
  return dirty?<Button type="button" variant="secondary" disabledReason="편집에서 저장하지 않은 변경이 있어요. 영상은 저장한 타임라인으로만 만들어요.">영상 만들기</Button>
    :<Link className={styles.entry} href={`/projects/${projectId}/render`}>영상 만들기</Link>;
}
