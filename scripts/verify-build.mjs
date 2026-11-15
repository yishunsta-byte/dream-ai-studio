import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const server = join(root, ".next/server");
let traces = 0;
for (const filename of readdirSync(server, { recursive:true })) {
  if (!filename.endsWith(".nft.json")) continue;
  traces++;
  const manifest = join(server,filename);
  for (const file of JSON.parse(readFileSync(manifest,"utf8")).files ?? []) {
    const path = relative(root,resolve(dirname(manifest),file)).replaceAll("\\","/");
    if (/^(?:data|storage|backups|tmp|\.tools)\//.test(path) || /^\.env/.test(path)) {
      throw new Error("운영 빌드 파일 목록에 로컬 데이터나 비밀 설정이 포함되어 중단했어요.");
    }
  }
}
if (!traces) throw new Error("운영 빌드의 파일 목록을 확인할 수 없어요.");
console.log("운영 빌드 확인: 로컬 데이터·비밀 설정 추적 없음");
