// hermes_local memory bridge — builds a HeartbeatContextProvider that
// folds Hermes' fact retriever output into the heartbeat-context payload.
//
// Wired into the global registry by app.ts at boot. The builder is
// exported so tests can construct providers with mocked dependencies and
// fake clocks.

import type {
  MemorySnippet,
  HermesProcessHandleWithConnection,
} from "@paperclipai/adapter-hermes-local/server";

import type {
  HeartbeatContextProvider,
  HeartbeatContextProviderInput,
} from "./heartbeat-context-providers.js";

/** Look up the adapter type for a given agent, or `null` when unknown. */
export type AgentAdapterTypeLookup = (agentId: string) => Promise<string | null>;

/** Look up the long-lived ACP handle for a given agent, or `null` when not yet spawned. */
export type HermesProcessHandleLookup = (
  agentId: string,
) => HermesProcessHandleWithConnection | null;

/** Pluggable fact-search call — kept narrow so unit tests can stub it. */
export type FactSearchFn = (
  handle: HermesProcessHandleWithConnection,
  query: string,
  topK: number,
) => Promise<MemorySnippet[]>;

export interface HermesLocalMemoryBridgeOptions {
  /** Snippet count to request per heartbeat. Default 3, per COG-116 plan §2.4. */
  topK?: number;
  /** Cache TTL in milliseconds. Default 30s — matches spike load tolerance. */
  cacheTtlMs?: number;
  /** Maximum number of cache entries kept in memory. */
  cacheMaxEntries?: number;
  /** Hard cap on the query string handed to Hermes. */
  queryCharCap?: number;
  /** Test seam so cache TTL tests don't have to wait wall-clock seconds. */
  now?: () => number;
  /** Test seam — defaults to the real `searchFacts` from the adapter. */
  searchFacts?: FactSearchFn;
}

const DEFAULT_TOPK = 3;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_CACHE_MAX_ENTRIES = 256;
const DEFAULT_QUERY_CHAR_CAP = 512;

interface CacheEntry {
  expiresAt: number;
  snippets: MemorySnippet[];
}

/**
 * Construct a heartbeat-context provider that runs only for agents whose
 * `adapterType === "hermes_local"`. Returns `{ memorySnippets }` on hits;
 * returns `{}` for any other agent so the response stays unchanged for
 * non-Hermes adapters.
 */
export function createHermesLocalMemoryBridge(
  deps: {
    lookupAdapterType: AgentAdapterTypeLookup;
    lookupHandle: HermesProcessHandleLookup;
  },
  options: HermesLocalMemoryBridgeOptions = {},
): HeartbeatContextProvider {
  const topK = options.topK ?? DEFAULT_TOPK;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  const queryCharCap = options.queryCharCap ?? DEFAULT_QUERY_CHAR_CAP;
  const now = options.now ?? Date.now;
  const searchFn: FactSearchFn = options.searchFacts ?? defaultSearchFacts;

  const cache = new Map<string, CacheEntry>();

  return async function hermesLocalMemoryBridge(
    input: HeartbeatContextProviderInput,
  ): Promise<{ memorySnippets?: MemorySnippet[] }> {
    const agentId = input.issue.assigneeAgentId;
    if (!agentId) return {};

    const adapterType = await deps.lookupAdapterType(agentId);
    if (adapterType !== "hermes_local") return {};

    const cacheKey = `${input.issue.id}:${input.latestCommentId ?? ""}`;
    const ts = now();
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > ts) {
      return { memorySnippets: hit.snippets };
    }

    const query = buildQuery(input.issue.title, input.recentCommentBodies, queryCharCap);
    if (!query) return {};

    const handle = deps.lookupHandle(agentId);
    if (!handle) return {};

    const snippets = await searchFn(handle, query, topK);

    if (cache.size >= cacheMaxEntries) {
      // Drop the oldest entry — Map preserves insertion order.
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(cacheKey, { expiresAt: ts + cacheTtlMs, snippets });

    return { memorySnippets: snippets };
  };
}

function buildQuery(title: string, comments: string[], cap: number): string {
  const parts: string[] = [];
  if (title && title.trim().length > 0) parts.push(title.trim());
  for (const body of comments) {
    if (typeof body === "string" && body.trim().length > 0) {
      parts.push(body.trim());
    }
  }
  const joined = parts.join("\n\n");
  if (joined.length === 0) return "";
  return joined.length > cap ? joined.slice(0, cap) : joined;
}

async function defaultSearchFacts(
  handle: HermesProcessHandleWithConnection,
  query: string,
  topK: number,
): Promise<MemorySnippet[]> {
  // Lazy import to keep the cognios server bundle from pulling the
  // adapter package onto the hot heartbeat-context path when the bridge
  // is never actually exercised (e.g. tests, non-Hermes companies).
  const adapter = await import("@paperclipai/adapter-hermes-local/server");
  return adapter.searchFacts(handle, query, topK);
}
