import { describe, expect, it } from "vitest";
import { emptyShortsSession, sessionFromProject } from "@/components/admin/shorts-original/shorts-session";
import { readShortsTab, shortsTabMaxAgeMs, writeShortsTab, type ShortsTabState } from "@/components/admin/shorts-original/shorts-tab-store";
import type { ShortsSourcePick, ShortsSourceSnapshot } from "@/components/admin/shorts-source-steps/source-step-data";
import { projectDocument as fixtureProject } from "../reference-analysis/admin-shorts-vault-fixture";

// P1-08-SHORTS-RUNTIME-2 F1: 탭 저장(sessionStorage) 글 만들기·되살리기. 화면 연결은 합성 화면(새로고침)으로 따로 확인한다.
// P1-08-SHORTS-SESSION-RESTORE-OWNER: 글의 주인(서버가 확인한 로그인 계정)이 지금 계정과 같을 때만 되살린다.
const now = Date.parse("2026-11-22T12:00:00.000Z");
const owner = "admin-a@example.test";
const other = "admin-b@example.test";
const full = sessionFromProject(fixtureProject());
const pick: ShortsSourcePick = {
  videoId: "Aa000000001", url: "https://www.youtube.com/watch?v=Aa000000001", title: "합성 쇼츠", channelTitle: "합성 채널",
  thumbnailUrl: null, publishedAt: "2026-11-20T00:00:00.000Z", durationSeconds: 42, views: 120000, subscribers: 3000, vsTenths: "400",
  grade: "대박", vph: 900.5, query: "캠핑", measuredAt: "2026-11-22T11:00:00.000Z", credentialVersion: 3,
};
const snapshot: ShortsSourceSnapshot = { query: "캠핑", order: "viewCount", dateFrom: "", dateTo: "", items: [], credentialVersion: 3, measuredAt: now - 1000 };
const project = { id: "10000000-0000-4000-8000-000000000001", revision: 4, expiresAt: "2026-12-22T00:00:00.000Z" };
const state = (patch: Partial<ShortsTabState> = {}): ShortsTabState => ({
  view: "script", session: { ...full, title: "캠핑 프로젝트" }, project, picks: [pick], snapshot, analysis: null, multi: null, multiOver: false, ...patch,
});

describe("P1-08-SHORTS-RUNTIME-2 F1: 탭 저장", () => {
  it("작업 상태·프로젝트·화면·고른 영상·검색을 그대로 되살린다", () => {
    const raw = writeShortsTab(state(), owner, now);
    const back = readShortsTab(raw, owner, now + 60_000);
    expect(back).not.toBeNull();
    expect(back?.view).toBe("script");
    expect(back?.session).toEqual({ ...full, title: "캠핑 프로젝트" });
    expect(back?.project).toEqual(project);
    expect(back?.picks).toEqual([pick]);
    expect(back?.snapshot).toEqual(snapshot);
  });

  it("분석 근거가 없으면 작업 문서·프로젝트·묶음 표시는 남기지 않고 검색·고른 영상만 남긴다", () => {
    const raw = writeShortsTab(state({ view: "search", session: emptyShortsSession, multiOver: true }), owner, now);
    const back = readShortsTab(raw, owner, now);
    expect(back?.session).toEqual(emptyShortsSession);
    expect(back?.project).toBeNull();
    expect(back?.multiOver).toBe(false);
    expect(back?.picks).toHaveLength(1);
    expect(back?.view).toBe("search");
  });

  it("생성 동의·키 같은 값은 글에 넣지 않고, 주인 계정은 반드시 적는다", () => {
    const raw = writeShortsTab(state(), owner, now);
    const value = JSON.parse(raw);
    expect(Object.keys(value).sort()).toEqual(
      ["account", "analysis", "document", "multi", "multiOver", "picks", "project", "savedAt", "snapshot", "title", "version", "view"]);
    expect(value.account).toBe(owner);
    expect(raw).not.toMatch(/consent|apiKey|secret/i);
  });

  it("12시간이 지났거나 시각이 미래인 글은 버린다", () => {
    const raw = writeShortsTab(state(), owner, now);
    expect(readShortsTab(raw, owner, now + shortsTabMaxAgeMs)).not.toBeNull();
    expect(readShortsTab(raw, owner, now + shortsTabMaxAgeMs + 1)).toBeNull();
    expect(readShortsTab(raw, owner, now - 120_000)).toBeNull();
  });

  it("깨진 글·형식이 다른 글·모르는 칸이 있는 글은 버린다", () => {
    const value = JSON.parse(writeShortsTab(state(), owner, now));
    expect(readShortsTab(null, owner, now)).toBeNull();
    expect(readShortsTab("{", owner, now)).toBeNull();
    expect(readShortsTab(JSON.stringify({ ...value, version: 2 }), owner, now)).toBeNull();
    expect(readShortsTab(JSON.stringify({ ...value, view: "admin" }), owner, now)).toBeNull();
    expect(readShortsTab(JSON.stringify({ ...value, consent: true }), owner, now)).toBeNull();
    expect(readShortsTab(JSON.stringify({ ...value, picks: [{ ...pick, videoId: "짧음" }] }), owner, now)).toBeNull();
    expect(readShortsTab(JSON.stringify({ ...value, document: { ...value.document, step: 99 } }), owner, now)).toBeNull();
  });
});

describe("P1-08-SHORTS-SESSION-RESTORE-OWNER: 탭 저장 주인 확인", () => {
  const value = () => JSON.parse(writeShortsTab(state(), owner, now)) as Record<string, unknown>;
  it("같은 계정(A)의 글만 되살린다", () => {
    expect(readShortsTab(JSON.stringify(value()), owner, now)).not.toBeNull();
  });
  it("다른 계정(B)으로는 A의 글을 되살리지 않는다", () => {
    expect(readShortsTab(JSON.stringify(value()), other, now)).toBeNull();
  });
  it("주인이 null이거나 빠진 예전 글은 어느 계정으로도 되살리지 않는다", () => {
    const legacy = { ...value(), account: null };
    const missing = Object.fromEntries(Object.entries(value()).filter(([key]) => key !== "account"));
    for (const raw of [JSON.stringify(legacy), JSON.stringify(missing)]) {
      expect(readShortsTab(raw, owner, now)).toBeNull();
      expect(readShortsTab(raw, other, now)).toBeNull();
    }
  });
  it("빈 계정·공백 주인으로는 읽지 않는다", () => {
    expect(readShortsTab(JSON.stringify(value()), "", now)).toBeNull();
    expect(readShortsTab(JSON.stringify({ ...value(), account: "  " }), "  ", now)).toBeNull();
  });
  it("계정은 글자 그대로 같아야 한다(대소문자가 다르면 다른 계정)", () => {
    expect(readShortsTab(JSON.stringify(value()), owner.toUpperCase(), now)).toBeNull();
  });
});
