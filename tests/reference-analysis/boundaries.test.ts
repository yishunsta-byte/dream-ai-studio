import { describe, expect, it, vi } from "vitest";
import { actorFromVerifiedUserId } from "../../lib/db/postgres/types";
import { classifyReferenceInput, referenceFileByteLimit } from "../../lib/reference-analysis/input";
import { createPrivateReferenceResult, projectReferenceOwnerScreen, projectReferenceShareSummary } from "../../lib/reference-analysis/projection";
import { createReferenceAnalysisResult, type ReferenceFinding } from "../../lib/reference-analysis/result";

vi.mock("server-only", () => ({}));

const owner = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000001");
const other = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000002");
const input = classifyReferenceInput({ kind: "file", name: "owner-file.mp4", permission: "synthetic", sizeBytes: 100 });
const metadata = (durationMs: number): ReferenceFinding => ({
  id: "metadata", kind: "file_metadata", tool: "file-type+ffprobe", location: { kind: "whole" },
  values: { durationMs, mime: "video/mp4", embeddedPrompt: "private embedded note" },
});
const observation = (startMs: number, endMs: number): ReferenceFinding => ({
  id: "observed", kind: "observation", location: { kind: "time", startMs, endMs }, text: "private caption",
});
const timedMetadata = (): ReferenceFinding => ({
  id: "metadata", kind: "file_metadata", tool: "file-type+ffprobe", location: { kind: "whole" },
  timeline: { containerDurationMs: 1_500, tracks: [{ kind: "video", startMs: 200, endMs: 700 }] },
  observedBytes: 100,
  values: { durationMs: 1_500, mime: "video/mp4", embeddedPrompt: "private embedded note" },
});

