/* global console, process */
// T315-F1 설치기 회귀 시험. OS 임시 폴더 아래 새 합성 폴더에서만 실행하고 끝나면 지운다.
// 사용: node tests/reference-analysis/t315-next-response-egress/install-fixture.check.mjs
// 각 경우는 설치기를 별도 Node 프로세스로 실행해 종료 코드와 "실행 전후 합성 폴더 전체 목록"을 비교한다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES, manifest, read, sha256 } from "./install-fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const installer = join(here, "install-fixture.mjs");
const base = realpathSync.native(mkdtempSync(join(tmpdir(), "t315-install-check-")));
assert(basename(base).startsWith("t315-install-check-"));
const results = [];
let index = 0;

function snapshot(dir) {
  const out = [];
  const walk = (path, rel) => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      const stat = lstatSync(full);
      const key = rel ? `${rel}/${name}` : name;
      if (stat.isSymbolicLink()) { out.push(`${key} -> link`); continue; }
      if (stat.isDirectory()) { out.push(`${key}/`); walk(full, key); } else out.push(`${key} ${sha256(readFileSync(full, "utf8"))}`);
    }
  };
  walk(dir, "");
  return out;
}
function nextApp(parent, name = `case-${++index}`) {
  const root = join(parent, name);
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{\"name\":\"synthetic\"}\n");
  return root;
}
function run(root, env = {}, script = installer) {
  const child = spawnSync(process.execPath, [script, root], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 30_000 });
  return { code: child.status, out: `${child.stdout}${child.stderr}`.trim() };
}
function refusedUnchanged(name, root, expect, env = {}, script = installer) {
  const before = snapshot(base);
  const result = run(root, env, script);
  const after = snapshot(base);
  assert.notEqual(result.code, 0, `${name}: should fail`);
  assert.match(result.out, expect, `${name}: message`);
  assert.deepEqual(after, before, `${name}: synthetic tree changed`);
  results.push({ case: name, code: result.code, message: result.out.replace(/^T315 install refused: /, "").slice(0, 160), unchanged: true });
}

