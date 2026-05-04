// COG-136 H4 unit test for the user-model bridge.
//
// Exercises `getUserModel` against a mocked AcpExtMethodConnection — we
// don't want to spin up a real ACP process here because the JSON-RPC
// shape and the not-yet-spawned-handle behaviour are the only things
// worth pinning at this layer.

import { describe, expect, it, vi } from "vitest";
import {
  getUserModel,
  type UserModelSnapshot,
} from "./honcho.js";
import type { HermesProcessHandleWithConnection } from "./memory.js";

function makeHandle(
  overrides: Partial<HermesProcessHandleWithConnection> = {},
): HermesProcessHandleWithConnection {
  return {
    spec: {} as never,
    child: {} as never,
    sessionId: "session-1",
    initialized: true,
    lastUsedAt: 0,
    acpConnection: {
      extMethod: vi.fn().mockResolvedValue({ userModel: null }),
    },
    ...overrides,
  } as HermesProcessHandleWithConnection;
}

describe("getUserModel", () => {
  it("returns the snapshot for a known peer", async () => {
    const extMethod = vi.fn().mockResolvedValue({
      userModel: {
        userId: "user-42",
        card: ["prefers concise responses"],
        representation: "Backend engineer.",
      },
    });
    const handle = makeHandle({ acpConnection: { extMethod } });

    const result = await getUserModel(handle, "user-42");

    expect(result).toEqual({
      userId: "user-42",
      card: ["prefers concise responses"],
      representation: "Backend engineer.",
    });
    expect(extMethod).toHaveBeenCalledWith("experimental/honchoUserModel", {
      userId: "user-42",
    });
  });

  it("returns null when Hermes has no profile for the peer", async () => {
    const extMethod = vi.fn().mockResolvedValue({ userModel: null });
    const handle = makeHandle({ acpConnection: { extMethod } });

    const result = await getUserModel(handle, "user-unknown");

    expect(result).toBeNull();
  });

  it("returns null when the handle has no ACP connection yet", async () => {
    const handle = makeHandle({ acpConnection: null });

    const result = await getUserModel(handle, "user-42");

    expect(result).toBeNull();
  });

  it("returns null when the handle is not initialized", async () => {
    const extMethod = vi.fn();
    const handle = makeHandle({
      initialized: false,
      acpConnection: { extMethod },
    });

    const result = await getUserModel(handle, "user-42");

    expect(result).toBeNull();
    expect(extMethod).not.toHaveBeenCalled();
  });

  it("returns null for empty / whitespace userId without round-tripping", async () => {
    const extMethod = vi.fn();
    const handle = makeHandle({ acpConnection: { extMethod } });

    expect(await getUserModel(handle, "")).toBeNull();
    expect(await getUserModel(handle, "   ")).toBeNull();
    expect(extMethod).not.toHaveBeenCalled();
  });

  it("trims whitespace from userId before sending the JSON-RPC request", async () => {
    const extMethod = vi.fn().mockResolvedValue({
      userModel: { userId: "user-42", card: ["fact"] },
    });
    const handle = makeHandle({ acpConnection: { extMethod } });

    await getUserModel(handle, "  user-42  ");

    expect(extMethod).toHaveBeenCalledWith("experimental/honchoUserModel", {
      userId: "user-42",
    });
  });

  it("preserves arbitrary fields Hermes returns (read-only passthrough)", async () => {
    const passthroughPayload = {
      userId: "user-99",
      card: ["fact"],
      representation: "rep",
      summary: "session summary",
      recent_messages: [{ role: "user", content: "hi" }],
      customField: { nested: [1, 2, 3] },
    };
    const extMethod = vi.fn().mockResolvedValue({
      userModel: passthroughPayload,
    });
    const handle = makeHandle({ acpConnection: { extMethod } });

    const result = await getUserModel(handle, "user-99");

    expect(result).toEqual(passthroughPayload);
  });

  it("falls back to the request userId when the response omits one", async () => {
    // Hermes owns the snapshot shape but downstream callers always need a
    // stable userId for correlation, so a missing/empty userId in the
    // response is filled from the request key rather than dropped.
    const extMethod = vi.fn().mockResolvedValue({
      userModel: { card: ["fact"] },
    });
    const handle = makeHandle({ acpConnection: { extMethod } });

    const result = await getUserModel(handle, "user-42");

    expect(result?.userId).toBe("user-42");
    expect(result?.card).toEqual(["fact"]);
  });

  it("returns null for malformed responses (not an object)", async () => {
    const extMethod = vi
      .fn()
      .mockResolvedValueOnce("not-an-object")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userModel: "string-payload" });
    const handle = makeHandle({ acpConnection: { extMethod } });

    expect(await getUserModel(handle, "user-42")).toBeNull();
    expect(await getUserModel(handle, "user-42")).toBeNull();
    expect(await getUserModel(handle, "user-42")).toBeNull();
  });

  it("UserModelSnapshot type permits arbitrary extra keys (compile check)", () => {
    // Compile-time check that the type stays permissive — fails the
    // build if someone accidentally narrows the shape away from the
    // read-only-passthrough contract.
    const snapshot: UserModelSnapshot = {
      userId: "user-1",
      anyField: "anything",
      nested: { deep: [1, 2, 3] },
    };
    expect(snapshot.userId).toBe("user-1");
  });
});
