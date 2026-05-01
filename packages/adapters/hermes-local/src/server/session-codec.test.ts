import { describe, expect, it } from "vitest";

import { sessionCodec } from "./session-codec.js";

describe("sessionCodec.deserialize", () => {
  it("returns null for non-objects, arrays, and missing sessionId", () => {
    expect(sessionCodec.deserialize(null)).toBeNull();
    expect(sessionCodec.deserialize("oops")).toBeNull();
    expect(sessionCodec.deserialize([])).toBeNull();
    expect(sessionCodec.deserialize({})).toBeNull();
    expect(sessionCodec.deserialize({ sessionId: "  " })).toBeNull();
  });

  it("accepts both camelCase and snake_case sessionId aliases", () => {
    expect(sessionCodec.deserialize({ sessionId: "abc" })).toEqual({ sessionId: "abc" });
    expect(sessionCodec.deserialize({ session_id: "xyz" })).toEqual({ sessionId: "xyz" });
  });

  it("preserves cwd from cwd | workdir | folder fallback chain", () => {
    expect(sessionCodec.deserialize({ sessionId: "a", cwd: "/c" })).toEqual({
      sessionId: "a",
      cwd: "/c",
    });
    expect(sessionCodec.deserialize({ sessionId: "a", workdir: "/w" })).toEqual({
      sessionId: "a",
      cwd: "/w",
    });
    expect(sessionCodec.deserialize({ sessionId: "a", folder: "/f" })).toEqual({
      sessionId: "a",
      cwd: "/f",
    });
    // cwd wins over workdir when both are set.
    expect(
      sessionCodec.deserialize({ sessionId: "a", cwd: "/c", workdir: "/w" }),
    ).toEqual({ sessionId: "a", cwd: "/c" });
  });
});

describe("sessionCodec.serialize", () => {
  it("returns null for null or empty sessionId", () => {
    expect(sessionCodec.serialize(null)).toBeNull();
    expect(sessionCodec.serialize({})).toBeNull();
    expect(sessionCodec.serialize({ sessionId: "" })).toBeNull();
  });

  it("round-trips through deserialize", () => {
    const out = sessionCodec.serialize({ sessionId: "abc-123", cwd: "/work" });
    expect(out).toEqual({ sessionId: "abc-123", cwd: "/work" });
    expect(sessionCodec.deserialize(out)).toEqual({ sessionId: "abc-123", cwd: "/work" });
  });

  it("strips an empty cwd string rather than emitting an empty key", () => {
    expect(sessionCodec.serialize({ sessionId: "abc", cwd: "  " })).toEqual({
      sessionId: "abc",
    });
  });
});

describe("sessionCodec.getDisplayId", () => {
  it("returns the trimmed sessionId or null", () => {
    const getDisplayId = sessionCodec.getDisplayId;
    if (!getDisplayId) throw new Error("sessionCodec.getDisplayId must be defined");
    expect(getDisplayId(null)).toBeNull();
    expect(getDisplayId({})).toBeNull();
    expect(getDisplayId({ sessionId: "abc-123" })).toBe("abc-123");
    expect(getDisplayId({ session_id: "snake-id" })).toBe("snake-id");
  });
});
