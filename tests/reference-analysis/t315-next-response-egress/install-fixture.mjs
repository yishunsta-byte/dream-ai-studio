/* global console, process */
// T315 시험 파일 5개를 격리 사본에 설치한다. 사용: node install-fixture.mjs <격리 사본 루트>
// T315-F1 방어 규칙(쓰기 전에 전부 검사하고, 하나라도 걸리면 아무것도 쓰지 않는다):
//  1) 루트: 존재하는 일반 디렉터리여야 한다(심볼릭 링크·정션 거절). 실제 경로(realpath)를 기준으로 삼는다.
//  2) Git 작업 트리 거절: 실제 루트와 그 모든 상위 폴더에 .git(폴더·파일)이 있으면 거절한다.
//  3) Next 앱 모양: package.json(일반 파일)과 app(일반 디렉터리)이 있어야 한다.
//  4) 원본: 5개 .fixture 가 일반 파일이고 SHA256SUMS 와 해시가 같아야 한다(LF 정규화).
//  5) 목적지: 루트부터 각 목적지까지 이미 있는 중간 폴더는 모두 일반 디렉터리이고 실제 경로가 루트 아래 그 위치여야 한다.
//     목적지 자체는 어떤 형태로도(파일·폴더·링크·끊어진 링크) 있으면 안 된다. 5개 전부 검사한 뒤에만 쓴다.
//  6) 쓰기: 폴더는 하나씩 만들며 기록하고 파일은 wx로 쓴다. 쓴 뒤 실제 경로·해시를 다시 확인한다.
//     도중 실패하면 이 호출이 만든 파일(해시가 같을 때만)과 폴더(비었을 때만)만 역순으로 지우고 실패로 끝낸다.
//  시험용 실패 주입(회귀 시험 전용): T315_INSTALL_FAIL_AFTER=<n> 은 n개를 쓴 뒤 실패,
//  T315_INSTALL_FAIL_DURING_WRITE=<n> 은 n번째 파일을 배타 생성하고 절반만 쓴 뒤 실패,
//  여기에 T315_INSTALL_REPLACE_BEFORE_ROLLBACK=1 을 더하면 실패 직전 그 경로를 다른 파일로 바꾼다(보존 확인용).
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = [
  "lib/t315/gate.ts",
  "app/api/t315-control/route.ts",
  "app/api/t315/[kind]/route.ts",
  "app/t315/page/page.tsx",
  "app/t315/suspense/page.tsx",
];
export const read = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
export function manifest(dir = here) {
  return Object.fromEntries(read(join(dir, "SHA256SUMS")).trim().split("\n").map((line) => {
    const [hash, name] = line.split(/\s+/);
    return [name, hash];
  }));
}

