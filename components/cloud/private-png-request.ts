import { v7 } from "uuid";

export function createPrivatePngUpload() {
  const selections = new WeakMap<File, { note: string; key: string; id?: string }>();
  return async function upload(file: File, rightsNote = "") {
    const note = rightsNote.trim();
    if (note.length > 500 || note.includes("\0")) throw new Error("권리 메모는 널 문자 없이 500자 이내로 입력해 주세요.");
    let request = selections.get(file);
    if (!request || request.note !== note) {
      request = { key: v7(), note };
      selections.set(file, request);
    }
    if (request.id) return request.id;
    const query = new URLSearchParams({ filename: file.name });
    if (note) query.set("rightsNote", note);
    const response = await fetch(`/api/assets/upload?${query}`, {
      method: "POST",
      headers: { "Idempotency-Key": request.key, "Content-Type": "image/png" },
      body: file,
    });
    const result = await response.json();
    if (response.status !== 201 || typeof result?.id !== "string" || !result.id) {
      throw new Error(typeof result?.error === "string" ? result.error : "사진을 올리지 못했어요. 다시 시도해 주세요.");
    }
    request.id = result.id;
    return result.id as string;
  };
}
