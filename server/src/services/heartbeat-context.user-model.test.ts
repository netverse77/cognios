// COG-136 H4 unit test for the hermes_local heartbeat-context user-model bridge.
//
// Mirrors the COG-135 H3b memory-bridge test structure: drives the provider
// through `runHeartbeatContextProviders` (the same entry point the
// heartbeat-context route uses) with a mocked `getUserModel` so we don't
// need a live ACP process.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserModelSnapshot } from "@paperclipai/adapter-hermes-local/server";
import {
  clearHeartbeatContextProviders,
  registerHeartbeatContextProvider,
  runHeartbeatContextProviders,
  type HeartbeatContextProviderInput,
} from "./heartbeat-context-providers.js";
import {
  createHermesLocalUserModelBridge,
  type GetUserModelFn,
} from "./heartbeat-honcho-bridge.js";

const HERMES_AGENT = "agent-hermes";
const OTHER_AGENT = "agent-claude";

function makeInput(
  overrides: Partial<HeartbeatContextProviderInput> = {},
): HeartbeatContextProviderInput {
  return {
    issue: {
      id: "issue-1",
      identifier: "COG-136",
      title: "user-model bridge",
      assigneeAgentId: HERMES_AGENT,
      ...overrides.issue,
    },
    latestCommentId: overrides.latestCommentId ?? "comment-1",
    recentCommentBodies: overrides.recentCommentBodies ?? [],
  };
}

const fakeHandle = {
  spec: {} as never,
  child: {} as never,
  sessionId: "session-1",
  initialized: true,
  lastUsedAt: 0,
  acpConnection: { extMethod: async () => ({ userModel: null }) },
};

function buildSnapshot(userId: string): UserModelSnapshot {
  return {
    userId,
    card: [`fact-for-${userId}`],
    representation: `representation-for-${userId}`,
  };
}

afterEach(() => {
  clearHeartbeatContextProviders();
});

describe("hermes_local heartbeat-context user-model bridge", () => {
  it("returns userModel for hermes_local agents with a known user", async () => {
    const snapshot = buildSnapshot("user-42");
    const getUserModel = vi.fn<GetUserModelFn>().mockResolvedValue(snapshot);
    registerHeartbeatContextProvider(
      createHermesLocalUserModelBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
          lookupUserId: async () => "user-42",
        },
        { getUserModel },
      ),
    );

    const result = await runHeartbeatContextProviders(makeInput());

    expect(result.userModel).toEqual(snapshot);
    expect(getUserModel).toHaveBeenCalledTimes(1);
    expect(getUserModel).toHaveBeenCalledWith(fakeHandle, "user-42");
  });

  it("returns no userModel for non-hermes adapters", async () => {
    const getUserModel = vi.fn<GetUserModelFn>();
    registerHeartbeatContextProvider(
      createHermesLocalUserModelBridge(
        {
          lookupAdapterType: async () => "claude_local",
          lookupHandle: () => fakeHandle,
          lookupUserId: async () => "user-42",
        },
        { getUserModel },
      ),
    );

    const result = await runHeartbeatContextProviders(
      makeInput({
        issue: {
          id: "i",
          identifier: null,
          title: "t",
          assigneeAgentId: OTHER_AGENT,
        },
      }),
    );

    expect(result.userModel).toBeUndefined();
    expect(getUserModel).not.toHaveBeenCalled();
  });

  it("returns no userModel when assignee maps to no known user", async () => {
    const getUserModel = vi.fn<GetUserModelFn>();
    registerHeartbeatContextProvider(
      createHermesLocalUserModelBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
          lookupUserId: async () => null,
        },
        { getUserModel },
      ),
    );

    const result = await runHeartbeatContextProviders(makeInput());

    expect(result.userModel).toBeUndefined();
    expect(getUserModel).not.toHaveBeenCalled();
  });

  it("returns no userModel when no ACP handle has been spawned yet", async () => {
    const getUserModel = vi.fn<GetUserModelFn>();
    registerHeartbeatContextProvider(
      createHermesLocalUserModelBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => null,
          lookupUserId: async () => "user-42",
        },
        { getUserModel },
      ),
    );

    const result = await runHeartbeatContextProviders(makeInput());

    expect(result.userModel).toBeUndefined();
    expect(getUserModel).not.toHaveBeenCalled();
  });

  it("returns no userModel when Hermes has no profile for the peer", async () => {
    const getUserModel = vi.fn<GetUserModelFn>().mockResolvedValue(null);
    registerHeartbeatContextProvider(
      createHermesLocalUserModelBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
          lookupUserId: async () => "user-unknown",
        },
        { getUserModel },
      ),
    );

    const result = await runHeartbeatContextProviders(makeInput());

    expect(result.userModel).toBeUndefined();
    expect(getUserModel).toHaveBeenCalledWith(fakeHandle, "user-unknown");
  });

  it("hits the cache on a second call within TTL and misses after expiry", async () => {
    const snapshot = buildSnapshot("user-42");
    const getUserModel = vi.fn<GetUserModelFn>().mockResolvedValue(snapshot);
    let nowMs = 1_000_000;
    registerHeartbeatContextProvider(
      createHermesLocalUserModelBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
          lookupUserId: async () => "user-42",
        },
        { getUserModel, cacheTtlMs: 30_000, now: () => nowMs },
      ),
    );

    await runHeartbeatContextProviders(makeInput());
    expect(getUserModel).toHaveBeenCalledTimes(1);

    nowMs += 29_000;
    await runHeartbeatContextProviders(makeInput());
    expect(getUserModel).toHaveBeenCalledTimes(1);

    nowMs += 2_000;
    await runHeartbeatContextProviders(makeInput());
    expect(getUserModel).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache when the userId changes (different assignee)", async () => {
    const getUserModel = vi.fn<GetUserModelFn>().mockImplementation(
      async (_handle, userId) => buildSnapshot(userId),
    );
    let currentUserId: string | null = "user-1";
    registerHeartbeatContextProvider(
      createHermesLocalUserModelBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
          lookupUserId: async () => currentUserId,
        },
        { getUserModel },
      ),
    );

    await runHeartbeatContextProviders(makeInput());
    currentUserId = "user-2";
    await runHeartbeatContextProviders(makeInput());

    expect(getUserModel).toHaveBeenCalledTimes(2);
    expect(getUserModel.mock.calls[0]![1]).toBe("user-1");
    expect(getUserModel.mock.calls[1]![1]).toBe("user-2");
  });

  it("swallows provider errors via onError", async () => {
    const getUserModel = vi
      .fn<GetUserModelFn>()
      .mockRejectedValue(new Error("acp boom"));
    registerHeartbeatContextProvider(
      createHermesLocalUserModelBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
          lookupUserId: async () => "user-42",
        },
        { getUserModel },
      ),
    );

    const onError = vi.fn();
    const result = await runHeartbeatContextProviders(makeInput(), { onError });

    expect(result).toEqual({});
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
