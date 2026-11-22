import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// P1-06(Tester msg_ba6fd08e4db2): 서버 컴포넌트가 "use client" 모듈에서 값(문자열 상수 등)을 가져오면 서버에서는 클라이언트 참조(함수)가 되어
// href 같은 곳에 넣었을 때 '#function(){throw Error(...)}'로 직렬화된다. 서버 컴포넌트는 "use client" 모듈에서 컴포넌트(대문자 이름)만 가져온다.
const serverComponents = ["components/admin/admin-hub.tsx", "app/admin/page.tsx", "app/admin/style-dna/page.tsx"];

function clientModule(from: string, specifier: string) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return false;
  const base = specifier.startsWith("@/") ? specifier.slice(2) : `${from.slice(0, from.lastIndexOf("/"))}/${specifier.replace(/^\.\//, "")}`;
  for (const path of [`${base}.tsx`, `${base}.ts`]) {
    try { return /^\s*["']use client["']/.test(readFileSync(path, "utf8")); } catch { /* 다음 확장자 */ }
  }
  return false;
}

describe("서버·클라이언트 경계", () => {
  for (const file of serverComponents) it(`${file}는 use client 모듈에서 컴포넌트만 가져온다`, () => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/);
    for (const match of source.matchAll(/^import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];/gm)) {
      if (!clientModule(file, match[2])) continue;
      const names = match[1].split(",").map((name) => name.trim()).filter((name) => name && !name.startsWith("type "));
      expect(names.filter((name) => !/^[A-Z]/.test(name)), `${file} ← ${match[2]}`).toEqual([]);
    }
  });
  it("관리 경로 상수는 지시어 없는 공용 모듈에 있다", () => {
    expect(readFileSync("components/admin/admin-paths.ts", "utf8")).not.toMatch(/^\s*["']use (client|server)["']/m);
  });
});
