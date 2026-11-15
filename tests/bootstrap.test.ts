import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("unimplemented infrastructure commands", () => {
  it.each(["worker"])("%s fails explicitly instead of reporting success", (command) => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/pending.mjs", import.meta.url)), command], { encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("아직 구현되지 않았습니다");
    expect(result.stdout).toBe("");
  });
});
