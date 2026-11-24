/* global process, console */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function verifyAdminRenderQueueBrowser({ admin, origin, root, owner, other, empty, denied, connected }) {
  const exe = join(process.env.USERPROFILE, ".local", "share", "ego", "active_version_dir", "ego-browser.exe");
  // The browser fixture uses its own cookie hostname, separate from raw 127.0.0.1 harnesses.
  const browserOrigin = origin.replace("127.0.0.1", "localhost");
  const label = "admin render queue fixture " + origin;
  async function browser(name, source) {
    const file = join(root, name + ".mjs");
    await writeFile(file, `
const task = await taskSpace(${JSON.stringify(label)});
const page = (await task.pages())[0];
const origin = ${JSON.stringify(browserOrigin)};
const cookies = ${JSON.stringify({ owner, other, empty, denied })};
const session = async type => {
  const cookie = cookies[type], separator = cookie.indexOf("=");
  const result = await page.cdp("Network.setCookie", { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin, path: "/" });
  if (!result.success) throw new Error("Could not set the synthetic fixture cookie");
};
let visit = 0;
const gotoQueue = () => page.goto(origin + "/admin?fixture-visit=" + (++visit) + "#admin-render-queue");
const wait = async (condition, value) => {
  try { await page.waitForFunction(condition, value, { timeout: 15000 }); }
  catch (error) {
    const state = await page.evaluate(() => ({ path: location.pathname, width: innerWidth,
      count: document.querySelectorAll("#admin-render-queue li").length, focus: document.activeElement?.id, hash: location.hash,
      queue: document.querySelector("#admin-render-queue")?.innerText.slice(0, 280) }));
    throw new Error(String(condition) + " " + JSON.stringify(state), { cause: error });
  }
};
const size = width => page.cdp("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
${source}
`, "utf8");
    await run(exe, ["nodejs", "-e", "await import('" + pathToFileURL(file).href + "')"], { windowsHide: true, timeout: 90000 });
  }
  const unavailable = `
for (const width of [390, 1440]) {
  await size(width);
  await session("owner");
  await gotoQueue();
  await wait(() => document.querySelector("#admin-render-queue")?.innerText.includes("렌더 대기열에 연결할 수 없어요"));
  await wait(() => document.querySelectorAll("#admin-render-queue li").length === 0 && document.activeElement?.id === "admin-render-queue-heading");
  await page.keyboard.press("Tab");
  await wait(() => document.activeElement?.textContent === "렌더 대기열 다시 조회");
}
`;
  try {
    if (!connected) {
      await browser("unlinked-queue", unavailable);
      console.log("Admin queue browser 390/1440: default unlinked and keyboard retry");
      return;
    }
    await admin.query("REVOKE SELECT ON dream.jobs FROM dream_api");
    try {
      const { rows: [role] } = await admin.query("SELECT has_table_privilege('dream_api','dream.jobs','SELECT') AS can_read");
      if (role.can_read) throw new Error("Fixture dream_api can still read jobs");
      await browser("failed-queue", unavailable);
    }
    finally { await admin.query("GRANT SELECT ON dream.jobs TO dream_api"); }
    await browser("recovered-queue", `
await page.keyboard.press("Enter");
await wait(() => document.querySelectorAll("#admin-render-queue li").length === 50);
for (const width of [390, 1440]) {
  await size(width);
  await session("owner");
  await gotoQueue();
  await wait(w => innerWidth === w && document.documentElement.scrollWidth === document.documentElement.clientWidth, width);
  await wait(() => {
    const queue = document.querySelector("#admin-render-queue");
    const jobs = [...queue.querySelectorAll("li")];
    return jobs.length === 50 && queue.innerText.includes("격리 환경") &&
      jobs.every(row => !row.innerText.includes("other account title")) &&
      ["대기", "진행 중", "성공", "실패", "취소"].every(state => jobs.some(row => row.innerText.includes(state)));
  });
  await session("other");
  await gotoQueue();
  await wait(() => document.querySelectorAll("#admin-render-queue li").length === 1 &&
    document.querySelector("#admin-render-queue li")?.innerText.includes("other account title"));
  await session("empty");
  await gotoQueue();
  await wait(() => document.querySelector("#admin-render-queue")?.innerText.includes("렌더 작업이 없어요.") &&
    document.querySelectorAll("#admin-render-queue li").length === 0);
  await session("denied");
  await gotoQueue();
  await wait(() => location.pathname === "/admin/login" && !document.querySelector("#admin-render-queue li"));
}
`);
    console.log("Admin queue browser 390/1440: actual PG failure and keyboard recovery, 50 own jobs, other owner, empty and denied passed");
  } finally { await browser("finish-queue", 'await task.finish({ keep: [] });'); }
}
