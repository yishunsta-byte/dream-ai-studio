// detail: extra lines (e.g. a kept copy, the next step); code: a short failure code shown in small type.
export type StartupCheck = { id: string; label: string; status: "pass" | "warning" | "fail"; message: string; detail?: string[]; code?: string };
export function canStart(checks: StartupCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.status !== "fail");
}
