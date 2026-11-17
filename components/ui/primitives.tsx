import { useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { statusDisplay, type Status } from "@/lib/ui/status";
import { Icon, type IconName } from "./Icon";
import styles from "./ui.module.css";

export function Button({ variant = "primary", size = "md", loading = false, loadingLabel = "저장 중", disabledReason, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg";
  loading?: boolean; loadingLabel?: string; disabledReason?: string;
}) {
  // T-177: the shown reason is the button's description (aria-describedby), added to any description the caller gave.
  // useId is also available in Server Components (React 19 react-server build), where this file is used too.
  const reasonId = `${useId()}-reason`;
  const describedBy = [props["aria-describedby"], disabledReason && reasonId].filter(Boolean).join(" ") || undefined;
  const button = <button {...props} type={props.type ?? "button"} disabled={props.disabled || loading || !!disabledReason} aria-busy={loading || undefined} aria-describedby={describedBy} className={`${styles.button} ${styles[variant]} ${styles[size]} ${className}`}>
    {loading && <Icon name="spinner" className={styles.spin} />}{loading ? loadingLabel : children}
  </button>;
  return disabledReason ? <span className={styles.disabledGroup}>{button}<span id={reasonId} className={styles.reason}>{disabledReason}</span></span> : button;
}
export function IconButton({ label, icon, className = "", ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { label: string; icon: IconName }) {
  return <button {...props} type={props.type ?? "button"} aria-label={label} className={`${styles.iconButton} ${className}`}><Icon name={icon} /></button>;
}
export function Card({ padding = "md", tone = "default", className = "", ...props }: HTMLAttributes<HTMLDivElement> & { padding?: "none" | "md"; tone?: "default" | "danger" }) {
  return <div {...props} className={`${styles.card} ${padding === "md" ? styles.padded : ""} ${tone === "danger" ? styles.dangerBorder : ""} ${className}`} />;
}
// variant "dashed": preview-only states (T-068 1장, e.g. "미리보기 비율 16:9 · 저장 안 됨").
export function Badge({ tone = "neutral", variant = "solid", children }: { tone?: "neutral" | "accent"; variant?: "solid" | "dashed"; children: ReactNode }) {
  return <span className={`${styles.badge} ${tone === "accent" ? styles.accentBadge : ""} ${variant === "dashed" ? styles.dashedBadge : ""}`}>{children}</span>;
}
export function PhaseChip({ phase }: { phase: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 }) {
  return <span className={styles.phase} style={{ background: `var(--phase-${phase})` }}>P{phase}</span>;
}
export function StatusPill({ status, children }: { status: Status; children?: ReactNode }) {
  const state = statusDisplay[status];
  return <span className={`${styles.pill} ${styles[state.tone]}`}><Icon name={state.icon} className={status === "running" ? styles.spin : ""} />{children ?? state.label}</span>;
}
export function SampleBadge({ size = "md" }: { size?: "sm" | "md" }) {
  return <span className={size === "sm" ? styles.smallBadge : undefined}><StatusPill status="sample" /></span>;
}
export function PageHeader({ title, description, chips, actions }: { title: string; description?: ReactNode; chips?: ReactNode; actions?: ReactNode }) {
  return <div className={styles.pageHeader}><div className={styles.headerText}>{chips && <div className={styles.row}>{chips}</div>}<h1>{title}</h1>{description && <div className={styles.description}>{description}</div>}</div>{actions && <div className={styles.actions}>{actions}</div>}</div>;
}
export function EmptyState({ icon = "folder", title, description, action }: { icon?: IconName; title: string; description: string; action?: ReactNode }) {
  return <div className={styles.empty}><Icon name={icon} /><h2>{title}</h2><p>{description}</p>{action}</div>;
}
export function Callout({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger"; title: string; children?: ReactNode }) {
  return <div className={`${styles.callout} ${styles[tone]}`}><Icon name={tone === "info" ? "info" : "warning"} /><div><strong>{title}</strong>{children && <div>{children}</div>}</div></div>;
}
export type Step = { key: string; label: string; state: "done" | "current" | "waiting" | "locked"; gate?: boolean; note?: string };
export function Stepper({ steps }: { steps: Step[] }) {
  return <ol className={styles.steps} aria-label="제작 단계">{steps.map((step, index) => <li key={step.key} className={`${styles.step} ${styles[step.state]}`} aria-current={step.state === "current" ? "step" : undefined}>
    <span className={styles.stepBar} /><span className={styles.row}><span className={styles.stepNumber}>{step.state === "done" ? <Icon name="check" /> : index + 1}</span>{step.label}{step.gate && <Badge tone="accent">승인</Badge>}</span><span className={styles.stepNote}>{step.state === "locked" && <Icon name="lock" />}{step.note ?? "아직 시작하지 않았어요"}</span>
  </li>)}</ol>;
}
