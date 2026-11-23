"use client";

import styles from "./admin-gemini-settings.module.css";

export function AdminModelOptions({ name, label, options, value, onChange }: {
  name: string;
  label: string;
  options: readonly string[];
  value: string;
  onChange: (model: string) => void;
}) {
  return <div role="group" aria-label={label} className={styles.modelOptions}>
    {options.map(model => <label key={model} className={styles.modelOption}>
      <input type="radio" name={name} value={model} checked={value === model}
        onChange={() => onChange(model)} />
      <span>{model}</span>
    </label>)}
  </div>;
}
