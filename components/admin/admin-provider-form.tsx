"use client";

import type { FormEventHandler, ReactNode } from "react";
import styles from "./admin-gemini-settings.module.css";

export function AdminProviderHeader({ name, usage, keyUrl }: { name: string; usage: string; keyUrl: string }) {
  return <div className={styles.head} data-provider-heading>
    <h4>{name} 키·모델</h4>
    <p className={styles.help}>{usage}</p>
    <a className={styles.link} href={keyUrl} target="_blank" rel="noreferrer">{name} API 키 발급 ↗</a>
  </div>;
}

export function AdminProviderForm({ label, busy, onSubmit, target, keys, models, modelId, notice, saveScope, children }: {
  label: string;
  busy: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  target: ReactNode;
  keys: ReactNode;
  models: ReactNode;
  /** 2026-11-24부터 쓰지 않는다(모델은 선택지로만 고른다). 주면 예전처럼 모델 줄 아래에 그린다. */
  modelId?: ReactNode;
  notice: ReactNode;
  saveScope?: { id: string; text: string };
  children: ReactNode;
}) {
  return <form className={`${styles.form} ${styles.providerForm}`} onSubmit={onSubmit}
    noValidate aria-label={label} aria-busy={busy || undefined}>
    <div className={styles.providerTarget} data-form-part="target">{target}</div>
    <div className={styles.providerKeys} data-form-part="keys">{keys}</div>
    <div className={styles.providerModels} data-form-part="models">{models}</div>
    {modelId && <div className={styles.providerModelId} data-form-part="model-id">{modelId}</div>}
    <div className={styles.providerNotice}>
      {notice}
      {saveScope && <p id={saveScope.id} className={styles.saveScope}>{saveScope.text}</p>}
    </div>
    <div className={styles.providerActions} data-form-part="actions">{children}</div>
  </form>;
}
