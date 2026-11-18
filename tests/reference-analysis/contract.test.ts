import { describe, expect, it } from "vitest";
import { classifyReferenceInput } from "../../lib/reference-analysis/input";
import { createReferenceAnalysisResult, referenceAnalysisResultSchema } from "../../lib/reference-analysis/result";

const inputFile = (name: string, mime?: string) =>
  classifyReferenceInput({ kind: "file", name, sizeBytes: 100, permission: "synthetic", ...(mime ? { mime } : {}) });

describe("local reference input decisions", () => {
  it.each([
    ["clip.MP4", "video", "video/mp4"],
    ["music.wav", "music", "audio/x-wav"],
    ["still.jpg", "image", "image/jpeg"],
  ])("accepts the authorized media declaration for %s", (name, media, mime) => {
    expect(inputFile(name, mime)).toEqual({
      status: "ready", source: { kind: "file", name, media, mime, sizeBytes: 100, permission: "synthetic" },
    });
  });

  it.each([
    ["https://www.youtube.com/@creator/videos", "profile_url"],
    ["https://www.youtube.com/%40creator/videos", "profile_url"],
    ["https://www.tiktok.com/@creator", "profile_url"],
    ["https://instagram.com/creator/", "profile_url"],
    ["https://soundcloud.com/creator", "profile_url"],
    ["https://www.youtube.com/@creator.evil/video", "profile_url"],
    ["https://www.youtube.com.invalid/@creator", "url_not_accessed"],
    ["https://www.tiktok.com/@creator/video/123", "url_not_accessed"],
    ["https://instagram.com/p/abc/", "url_not_accessed"],
  ])("classifies %s without fetching", (url, reason) => {
    expect(classifyReferenceInput({ kind: "url", url, permission: "authorized", access: "public" })).toMatchObject({
      status: "replacement_required", reason, alternatives: ["body", "capture", "file"],
    });
  });

  it("separates a declared restriction from an unverified permission", () => {
    const url = "https://example.invalid/post";
    expect(classifyReferenceInput({ kind: "url", url, access: "restricted", mediaHint: "music" })).toMatchObject({
      status: "replacement_required", reason: "access_restricted", mediaHint: "music",
    });
    expect(classifyReferenceInput(url)).toMatchObject({ status: "replacement_required", reason: "permission_required" });
    expect(classifyReferenceInput("보이는 장면을 붙여넣었어요.")).toMatchObject({
      status: "replacement_required", reason: "permission_required",
    });
    expect(classifyReferenceInput({ kind: "file", name: "clip.mp4", sizeBytes: 100 })).toMatchObject({
      status: "replacement_required", reason: "permission_required",
    });
  });

  it("normalizes provenance without carrying URL query or fragment secrets", () => {
    expect(classifyReferenceInput({
      kind: "url", url: "https://www.youtube.com/watch?v=AbCdEfGh123&token=private#hidden", permission: "authorized",
    })).toMatchObject({ status: "replacement_required", sourceUrl: "https://www.youtube.com/watch?v=AbCdEfGh123" });
    expect(classifyReferenceInput({
      kind: "body", text: "  실제 본문\n", sourceUrl: "https://example.invalid/p/1?secret=x#hidden",
      permission: "authorized", mediaHint: "image",
    })).toMatchObject({ status: "ready", source: {
      text: "  실제 본문\n", sourceUrl: "https://example.invalid/p/1", mediaHint: "image", attribution: "provided",
    } });
  });

  it.each(["file:///private/clip.mp4", "https://name:password@example.invalid/a", "https:example.invalid", "//example.invalid"])(
    "rejects unsafe or incomplete URL %s", value => {
      expect(classifyReferenceInput(value)).toEqual({ status: "invalid", reason: "invalid_url" });
    },
  );

  it("rejects malformed bodies, a file path, unsupported extensions and contradictory MIME", () => {
    expect(classifyReferenceInput({ kind: "body", text: "  ", permission: "synthetic" })).toEqual({ status: "invalid", reason: "invalid_input" });
    expect(inputFile("../clip.mp4")).toEqual({ status: "invalid", reason: "invalid_input" });
    expect(inputFile("clip.zip")).toEqual({ status: "invalid", reason: "unsupported_file_type" });
    expect(inputFile("clip.mp4", "image/png")).toEqual({ status: "invalid", reason: "file_type_mismatch" });
    expect(classifyReferenceInput("https://example.invalid/" + "가".repeat(600))).toEqual({ status: "invalid", reason: "invalid_url" });
  });
});

describe("reference analysis JSON evidence", () => {
  it("preserves qualified findings and source-linked time and region locators across JSON", () => {
    for (const [source, location] of [
      [inputFile("clip.mp4"), { kind: "time", startMs: 60, endMs: 300 }],
      [inputFile("music.wav"), { kind: "time", startMs: 500, endMs: 500 }],
      [inputFile("still.png"), { kind: "region", x: 0.25, y: 0.5, width: 0.5, height: 0.5 }],
    ] as const) {
      const result = createReferenceAnalysisResult(source, [
        { id: "sample", kind: "observation", location, text: "합성 관찰 표본" },
        { id: "guess", kind: "inference", location, text: "제작 방식 가설", evidenceIds: ["sample"], alternatives: ["다른 제작 방식"] },
        { id: "unknown", kind: "unavailable", location: { kind: "whole" }, subject: "원본 시드", reason: "missing_evidence" },
      ]);
      expect(referenceAnalysisResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
    }
  });

  it("links an exact creator quote to an attributed pasted body", () => {
    const source = classifyReferenceInput({
      kind: "body", text: "색을 먼저 골랐다.", attribution: "creator_public", permission: "synthetic",
    });
    const location = { kind: "text", start: 0, end: 2 } as const;
    const quote = { id: "quote", kind: "creator_disclosure", location, quote: "색을" } as const;
    expect(createReferenceAnalysisResult(source, [quote]).findings).toEqual([quote]);
    expect(() => createReferenceAnalysisResult(source, [{ ...quote, quote: "소리" }])).toThrow();
    const unattributed = classifyReferenceInput({ kind: "body", text: "색을 먼저 골랐다.", permission: "synthetic" });
    expect(() => createReferenceAnalysisResult(unattributed, [quote])).toThrow();
    expect(() => createReferenceAnalysisResult(source, [{
      id: "outside", kind: "observation", location: { kind: "text", start: 0, end: 50 }, text: "표본",
    }])).toThrow();
  });

  it("rejects unresolved findings, invalid anchors, duplicate IDs and unsupported inferences", () => {
    const image = inputFile("still.png");
    const finding = { id: "image", kind: "observation", text: "표본",
      location: { kind: "region", x: 0, y: 0, width: 0.5, height: 1 } } as const;
    expect(() => createReferenceAnalysisResult(classifyReferenceInput("https://example.invalid/"), [finding])).toThrow();
    expect(() => createReferenceAnalysisResult(image, [{ ...finding, location: { ...finding.location, x: 0.6 } }])).toThrow();
    expect(() => createReferenceAnalysisResult(image, [{ ...finding, location: { kind: "time", startMs: 0, endMs: 20 } }])).toThrow();
    expect(() => createReferenceAnalysisResult(image, [finding, finding])).toThrow();
    expect(() => createReferenceAnalysisResult(image, [{
      id: "guess", kind: "inference", location: finding.location, text: "검증할 수 없는 가설", evidenceIds: ["guess"],
    }])).toThrow();
  });
});
