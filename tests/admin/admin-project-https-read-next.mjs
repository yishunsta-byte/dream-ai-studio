/* global Response, console */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dataEvents = events => events.filter(event => event.kind === "data");
const reloadLink = markup => markup.match(/href="(\/admin\?reload=[a-z0-9]+#admin-project-list)"/)?.[1];
const missingProfile = "project_read_unexposed";

async function adminPage(http, actor, path = "/admin") {
  const response = await http(path, actor);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const markup = await response.text();
  assert.ok(!markup.includes(actor.token));
  return markup;
}

async function assertOwnerList(http, actor, events, own, excluded, path) {
  const before = events.length;
  const markup = await adminPage(http, actor, path);
  const reads = dataEvents(events.slice(before));
  assert.equal(reads.length, 1);
  assert.equal(reads[0].actor, actor.user.id);
  assert.equal(reads[0].path, "/project_list");
  assert.equal(reads[0].status, 200);
  assert.ok(!markup.includes(actor.user.id));
  for (const id of own) assert.ok(markup.includes(`/cloud/projects/${id}#admin-project-heading`));
  for (const id of excluded) assert.ok(!markup.includes(id));
  return markup;
}

let corruptHeader;
let unavailable = false;
let alternateUser;

export const adminProjectReadScenario = {
  commit: "29860f3fc5b896b361fb90cab7e29c466ecc3a85",
  profiles: ["project_read", missingProfile],
  authUser(user, headers) {
    return headers["cache-control"] === "no-store" && user ? alternateUser ?? user : user;
  },
  dataResponse() {
    if (unavailable) return Response.json({ message: "Synthetic unavailable response" }, { status: 503 });
  },
  dataHeaders(headers) {
    if (corruptHeader) headers[corruptHeader] = "unexpected";
  },
  async prepareApp(app) {
    // The owned PG fixture uses loopback SCRAM. Apply the existing safety-checked
    // test option only in the copied application, leaving the product TLS gate intact.
    const file = join(app, "lib/services/postgres/project-read-pool.ts");
    const source = await readFile(file, "utf8");
    const seam = "value: createProjectReadPoolManager(), enumerable: false";
    assert.equal(source.split(seam).length, 2);
    await writeFile(file, source.replace(seam, "value: createProjectReadPoolManager({ localTestWithoutTls: true }), enumerable: false"));
  },
  async verify({ start, users, fixture, events }) {
    const [alice, bob] = users;
    const { first, second, another, archived } = fixture.ids;
    await start("supabase-https", async http => {
      let before = events.length;
      const denied = await http("/admin");
      assert.equal(denied.status, 307);
      assert.match(denied.headers.get("location"), /\/admin\/login/);
      assert.equal(dataEvents(events.slice(before)).length, 0);

      let page = await assertOwnerList(http, alice, events, [first], [second, another, archived]);
      await assertOwnerList(http, bob, events, [second, another], [first, archived]);
      const originalReload = reloadLink(page);
      assert.ok(originalReload);
      await fixture.update();
      page = await assertOwnerList(http, alice, events, [first], [second, another, archived], originalReload);
      assert.ok(page.includes("T361 updated in existing writer"));
      assert.ok(reloadLink(page) && reloadLink(page) !== originalReload);

      await fixture.revoke();
      try {
        page = await assertOwnerList(http, alice, events, [], [first, second, another, archived], reloadLink(page));
        assert.ok(page.includes("내 프로젝트가 0개예요") && page.includes("조회 시각"));
        const detail = await http(`/api/projects/${first}`, alice);
        assert.equal(detail.status, 404);
        assert.equal(detail.headers.get("cache-control"), "no-store");
        await assertOwnerList(http, bob, events, [second, another], [first, archived]);
      } finally {
        await fixture.reapprove();
      }
      await assertOwnerList(http, alice, events, [first], [second, another, archived], reloadLink(page));

      before = events.length;
      alternateUser = bob.user;
      try {
        const mismatched = await http("/admin", alice);
        assert.equal(mismatched.status, 307);
        assert.match(mismatched.headers.get("location"), /\/admin\/login\?error=forbidden/);
        assert.ok(events.slice(before).some(event => event.kind === "auth" && event.actor === alice.user.id && event.returned === alice.user.id));
        assert.ok(events.slice(before).some(event => event.kind === "auth" && event.actor === alice.user.id && event.returned === bob.user.id));
        assert.equal(dataEvents(events.slice(before)).length, 0);
      } finally {
        alternateUser = undefined;
      }

      for (const header of ["content-profile", "content-range", undefined]) {
        before = events.length;
        corruptHeader = header;
        unavailable = header === undefined;
        try {
          const failed = await adminPage(http, alice);
          assert.ok(failed.includes("프로젝트 목록을 불러오지 못했어요") && reloadLink(failed));
          assert.ok(!failed.includes("조회 시각"));
          assert.equal(dataEvents(events.slice(before)).length, 1);
        } finally {
          corruptHeader = undefined;
          unavailable = false;
        }
      }
      before = events.length;
      const post = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };
      assert.equal((await http("/api/projects", undefined, post)).status, 401);
      const blocked = await http("/api/projects", alice, post);
      assert.equal(blocked.status, 503);
      assert.equal(blocked.headers.get("cache-control"), "no-store");
      assert.equal((await blocked.json()).code, "LEGACY_DATA_UNAVAILABLE");
      assert.equal(dataEvents(events.slice(before)).length, 0);
      assert.equal(await fixture.countLegacyReadSessions(), 0);
    }, { DATABASE_URL: fixture.legacyDatabaseUrl });
    console.log("Admin HTTPS: owned lists, account mismatch, approval/reapproval, reload, headers, availability and POST regression passed");

    for (const [selected, profile, calls] of [
      ["disabled", "project_read", 0], ["supabase-https", "public", 0], ["supabase-https", missingProfile, 1],
    ]) {
      await start(selected, async http => {
        const before = events.length;
        const page = await adminPage(http, alice);
        if (selected === "disabled") assert.ok(page.includes("운영 담당자의 연결 확인이 필요해요"));
        else assert.ok(page.includes("프로젝트 목록을 불러오지 못했어요"));
        const reads = dataEvents(events.slice(before));
        assert.equal(reads.length, calls);
        if (calls) assert.equal(reads[0].failureCode, "PGRST106");
        assert.equal(await fixture.countLegacyReadSessions(), 0);
      }, { DREAM_PROJECT_HTTPS_PROFILE: profile, DATABASE_URL: fixture.legacyDatabaseUrl });
    }
    await start("postgres", async http => {
      const before = events.length;
      const legacy = await adminPage(http, alice);
      assert.ok(legacy.includes(`/cloud/projects/${first}#admin-project-heading`) && !legacy.includes(second));
      assert.equal(dataEvents(events.slice(before)).length, 0);
      assert.ok(await fixture.countLegacyReadSessions() >= 1);
    }, { DATABASE_URL: fixture.legacyDatabaseUrl });
    console.log("Admin HTTPS: unlinked, invalid profile, unexposed profile and existing PostgreSQL reader passed");
  },
};
