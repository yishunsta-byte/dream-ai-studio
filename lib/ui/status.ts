export const statusDisplay = {
  done: { label: "완료", tone: "success", icon: "check" },
  running: { label: "만드는 중", tone: "running", icon: "spinner" },
  queued: { label: "대기", tone: "locked", icon: "clock" },
  approval: { label: "승인 대기", tone: "approval", icon: "check" },
  warning: { label: "확인 필요", tone: "warning", icon: "warning" },
  failed: { label: "실패", tone: "danger", icon: "warning" },
  canceled: { label: "취소됨", tone: "locked", icon: "close" },
  locked: { label: "잠김", tone: "locked", icon: "lock" },
  sample: { label: "샘플", tone: "sample", icon: "flask" },
} as const;
export type Status = keyof typeof statusDisplay;