try {
  // 1) 정상 격리 사본: 5개 설치, 해시 일치, 링크 없음
  {
    const root = nextApp(base);
    const result = run(root);
    assert.equal(result.code, 0, result.out);
    const sums = manifest(here);
    for (const target of FIXTURES) {
      const path = join(root, ...target.split("/"));
      assert(!lstatSync(path).isSymbolicLink());
      assert.equal(sha256(read(path)), sums[`fixture/${target}.fixture`]);
    }
    results.push({ case: "normal-isolated-copy", code: 0, installed: result.out.split("\n").length });
    // 같은 사본에 다시 설치: 첫 목적지부터 충돌, 아무것도 안 바뀜
    refusedUnchanged("reinstall-same-copy", root, /already exists: lib\/t315\/gate\.ts/);
  }
  // 2) app 이 다른 합성 폴더로 가는 정션 → 거절, 바깥 폴더 비어 있음
  {
    const root = join(base, `case-${++index}`);
    const outside = join(base, `outside-${index}`);
    mkdirSync(root); mkdirSync(outside);
    writeFileSync(join(root, "package.json"), "{}\n");
    symlinkSync(outside, join(root, "app"), "junction");
    refusedUnchanged("app-is-junction", root, /app must be a regular directory/);
    assert.deepEqual(readdirSync(outside), []);
  }
  // 3) 중간 폴더(app/t315)가 정션 → 거절
  {
    const root = nextApp(base);
    const outside = join(base, `outside-${index}`);
    mkdirSync(outside);
    symlinkSync(outside, join(root, "app", "t315"), "junction");
    refusedUnchanged("intermediate-junction", root, /link or junction in destination path: app[\\/]t315/);
    assert.deepEqual(readdirSync(outside), []);
  }
  // 4) 루트 자체가 정션 → 거절
  {
    const real = nextApp(base);
    const link = join(base, `root-link-${index}`);
    symlinkSync(real, link, "junction");
    refusedUnchanged("root-is-junction", link, /root is a symbolic link or junction/);
  }
  // 5) Git 작업 트리: 루트에 .git 폴더, .git 파일(worktree 형식), 상위 폴더에 .git
  {
    const root = nextApp(base);
    mkdirSync(join(root, ".git"));
    refusedUnchanged("git-dir-in-root", root, /git working tree detected at root/);
    const root2 = nextApp(base);
    writeFileSync(join(root2, ".git"), "gitdir: synthetic\n");
    refusedUnchanged("git-file-in-root", root2, /git working tree detected at root/);
    const parent = join(base, `repo-${++index}`);
    mkdirSync(join(parent, ".git"), { recursive: true });
    const nested = nextApp(parent, "nested-copy");
    refusedUnchanged("git-in-ancestor", nested, /git working tree detected at an ancestor of root/);
  }
  // 6) 마지막 목적지만 이미 있음 → 쓰기 전에 거절, 앞 4개·새 폴더 없음, 기존 파일 그대로
  {
    const root = nextApp(base);
    mkdirSync(join(root, "app", "t315", "suspense"), { recursive: true });
    writeFileSync(join(root, "app", "t315", "suspense", "page.tsx"), "existing\n");
    refusedUnchanged("last-destination-exists", root, /already exists: app\/t315\/suspense\/page\.tsx/);
  }
  // 7) 목적지가 끊어진 정션 → 거절
  {
    const root = nextApp(base);
    mkdirSync(join(root, "lib", "t315"), { recursive: true });
    symlinkSync(join(base, `missing-${index}`), join(root, "lib", "t315", "gate.ts"), "junction");
    refusedUnchanged("dangling-junction-destination", root, /already exists: lib\/t315\/gate\.ts/);
  }
  // 8) 중간 경로가 파일 → 거절
  {
    const root = nextApp(base);
    writeFileSync(join(root, "lib"), "file\n");
    refusedUnchanged("intermediate-is-file", root, /not a directory in destination path: lib/);
  }
  // 9) 원본 해시 불일치(설치기·원본을 합성 폴더에 복사해 하나 변조) → 거절
  {
    const pack = join(base, `pack-${++index}`);
    cpSync(here, pack, { recursive: true, filter: (src) => !src.includes(`${join(here, "raw")}`) });
    writeFileSync(join(pack, "fixture", "app", "t315", "page", "page.tsx.fixture"), "tampered\n");
    const root = nextApp(base);
    refusedUnchanged("fixture-hash-mismatch", root, /hash mismatch: app\/t315\/page\/page\.tsx/, {}, join(pack, "install-fixture.mjs"));
  }
  // 10) Next 앱 모양 아님 / 없는 루트
  {
    const root = join(base, `case-${++index}`);
    mkdirSync(root);
    refusedUnchanged("not-next-app", root, /package\.json must be a regular file/);
    refusedUnchanged("missing-root", join(base, "does-not-exist"), /root does not exist/);
  }
  // 11) 쓰기 도중 실패(2개 쓴 뒤 주입) → 이 호출이 만든 파일·폴더만 정리, 기존 파일 보존
  {
    const root = nextApp(base);
    mkdirSync(join(root, "app", "keep"), { recursive: true });
    writeFileSync(join(root, "app", "keep", "own.txt"), "pre-existing\n");
    refusedUnchanged("injected-failure-after-2", root, /injected failure.*rolled back this call's changes/s, { T315_INSTALL_FAIL_AFTER: "2" });
  }
  // 12) T315-F2: 배타 생성 뒤 데이터 쓰기 도중 실패(부분 파일) — 기존 디렉터리 아래 목적지, 기존 파일 보존
  {
    const root = nextApp(base);
    mkdirSync(join(root, "app", "api", "t315", "[kind]"), { recursive: true });
    writeFileSync(join(root, "app", "api", "t315", "[kind]", "own.txt"), "pre-existing\n");
    refusedUnchanged("partial-write-under-existing-dir", root, /^T315 install refused: injected write failure \(T315_INSTALL_FAIL_DURING_WRITE\) \(rolled back this call's changes\)$/,
      { T315_INSTALL_FAIL_DURING_WRITE: "3" });
  }
  // 13) T315-F2: 첫 파일 쓰기 도중 실패 — 새로 만든 폴더 안 부분 파일과 폴더 모두 정리
  {
    const root = nextApp(base);
    refusedUnchanged("partial-write-first-file", root, /injected write failure.*rolled back this call's changes/s, { T315_INSTALL_FAIL_DURING_WRITE: "1" });
  }
  // 14) T315-F2: 실패 직전 그 경로가 다른 파일로 바뀜 → 그 파일은 보존·보고, 나머지(이 호출이 만든 것)만 정리
  {
    const root = nextApp(base);
    mkdirSync(join(root, "app", "api", "t315", "[kind]"), { recursive: true });
    const before = snapshot(base);
    const result = run(root, { T315_INSTALL_FAIL_DURING_WRITE: "3", T315_INSTALL_REPLACE_BEFORE_ROLLBACK: "1" });
    const after = snapshot(base);
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /injected write failure .*rollback left: app\/api\/t315\/\[kind\]\/route\.ts \(replaced, preserved\)/);
    const added = after.filter((line) => !before.includes(line));
    const removed = before.filter((line) => !after.includes(line));
    const rel = join(root, "app", "api", "t315", "[kind]", "route.ts").slice(base.length + 1).replaceAll("\\", "/");
    assert.deepEqual(removed, []);
    assert.deepEqual(added, [`${rel} ${sha256("foreign replacement\n")}`]);
    results.push({ case: "replaced-before-rollback", code: result.code, message: result.out.replace(/^T315 install refused: /, "").slice(0, 160), onlyForeignFileRemains: true });
  }
  console.log(JSON.stringify({ passed: results.length, results }, null, 1));
} finally {
  rmSync(base, { recursive: true, force: true });
  assert.throws(() => lstatSync(base), { code: "ENOENT" });
  console.log("synthetic temp removed");
}