describe("timecode bounds and owner projections", () => {
  it("allows a closing interval edge and rejects positions at or beyond the observed length", () => {
    expect(createReferenceAnalysisResult(input, [metadata(500), observation(490, 500)])).toBeDefined();
    expect(() => createReferenceAnalysisResult(input, [metadata(500), observation(490, 1000)])).toThrow();
    expect(() => createReferenceAnalysisResult(input, [metadata(500), observation(500, 500)])).toThrow();
    expect(() => createReferenceAnalysisResult(input, [metadata(500), { ...metadata(600), id: "extra" }])).toThrow();
    expect(() => createReferenceAnalysisResult(input, [metadata(0)])).toThrow();
  });

  it("keeps unknown duration usable as a note while excluding seek targets in owner and share output", () => {
    const record = createPrivateReferenceResult(owner, createReferenceAnalysisResult(input, [observation(0, 400)]));
    expect(projectReferenceOwnerScreen(record, owner).findings[0]).toMatchObject({ seekable: false });
    expect(projectReferenceShareSummary(record, owner, ["observed"]).findings[0]).toEqual({ kind: "observation" });
  });

  it("retains legacy length as metadata but never treats it as an aligned track", () => {
    const record = createPrivateReferenceResult(owner, createReferenceAnalysisResult(input, [metadata(500), observation(0, 100)]));
    expect(projectReferenceOwnerScreen(record, owner).findings[1]).toMatchObject({ seekable: false });
    expect(projectReferenceShareSummary(record, owner, ["observed"]).findings).toEqual([{ kind: "observation" }]);
  });

  it("uses an aligned track window instead of the longer container length", () => {
    expect(createReferenceAnalysisResult(input, [timedMetadata(), observation(690, 700)], "completed")).toBeDefined();
    expect(() => createReferenceAnalysisResult(input, [timedMetadata(), observation(900, 1000)], "completed")).toThrow();
    expect(() => createReferenceAnalysisResult(input, [timedMetadata(), observation(199, 220)], "completed")).toThrow();
    expect(() => createReferenceAnalysisResult(input, [timedMetadata(), observation(700, 700)], "completed")).toThrow();
  });

  it("does not use aligned audio to seek video when the video track is ambiguous", () => {
    const audioOnlyTimeline: ReferenceFinding = {
      id: "metadata", kind: "file_metadata", tool: "file-type+ffprobe", location: { kind: "whole" },
      values: { durationMs: 1_500 }, timeline: { containerDurationMs: 1_500, tracks: [{ kind: "audio", startMs: 0, endMs: 1_500 }] },
    };
    const record = createPrivateReferenceResult(owner, createReferenceAnalysisResult(input, [
      audioOnlyTimeline, observation(900, 1_000),
    ], "completed"));
    expect(projectReferenceOwnerScreen(record, owner).findings[1]).toMatchObject({ seekable: false });
    expect(projectReferenceShareSummary(record, owner, ["observed"]).findings).toEqual([{ kind: "observation" }]);
  });

  it("keeps raw fields private and builds minimal selected share summaries", () => {
    const record = createPrivateReferenceResult(owner, createReferenceAnalysisResult(input, [timedMetadata(), observation(200, 400)], "completed"));
    expect(() => projectReferenceOwnerScreen(record, other)).toThrow("REFERENCE_OWNER_REQUIRED");
    expect(() => projectReferenceShareSummary(record, other, ["metadata"])).toThrow("REFERENCE_OWNER_REQUIRED");
    expect(() => projectReferenceShareSummary(record, owner, ["wrong"])).toThrow("REFERENCE_SHARE_SELECTION_REQUIRED");
    const view = projectReferenceOwnerScreen(record, owner);
    expect(view.findings[1]).toMatchObject({ seekable: true, text: "private caption" });
    expect(JSON.stringify(view)).not.toMatch(/owner-file|private embedded note|ownerId/);
    expect(projectReferenceShareSummary(record, owner, ["metadata", "observed"])).toEqual({
      schemaVersion: 1, media: "video", findings: [
        { kind: "file_metadata", values: { durationMs: 1_500, mime: "video/mp4", sizeBytes: 100 },
          timeline: { containerDurationMs: 1_500, tracks: [{ kind: "video", startMs: 200, endMs: 700 }] } },
        { kind: "observation", location: { kind: "time", startMs: 200, endMs: 400 } },
      ],
    });
  });

  it("does not promote a matching reported size into an observed byte count", () => {
    const declaration = {
      id: "metadata", kind: "file_metadata", tool: "supplied", location: { kind: "whole" },
      values: { mime: "video/mp4", sizeBytes: 100 },
    } as const;
    const record = createPrivateReferenceResult(owner, createReferenceAnalysisResult(input, [declaration], "completed"));
    expect(projectReferenceOwnerScreen(record, owner).findings[0]).toMatchObject({ values: { mime: "video/mp4" } });
    expect(projectReferenceShareSummary(record, owner, ["metadata"]).findings[0]).toEqual({
      kind: "file_metadata", values: { mime: "video/mp4" },
    });
    expect(() => createReferenceAnalysisResult(input, [{ ...declaration, observedBytes: 99 }], "completed")).toThrow();
    expect(() => createReferenceAnalysisResult(input, [{ ...declaration, observedBytes: 100 }])).toThrow();
  });

  it.each(["cancelled", "timed_out", "inspection_failed", "local_tool_failed", "local_tool_unavailable"] as const)(
    "allows only the matching terminal finding through the %s boundary", status => {
      const unavailable = { id: "stop", kind: "unavailable", reason: status, subject: "file_metadata", location: { kind: "whole" } } as const;
      expect(() => createReferenceAnalysisResult(input, [unavailable, observation(0, 1)], status)).toThrow();
      expect(() => createReferenceAnalysisResult(input, [unavailable, { ...unavailable, id: "extra" }], status)).toThrow();
      expect(() => createReferenceAnalysisResult(input, [unavailable])).toThrow();
      expect(() => createReferenceAnalysisResult(input, [unavailable, metadata(500)], "completed")).toThrow();
      const privateResult = createPrivateReferenceResult(owner, createReferenceAnalysisResult(input, [unavailable], status));
      expect(projectReferenceOwnerScreen(privateResult, owner).findings).toEqual([{ ...unavailable, seekable: false }]);
      expect(projectReferenceShareSummary(privateResult, owner, ["stop"]).findings).toEqual([{ kind: "unavailable", reason: status }]);
      expect(() => projectReferenceShareSummary(privateResult, owner, ["observed"])).toThrow();
    },
  );

  it("keeps source URL paths and body text out of both projections", () => {
    const body = classifyReferenceInput({
      kind: "body", text: "owner-only original", sourceUrl: "https://example.invalid/private-path", permission: "authorized",
    });
    const record = createPrivateReferenceResult(owner, createReferenceAnalysisResult(body, [
      { kind: "observation", id: "body", location: { kind: "text", start: 0, end: 2 }, text: "<em>owner text</em>" },
    ]));
    expect(JSON.stringify(projectReferenceOwnerScreen(record, owner))).not.toMatch(/owner-only original|private-path|ownerId/);
    expect(projectReferenceShareSummary(record, owner, ["body"]).findings).toEqual([{ kind: "observation" }]);
  });

  it("rejects a declared oversize before any file inspection", () => {
    expect(classifyReferenceInput({
      kind: "file", name: "big.mp4", permission: "synthetic", sizeBytes: referenceFileByteLimit + 1,
    })).toEqual({ status: "invalid", reason: "file_too_large" });
  });
});
