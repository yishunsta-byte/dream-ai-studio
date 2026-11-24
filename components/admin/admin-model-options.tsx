"use client";

import type { Ref } from "react";
import styles from "./admin-gemini-settings.module.css";

// 주인님 지시(2026-11-24): API연동 카드의 '저장된 모델 · 모델 ID 직접 입력' 칸을 없애고 이 선택지로만 고른다.
// 저장된 모델이 목록에 없으면(예전에 직접 입력한 값) 선택지 끝에 그대로 보여 선택된 상태를 잃지 않는다.
// id·inputRef는 선택된(없으면 첫) 선택지에 붙여, 모델 오류가 나면 그 선택지로 초점을 옮길 수 있게 한다.
export function AdminModelOptions({ name, label, options, value, onChange, id, inputRef, invalid, describedBy }: {
  name: string;
  label: string;
  options: readonly string[];
  value: string;
  onChange: (model: string) => void;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
  describedBy?: string;
}) {
  const saved = value.trim();
  const shown = saved && !options.includes(saved) ? [...options, saved] : options;
  const anchor = shown.includes(value) ? value : shown[0];
  return <div role="group" aria-label={label} className={styles.modelOptions} aria-invalid={invalid || undefined} aria-describedby={describedBy}>
    {shown.map(model => <label key={model} className={styles.modelOption}>
      <input type="radio" name={name} value={model} checked={value === model}
        id={model === anchor ? id : undefined} ref={model === anchor ? inputRef : undefined}
        onChange={() => onChange(model)} />
      <span>{model}</span>
    </label>)}
  </div>;
}
