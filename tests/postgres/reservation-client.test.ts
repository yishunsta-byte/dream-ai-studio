import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseUploadReservationClientV1, reservationMimes, serializeUploadReservationClientV1, snapshotReservationRequest } from "@/lib/storage/uploads/reservation-client";
const uid = "019b9000-0000-7000-8000-000000000004";
describe("B33 strict canonical client snapshot", () => {
  it.each(reservationMimes)("serializes %s at both exact byte limits", mime => {
    for (const n of [1, 2147483648]) {
      const raw = `{"claimedMime":"${mime}","clientVersion":1,"requestedMaxBytes":${n}}`;
      const value = serializeUploadReservationClientV1({ requestedMaxBytes: n, claimedMime: mime, clientVersion: 1 });
      expect(value).toEqual(parseUploadReservationClientV1(raw)); expect(value.canonicalJson).toBe(raw);
      expect(value.clientDigest).toBe(createHash("sha256").update(`upload-reservation-client:v1\n${raw}`).digest("hex"));
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
  it.each(["0", "-0", "-1", "2147483649", "01", "+1", "1.0", "1e0", '"1"'])("rejects raw numeric token %s before coercion", n => {
    expect(() => parseUploadReservationClientV1(`{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":${n}}`)).toThrow("INVALID_REQUEST");
  });
  it.each([
    ' {"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1}',
    '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1}\n',
    '{"clientVersion":1,"claimedMime":"image/png","requestedMaxBytes":1}',
    '{"claimedMime":"image/png","claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1}',
    String.raw`{"claimedM\u0069me":"image/png","clientVersion":1,"requestedMaxBytes":1}`,
    '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1,"owner":"x"}',
  ])("rejects noncanonical/ambiguous raw text", raw => expect(() => parseUploadReservationClientV1(raw)).toThrow("INVALID_REQUEST"));
  it("rejects getters/prototypes/symbols without executing ordinary getters", () => {
    let called = 0; const value = { clientVersion: 1, claimedMime: "image/png", get requestedMaxBytes() { called++; return 1; } };
    expect(() => serializeUploadReservationClientV1(value)).toThrow(); expect(called).toBe(0);
    expect(() => serializeUploadReservationClientV1(Object.assign(Object.create({ x: 1 }), { clientVersion: 1, claimedMime: "image/png", requestedMaxBytes: 1 }))).toThrow();
    expect(() => serializeUploadReservationClientV1({ clientVersion: 1, claimedMime: "image/png", requestedMaxBytes: 1, [Symbol()]: true })).toThrow();
  });
  it("snapshots without freezing or retaining mutable request inputs", () => {
    const input = { requestId: uid, clientJson: '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1}' };
    const copy = snapshotReservationRequest(input); input.requestId = "other"; input.clientJson = "changed";
    expect(copy.requestId).toBe(uid); expect(copy.client.requestedMaxBytes).toBe(1); expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(copy)).toBe(true);
  });
  it.each([-0, NaN, Infinity, 1.5, 0, -1, 2147483649])("rejects invalid logical value %s", n => expect(() => serializeUploadReservationClientV1({ clientVersion: 1, claimedMime: "image/png", requestedMaxBytes: n })).toThrow());
});
