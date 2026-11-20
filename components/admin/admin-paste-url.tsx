"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/primitives";
import styles from "./admin-paste-url.module.css";

export const PASTE_DENIED = "자동으로 붙여넣을 수 없어요. 입력란에서 Ctrl+V 또는 ⌘V를 누르세요.";
export const PASTE_EMPTY = "클립보드에 붙여넣을 텍스트가 없어요.";

/** 주소 입력란 옆 붙여넣기 버튼. 권한이 없거나 비어 있으면 안내하고 입력란으로 초점을 돌려준다.
 *  클립보드를 기다리는 사이 입력이 바뀌거나 분석이 시작되거나 화면을 떠나면 그 붙여넣기는 무효다. */
export function PasteUrlField({ children, input, value, onPaste, noticeId, disabled = false }: {
  children: ReactNode;
  input: RefObject<HTMLInputElement | null>;
  value: string;
  onPaste: (text: string) => void;
  noticeId: string;
  disabled?: boolean;
}) {
  const [notice, setNotice] = useState<{ text: string; value: string }>();
  const attempt = useRef(0);
  // 기다리는 동안 주소가 바뀌거나(직접 편집) 분석이 시작되거나(disabled) 화면을 떠나면 늦게 온 값을 버린다.
  useEffect(() => { attempt.current += 1; }, [value, disabled]);
  useEffect(() => () => { attempt.current += 1; }, []);

  async function paste() {
    const mine = ++attempt.current;
    setNotice(undefined);
    let text: string;
    try { text = (await navigator.clipboard.readText()).trim(); }
    catch {
      if (mine !== attempt.current) return;
      setNotice({ text: PASTE_DENIED, value });
      input.current?.focus();
      return;
    }
    if (mine !== attempt.current) return;
    if (!text) setNotice({ text: PASTE_EMPTY, value });
    else if (text !== value.trim()) onPaste(text);
    input.current?.focus();
  }

  return <div className={styles.paste}>
    <div className={styles.row}>
      {children}
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => void paste()}>붙여넣기</Button>
    </div>
    <p id={noticeId} className={styles.notice} role="status">{notice?.value === value ? notice.text : ""}</p>
  </div>;
}
