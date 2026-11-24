/* global URL, process, console */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { v7 } from "uuid";
import { parseMenuConfig } from "../../lib/menus/parse.ts";
import { snapshotForMenu } from "../../lib/menus/snapshot.ts";
import { stageOrder } from "../../lib/domain/stages.ts";

const run = promisify(execFile);
export async function verifyAdminConsole({ admin, actor, origin, cookie, root }) {
  const setup = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
  assert.ok(setup.ok);
  const menu = setup.config.menus[0], snapshot = snapshotForMenu(setup.config, menu);
  const projects = [];
  // Keep this account's queue fixtures and use checked menu snapshots for the project read adapter.
  await admin.query("UPDATE dream.projects SET archived_at=now() WHERE owner_id=$1 AND archived_at IS NULL", [actor.id]);
  for (let index = 0; index < 7; index++) {
    const id = v7(), title = "Console project " + (index + 1);
    projects.push({ id, title });
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,
      goal,target,aspect,length_sec,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,'{}',$6,'','','9:16',4,now(),now()-$7::int*interval '1 minute')`,
    [actor.id, id, menu.id, snapshot.templateVersion, JSON.stringify(snapshot), title, index]);
    await admin.query(`INSERT INTO dream.stage_states(owner_id,project_id,stage,status)
      SELECT $1,$2,stage,CASE stage WHEN 'intake' THEN 'todo' ELSE 'locked' END
      FROM unnest($3::text[]) stage`, [actor.id, id, stageOrder]);
  }
  const exe = join(process.env.USERPROFILE, ".local", "share", "ego", "active_version_dir", "ego-browser.exe");
  const label = "admin console fixture " + projects[0].id;
  async function browser(name, body) {
    const script = join(root, name + ".mjs");
    await writeFile(script, `
const task = await taskSpace(${JSON.stringify(label)});
const page = (await task.pages())[0];
const origin = ${JSON.stringify(origin)};
const projects = ${JSON.stringify(projects)};
const size = async width => page.cdp("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
const requirePage = async (condition, input) => {
  try { await page.waitForFunction(condition, input, { timeout: 12000 }); }
  catch (error) {
    const state = await page.evaluate(() => ({ path: location.pathname, hash: location.hash, width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth, listRows: document.querySelectorAll("#admin-project-list li").length,
      active: document.activeElement?.id || document.activeElement?.tagName,
      nav: document.querySelector('nav[aria-label="?? ??"] a[aria-current="location"]')?.getAttribute("href") }));
    throw new Error(String(condition) + " at " + JSON.stringify(state), { cause: error });
  }
};
${body}
`, "utf8");
    const { stdout } = await run(exe, ["nodejs", "-e", "await import('" + pathToFileURL(script).href + "')"], {
      windowsHide: true, timeout: 90000, maxBuffer: 512000,
    });
    console.log(stdout.trim());
  }
  const split = cookie.indexOf("=");
  const evidenceFile = join(root, "admin-console-evidence.json");
  try {
    await admin.query("REVOKE SELECT ON dream.stage_states FROM dream_api");
    try {
      await browser("failed", `
await page.cdp("Network.setCookie", { name: ${JSON.stringify(cookie.slice(0, split))}, value: ${JSON.stringify(cookie.slice(split + 1))}, url: origin });
await size(390);
await page.goto(origin + "/admin#admin-project-list");
await page.waitForSelector('a[href*="?reload="]');
await requirePage(() => document.querySelector("#admin-project-list")?.innerText.includes("프로젝트 목록을 불러오지 못했어요"));
console.log("Real admin failure action rendered");
`);
    } finally { await admin.query("GRANT SELECT ON dream.stage_states TO dream_api"); }
    await browser("recovered", `
const reload = 'a[href*="?reload="]';
await page.focus(reload);
await page.keyboard.press("Enter");
await requirePage(() => location.search.startsWith("?reload=") && !!document.querySelector('#admin-project-list input[type=search]'));
await requirePage(() => document.activeElement?.id === "admin-projects");
const evidence = [];
for (const width of [390, 1440]) {
  await size(width);
  await page.goto(origin + "/admin");
  await requirePage(() => document.querySelector('nav[aria-label="관리 메뉴"] a[aria-current="location"]')?.getAttribute("href") === "#admin-project-list");
  await requirePage(w => innerWidth === w && document.documentElement.scrollWidth === document.documentElement.clientWidth, width);
  const list = "#admin-project-list";
  await requirePage(() => document.querySelectorAll("#admin-project-list li").length === 7);
  await page.fill(list + ' input[type=search]', "Console project 7");
  await requirePage(() => document.querySelectorAll("#admin-project-list li").length === 1);
  await page.selectOption(list + " select", "done");
  await requirePage(() => document.querySelector("#admin-project-list")?.innerText.includes("검색 조건에 맞는 프로젝트가 없어요"));
  await page.selectOption(list + " select", "");
  await page.fill(list + ' input[type=search]', "");
  await requirePage(() => document.querySelectorAll("#admin-project-list li").length === 7);
  const last = list + ' li:last-child a';
  await page.focus(last);
  await page.keyboard.press("Enter");
  await requirePage(title => document.activeElement?.tagName === "H1" && document.activeElement.textContent === title &&
      document.activeElement.getBoundingClientRect().top >= 0 && document.activeElement.getBoundingClientRect().bottom <= innerHeight, projects.at(-1).title);
  evidence.push(await page.evaluate(() => {
    const rect = document.activeElement.getBoundingClientRect();
    return { width: innerWidth, headingTop: Math.round(rect.top), headingBottom: Math.round(rect.bottom), height: innerHeight };
  }));
  await page.evaluate(() => history.back());
  await requirePage(() => location.pathname === "/admin" && getComputedStyle(document.querySelector("#admin-project-list")).display !== "none");
  await page.focus('a[href="#admin-review"]');
  await page.keyboard.press("Enter");
  await requirePage(() => location.hash === "#admin-review" && document.activeElement?.id === "publication-queue");
  await page.evaluate(() => history.back());
  await requirePage(() => location.hash === "" && getComputedStyle(document.querySelector("#admin-project-list")).display !== "none");
  await page.evaluate(() => history.forward());
  await requirePage(() => location.hash === "#admin-review" && document.activeElement?.id === "publication-queue");
  await page.goto(origin + "/admin#admin-account");
  await requirePage(() => document.activeElement?.id === "admin-menu" && !!document.querySelector('#admin-account a[href="/account/password"]'));
  await page.goto(origin + "/admin#admin-overview");
  await requirePage(() => document.activeElement?.textContent === "개요" && !!document.querySelector('#admin-overview a[href="/cloud/manage"]'));
  console.log(width + "px default/search/status/detail focus/hash/back/forward verified");
}
await page.goto(origin + "/cloud/projects/" + projects[0].id);
await requirePage(title => document.querySelector("h1")?.textContent === title && document.activeElement?.tagName !== "H1", projects[0].title);
await (await import("node:fs/promises")).writeFile(${JSON.stringify(evidenceFile)}, JSON.stringify(evidence));
`);
    const evidence = JSON.parse(await readFile(evidenceFile, "utf8"));
    assert.deepEqual(evidence.map(row => row.width), [390, 1440]);
    console.log("Admin console browser: refreshed after real DB error, search, status, section history, normal detail, and focused last project " + JSON.stringify(evidence));
  } finally {
    await browser("finish", 'await task.finish({ keep: [] });');
  }
}
