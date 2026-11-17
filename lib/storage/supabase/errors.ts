import "server-only";
export type StorageReadCode = "STORAGE_CONFIG" | "STORAGE_INPUT" | "STORAGE_OWNER" | "STORAGE_PRIVATE" | "STORAGE_NOT_FOUND" | "STORAGE_AUTH" | "STORAGE_UNAVAILABLE" | "STORAGE_INTEGRITY" | "STORAGE_TYPE" | "STORAGE_LIMIT" | "STORAGE_ABORTED" | "STORAGE_TIMEOUT" | "STORAGE_TEMP";
export class StorageReadError extends Error {
  constructor(public readonly code: StorageReadCode) { super(code); this.name = "StorageReadError"; }
}
