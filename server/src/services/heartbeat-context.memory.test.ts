// COG-135 H3b unit test for the hermes_local heartbeat-context memory bridge.
//
// Exercises the provider through `runHeartbeatContextProviders` (the same
// entry point the heartbeat-context route uses) with a mocked
// `searchFacts` so we don't need a live ACP process.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemorySnippet } from "@paperclipai/adapter-hermes-local/server";
import {
  clearHeartbeatContextProviders,
  registerHeartbeatContextProvider,
  runHeartbeatContextProviders,
  type HeartbeatContextProviderInput,
} from "./heartbeat-context-providers.js";
import {
  createHermesLocalMemoryBridge,
  type FactSearchFn,
} from "./heartbeat-memory-bridge.js";

const HERMES_AGENT = "agent-hermes";
const OTHER_AGENT = "agent-claude";

function makeInput(
  overrides: Partial<HeartbeatContextProviderInput> = {},
): HeartbeatContextProviderInput {
  return {
    issue: {
      id: "issue-1",
      identifier: "COG-135",
      title: "memory bridge",
      assigneeAgentId: HERMES_AGENT,
      ...overrides.issue,
    },
    latestCommentId: overrides.latestCommentId ?? "comment-1",
    recentCommentBodies: overrides.recentCommentBodies ?? ["why does this fail?"],
  };
}

const fakeHandle = {
  spec: {} as never,
  child: {} as never,
  sessionId: "session-1",
  initialized: true,
  lastUsedAt: 0,
  acpConnection: { extMethod: async () => ({ snippets: [] }) },
};

function buildSnippet(id: string): MemorySnippet {
  return {
    factId: id,
    content: `content-${id}`,
    score: 0.5,
    createdAt: "2026-05-04T00:00:00.000Z",
  };
}

afterEach(() => {
  clearHeartbeatContextProviders();
});

describe("hermes_local heartbeat-context memory bridge", () => {
  it("returns memorySnippets shaped from searchFacts for hermes_local agents", async () => {
    const searchFacts = vi.fn<FactSearchFn>().mockResolvedValue([
      buildSnippet("a"),
      buildSnippet("b"),
      buildSnippet("c"),
    ]);
    registerHeartbeatContextProvider(
      createHermesLocalMemoryBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
        },
        { searchFacts, topK: 3 },
      ),
    );

    const result = await runHeartbeatContextProviders(makeInput());

    expect(result.memorySnippets).toHaveLength(3);
    expect(result.memorySnippets?.[0]).toEqual(buildSnippet("a"));
    expect(searchFacts).toHaveBeenCalledTimes(1);
    const [, query, topKArg] = searchFacts.mock.calls[0]!;
    expect(query).toContain("memory bridge"); // title
    expect(query).toContain("why does this fail?"); // recent comment
    expect(topKArg).toBe(3);
  });

  it("truncates results to topK", async () => {
    const sevenSnippets = Array.from({ length: 7 }, (_, i) => buildSnippet(`s${i}`));
    const searchFacts = vi.fn<FactSearchFn>().mockImplementation(
      async (_handle, _query, topK) => sevenSnippets.slice(0, topK),
    );
    registerHeartbeatContextProvider(
      createHermesLocalMemoryBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
        },
        { searchFacts, topK: 2 },
      ),
    );

    const result = await runHeartbeatContextProviders(makeInput());

    expect(result.memorySnippets).toHaveLength(2);
    expect(searchFacts).toHaveBeenCalledWith(fakeHandle, expect.any(String), 2);
  });

  it("hits the cache on a second call within TTL and misses after expiry", async () => {
    const searchFacts = vi.fn<FactSearchFn>().mockResolvedValue([buildSnippet("a")]);
    let nowMs = 1_000_000;
    registerHeartbeatContextProvider(
      createHermesLocalMemoryBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
        },
        { searchFacts, cacheTtlMs: 30_000, now: () => nowMs, topK: 3 },
      ),
    );

    await runHeartbeatContextProviders(makeInput());
    expect(searchFacts).toHaveBeenCalledTimes(1);

    // Within TTL — should be a cache hit.
    nowMs += 29_000;
    await runHeartbeatContextProviders(makeInput());
    expect(searchFacts).toHaveBeenCalledTimes(1);

    // Past TTL — should refetch.
    nowMs += 2_000;
    await runHeartbeatContextProviders(makeInput());
    expect(searchFacts).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache when latestCommentId changes (new comment arrived)", async () => {
    const searchFacts = vi.fn<FactSearchFn>().mockResolvedValue([buildSnippet("a")]);
    registerHeartbeatContextProvider(
      createHermesLocalMemoryBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
        },
        { searchFacts },
      ),
    );

    await runHeartbeatContextProviders(makeInput({ latestCommentId: "c1" }));
    await runHeartbeatContextProviders(makeInput({ latestCommentId: "c2" }));

    expect(searchFacts).toHaveBeenCalledTimes(2);
  });

  it("returns no memorySnippets for non-hermes adapters", async () => {
    const searchFacts = vi.fn<FactSearchFn>();
    registerHeartbeatContextProvider(
      createHermesLocalMemoryBridge(
        {
          lookupAdapterType: async () => "claude_local",
          lookupHandle: () => fakeHandle,
        },
        { searchFacts },
      ),
    );

    const result = await runHeartbeatContextProviders(
      makeInput({ issue: { id: "i", identifier: null, title: "t", assigneeAgentId: OTHER_AGENT } }),
    );

    expect(result.memorySnippets).toBeUndefined();
    expect(searchFacts).not.toHaveBeenCalled();
  });

  it("returns no memorySnippets when no ACP handle has been spawned yet", async () => {
    const searchFacts = vi.fn<FactSearchFn>();
    registerHeartbeatContextProvider(
      createHermesLocalMemoryBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => null,
        },
        { searchFacts },
      ),
    );

    const result = await runHeartbeatContextProviders(makeInput());

    expect(result.memorySnippets).toBeUndefined();
    expect(searchFacts).not.toHaveBeenCalled();
  });

  it("swallows provider errors via onError", async () => {
    const searchFacts = vi.fn<FactSearchFn>().mockRejectedValue(new Error("acp boom"));
    registerHeartbeatContextProvider(
      createHermesLocalMemoryBridge(
        {
          lookupAdapterType: async () => "hermes_local",
          lookupHandle: () => fakeHandle,
        },
        { searchFacts },
      ),
    );

    const onError = vi.fn();
    const result = await runHeartbeatContextProviders(makeInput(), { onError });

    expect(result).toEqual({});
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
