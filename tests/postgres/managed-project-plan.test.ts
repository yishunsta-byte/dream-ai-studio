import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { managedPlanApprovalConfiguration, managedPlanConfiguration, managedPlanMenus } from "@/lib/cloud/managed-project-plan";

vi.mock("server-only", () => ({}));

const ref = "abcdefghijklmnopqrst";
const principal = "dream_plan_app";
const direct = `db.${ref}.supabase.co`;
const env = {
  VERCEL: "1", DREAM_PROJECT_PLAN_BACKEND: "supabase-postgres",
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_fixture_key_only",
  DREAM_PROJECT_PLAN_DB_URL: `postgresql://${principal}:synthetic@${direct}:5432/postgres`,
};

describe("managed project plan connection", () => {
  it("binds to official auth project and validates the PostgreSQL hostname and certificate", () => {
    expect(managedPlanConfiguration({ ...env, DREAM_PROJECT_PLAN_DB_CA: "fixture CA" })).toMatchObject({
      ref, host: direct, user: principal, port: 5432, ssl: { rejectUnauthorized: true, servername: direct, ca: "fixture CA" },
    });
    const host = "aws-0-ap-northeast-2.pooler.supabase.com";
    expect(managedPlanConfiguration({ ...env, DREAM_PROJECT_PLAN_DB_URL: `postgres://${principal}.${ref}:synthetic@${host}:6543/postgres` }))
      .toMatchObject({ ref, host, user: `${principal}.${ref}`, port: 6543, ssl: { rejectUnauthorized: true, servername: host } });
  });

  it.each([
    { DREAM_PROJECT_PLAN_BACKEND: undefined },
    { DREAM_PROJECT_PLAN_BACKEND: "owned-pg17" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:8010" },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_fixture_only" },
    { DREAM_PROJECT_PLAN_DB_URL: `postgresql://postgres:synthetic@${direct}:5432/postgres` },
    { DREAM_PROJECT_PLAN_DB_URL: `postgresql://${principal}:synthetic@${direct}:5432/wrong` },
    { DREAM_PROJECT_PLAN_DB_URL: `${env.DREAM_PROJECT_PLAN_DB_URL}?sslmode=disable` },
    { DREAM_PROJECT_PLAN_DB_URL: `postgresql://${principal}:synthetic@${direct}:5432/postgres#ignored` },
    { DREAM_PROJECT_PLAN_DB_URL: `postgresql://${principal}:synthetic@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres` },
    { DREAM_PROJECT_PLAN_DB_URL: `postgresql://${principal}.zzzzzzzzzzzzzzzzzzzz:synthetic@aws-0-test.pooler.supabase.com:6543/postgres` },
  ])("closes out-of-contract configuration %j", overrides => {
    expect(managedPlanConfiguration({ ...env, ...overrides })).toBeNull();
  });
});

describe("managed project plan approval connection", () => {
  const approver = "dream_plan_approver";
  const approvedEnv = { ...env, DREAM_PROJECT_PLAN_APPROVAL_BACKEND: "supabase-postgres",
    DREAM_PROJECT_PLAN_APPROVAL_DB_URL: `postgresql://${approver}:synthetic-approval@${direct}:5432/postgres`,
    DREAM_PROJECT_PLAN_APPROVAL_DB_CA: "approval fixture CA" };

  it("requires a separately selected login and verifies the same official project", () => {
    expect(managedPlanApprovalConfiguration(approvedEnv)).toMatchObject({
      ref, host: direct, port: 5432, user: approver,
      ssl: { servername: direct, rejectUnauthorized: true, ca: "approval fixture CA" },
    });
    expect(managedPlanConfiguration(approvedEnv)).toMatchObject({ user: principal });
    const host = "aws-0-ap-northeast-2.pooler.supabase.com";
    expect(managedPlanApprovalConfiguration({ ...approvedEnv,
      DREAM_PROJECT_PLAN_APPROVAL_DB_URL: `postgresql://${approver}.${ref}:synthetic@${host}:6543/postgres` })).toMatchObject({
      ref, host, port: 6543, user: `${approver}.${ref}`, ssl: { servername: host, rejectUnauthorized: true },
    });
  });

  it.each([
    { DREAM_PROJECT_PLAN_APPROVAL_BACKEND: undefined },
    { DREAM_PROJECT_PLAN_APPROVAL_BACKEND: "owned-pg17" },
    { DREAM_PROJECT_PLAN_BACKEND: undefined },
    { DREAM_PROJECT_PLAN_APPROVAL_DB_URL: undefined },
    { DREAM_PROJECT_PLAN_APPROVAL_DB_URL: env.DREAM_PROJECT_PLAN_DB_URL },
    { DREAM_PROJECT_PLAN_APPROVAL_DB_URL: `postgresql://${approver}:synthetic@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres` },
  ])("closes out-of-contract approval configuration %j", overrides => {
    expect(managedPlanApprovalConfiguration({ ...approvedEnv, ...overrides })).toBeNull();
  });
});

describe("managed project plan menus", () => {
  it("opens planning for exactly the two active managed menus, matching the 0003 policy list", () => {
    const menus = JSON.parse(readFileSync(new URL("../../docs/spec/menus.json", import.meta.url), "utf8")).menus as { id: string; availability: string }[];
    expect(managedPlanMenus).toEqual(menus.filter(menu => menu.availability === "active").map(menu => menu.id));
    expect(managedPlanMenus).toEqual(["shopping-shorts", "topic-shorts"]);
    expect(Object.isFrozen(managedPlanMenus)).toBe(true);
    const sql = readFileSync(new URL("../../lib/db/postgres/managed-project-plan/0003_topic_shorts.sql", import.meta.url), "utf8");
    expect(sql.match(/menu_id IN \('shopping-shorts','topic-shorts'\)/g)).toHaveLength(6);
    const route = readFileSync(new URL("../../app/api/projects/[id]/plan/route.ts", import.meta.url), "utf8");
    expect(route).toContain("menu_id=ANY($3::text[])");
    expect(route).not.toContain("menu_id='shopping-shorts'");
  });
});
