import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectUrl } from "../../app/(studio)/studio/reference-analysis/actions";

vi.mock("server-only", () => ({}));
const input = vi.hoisted(() => ({ auth: "local", headers: new Headers() }));
vi.mock("../../lib/auth/resolve", () => ({ resolveServerAuth: async () => ({ kind: input.auth }) }));
vi.mock("next/headers", () => ({ headers: async () => input.headers }));

describe("local URL form authorization", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("DREAM_PROJECT_READ_BACKEND", undefined);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
    input.auth = "local";
    input.headers = new Headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each(["cloud", "unconfirmed", "cross-origin", "nonlocal host", "unapproved origin", "signed URL", "redirect"])(
    "guards the %s boundary", async mode => {
      let url = "https://tonejs.github.io/audio/salamander/A4.mp3";
      if (mode === "cloud") input.auth = "verified";
      if (mode === "cross-origin") input.headers.set("origin", "https://example.org");
      if (mode === "nonlocal host") input.headers.set("host", "work.example.org");
      if (mode === "unapproved origin") url = "https://example.org/music.mp3";
      if (mode === "signed URL") url += "?key=secret";
      const result = await inspectUrl(url, mode !== "unconfirmed");
      expect(result.error).toBeTruthy();
      if (mode === "redirect") {
        expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL(url), expect.objectContaining({
          redirect: "error", cache: "no-store", credentials: "omit",
        }));
      } else expect(fetch).not.toHaveBeenCalled();
    },
  );
});
