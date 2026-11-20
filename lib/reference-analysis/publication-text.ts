const sourceOrCredential = /(?:\b(?:https?:\/\/|ftp:\/\/|file:|blob:|data:|www\.)[^\s]+|\b[A-Z]:[\\/]|\b(?:AIza[A-Za-z0-9_-]{20,}|sk[-_][A-Za-z0-9_-]{16,})\b|\b[^\s@]+@[^\s@]+\.[A-Za-z]{2,}\b)/i;

export function containsNonPublicText(text: string): boolean {
  return sourceOrCredential.test(text);
}
