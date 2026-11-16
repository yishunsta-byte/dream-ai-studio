// Human file sizes for the screens (decimal units, like the file explorer's "MB" reading for small bundles).
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${bytes}바이트`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1000, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10}${units[unit]}`;
}
export function formatExactBytes(bytes: number) {
  return `${bytes.toLocaleString("ko-KR")}바이트`;
}