class Refused extends Error {}
const refuse = (message) => { throw new Refused(message); };
const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
function info(path) {
  try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
const isLink = (stat) => stat.isSymbolicLink();

/** 쓰기 전 전체 검사. 통과하면 설치 계획(원본 내용·목적지·만들 폴더)을 돌려준다. */
export function plan(rootArg, sourceDir = here) {
  if (!rootArg) refuse("usage: node install-fixture.mjs <isolated-copy-root>");
  const given = resolve(rootArg);
  const rootStat = info(given);
  if (!rootStat) refuse("root does not exist");
  if (isLink(rootStat)) refuse("root is a symbolic link or junction");
  if (!rootStat.isDirectory()) refuse("root is not a directory");
  const root = realpathSync.native(given);
  for (let dir = root; ; dir = dirname(dir)) {
    if (info(join(dir, ".git"))) refuse(`git working tree detected at ${dir === root ? "root" : "an ancestor of root"}`);
    if (dir === parse(dir).root) break;
  }
  const pkg = info(join(root, "package.json"));
  const app = info(join(root, "app"));
  if (!pkg || !pkg.isFile() || isLink(pkg)) refuse("package.json must be a regular file");
  if (!app || !app.isDirectory() || isLink(app)) refuse("app must be a regular directory");

  const sums = manifest(sourceDir);
  const items = [];
  const toCreate = [];
  for (const target of FIXTURES) {
    const source = join(sourceDir, "fixture", `${target}.fixture`);
    const sourceStat = info(source);
    if (!sourceStat || !sourceStat.isFile() || isLink(sourceStat)) refuse(`fixture is not a regular file: ${target}`);
    const text = read(source);
    if (sha256(text) !== sums[`fixture/${target}.fixture`]) refuse(`hash mismatch: ${target}`);
    const destination = join(root, ...target.split("/"));
    if (!destination.startsWith(root + sep)) refuse(`destination escapes root: ${target}`);
    // 중간 폴더 검사: 있으면 일반 디렉터리 + 실제 경로 일치, 없으면 만들 목록에 넣는다.
    const parts = target.split("/").slice(0, -1);
    let dir = root;
    for (const part of parts) {
      dir = join(dir, part);
      const stat = info(dir);
      if (!stat) { if (!toCreate.some((p) => same(p, dir))) toCreate.push(dir); continue; }
      if (isLink(stat)) refuse(`link or junction in destination path: ${relative(root, dir)}`);
      if (!stat.isDirectory()) refuse(`not a directory in destination path: ${relative(root, dir)}`);
      if (!same(realpathSync.native(dir), dir)) refuse(`destination path resolves elsewhere: ${relative(root, dir)}`);
    }
    if (info(destination)) refuse(`already exists: ${target}`);
    items.push({ target, text, hash: sha256(text), destination });
  }
  return { root, items, toCreate };
}

/** 계획대로 설치. 실패하면 이 호출이 만든 것만 되돌린다.
 *  T315-F2: 목적지는 openSync(wx)로 배타 생성하고, 생성 직후(데이터 쓰기 전)부터 이 호출의 파일로 추적한다.
 *  추적 정보는 fstat의 dev·ino(bigint)다. 되돌릴 때 같은 경로가 여전히 같은 파일(dev·ino 일치)일 때만 지운다.
 *  내용이 부분적이어도 지운다(우리가 만든 파일이므로). 다른 파일로 바뀌었으면 보존하고 남은 항목으로 보고한다.
 *  원래 오류 객체·메시지를 그대로 던지고 정리 결과만 덧붙인다. */
export function install({ root, items, toCreate }) {
  const createdDirs = [];
  const createdFiles = [];
  const env = process.env;
  const failAfter = env.T315_INSTALL_FAIL_AFTER === undefined ? Infinity : Number(env.T315_INSTALL_FAIL_AFTER);
  const failDuring = env.T315_INSTALL_FAIL_DURING_WRITE === undefined ? 0 : Number(env.T315_INSTALL_FAIL_DURING_WRITE);
  try {
    for (const dir of toCreate) {
      if (info(dir)) refuse(`appeared during install: ${relative(root, dir)}`);
      mkdirSync(dir);
      createdDirs.push(dir);
    }
    for (const item of items) {
      if (createdFiles.length >= failAfter) throw new Error("injected failure (T315_INSTALL_FAIL_AFTER)");
      const fd = openSync(item.destination, "wx");
      const { dev, ino } = fstatSync(fd, { bigint: true });
      const owned = { item, fd, dev, ino };
      createdFiles.push(owned); // 데이터 쓰기 전부터 이 호출의 파일
      const bytes = Buffer.from(item.text, "utf8");
      if (failDuring === createdFiles.length) {
        writeSync(fd, bytes, 0, Math.floor(bytes.length / 2));
        if (env.T315_INSTALL_REPLACE_BEFORE_ROLLBACK === "1") {
          closeSync(fd); owned.fd = null;
          unlinkSync(item.destination);
          writeFileSync(item.destination, "foreign replacement\n", { flag: "wx" });
        }
        throw new Error("injected write failure (T315_INSTALL_FAIL_DURING_WRITE)");
      }
      for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      closeSync(fd); owned.fd = null;
      const real = realpathSync.native(item.destination);
      if (!same(real, item.destination) || sha256(read(real)) !== item.hash) refuse(`post-write verification failed: ${item.target}`);
    }
    return createdFiles.map(({ item }) => `${item.target} ${item.hash.slice(0, 12)}`);
  } catch (error) {
    const leftovers = [];
    for (const owned of createdFiles.reverse()) {
      try {
        if (owned.fd !== null) { closeSync(owned.fd); owned.fd = null; }
        let current = null;
        try { current = lstatSync(owned.item.destination, { bigint: true }); } catch (missing) { if (missing.code !== "ENOENT") throw missing; }
        if (!current) continue;
        if (!current.isSymbolicLink() && current.isFile() && current.dev === owned.dev && current.ino === owned.ino) unlinkSync(owned.item.destination);
        else leftovers.push(`${owned.item.target} (replaced, preserved)`);
      } catch { leftovers.push(owned.item.target); }
    }
    for (const dir of createdDirs.reverse()) {
      try { rmdirSync(dir); } catch { leftovers.push(relative(root, dir)); }
    }
    error.message += leftovers.length ? ` (rollback left: ${leftovers.join(", ")})` : " (rolled back this call's changes)";
    throw error;
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && same(realpathSync.native(resolve(process.argv[1])), realpathSync.native(fileURLToPath(import.meta.url)))) {
  try {
    for (const line of install(plan(process.argv[2]))) console.log(`installed ${line}`);
  } catch (error) {
    console.error(`T315 install refused: ${error.message}`);
    process.exitCode = error instanceof Refused ? 2 : 1;
  }
}
