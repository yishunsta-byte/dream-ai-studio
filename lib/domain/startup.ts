export type StartupCheck = { id: string; label: string; status: "pass" | "warning" | "fail"; message: string };
export function canStart(checks: StartupCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.status !== "fail");
}
