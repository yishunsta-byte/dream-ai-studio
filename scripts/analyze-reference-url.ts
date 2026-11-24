import { parseArgs } from "node:util";
import { analyzeLocalMediaUrl } from "../lib/reference-analysis/local-media-url";

async function run() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    authorized: { type: "boolean" }, origin: { type: "string" },
  } });
  if (!values.authorized || positionals.length !== 1) {
    throw new Error("사용할 권리가 있는 직접 미디어 URL을 --authorized와 함께 입력하세요.");
  }
  console.log(JSON.stringify(await analyzeLocalMediaUrl(positionals[0], values.origin), null, 2));
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : "미디어 분석에 실패했습니다.");
  process.exitCode = 1;
});
