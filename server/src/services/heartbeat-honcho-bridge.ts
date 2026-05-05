// hermes_local user-model bridge — folds Hermes' Honcho user-modelling
// output into the heartbeat-context payload as `userModel`.
//
// Companion to the COG-135 H3b memory bridge: same registry, same
// hermes_local adapter gate, same caching tradeoffs. Wired into the
// global registry by app.ts at boot. The builder is exported so tests
// can construct providers with mocked dependencies and fake clocks.

import type {
  HermesProcessHandleWithConnection,
  UserModelSnapshot,
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

/**
 * Resolve the Honcho peer/user identifier for a given agent, or `null` if
 * the agent has no associated user. Pluggable so the v1 default ("agentId
 * is the peer") can be replaced with a richer mapping later without
 * touching the bridge.
 */
export type AgentUserIdLookup = (agentId: string) => Promise<string | null>;

/** Pluggable user-model fetch — kept narrow so unit tests can stub it. */
export type GetUserModelFn = (
  handle: HermesProcessHandleWithConnection,
  userId: string,
) => Promise<UserModelSnapshot | null>;

export interface HermesLocalUserModelBridgeOptions {
  /** Cache TTL in milliseconds. Default 60s — user models change slowly. */
  cacheTtlMs?: number;
  /** Maximum number of cache entries kept in memory. */
  cacheMaxEntries?: number;
  /** Test seam so cache TTL tests don't have to wait wall-clock seconds. */
  now?: () => number;
  /** Test seam — defaults to the real `getUserModel` from the adapter. */
  getUserModel?: GetUserModelFn;
}

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 256;

interface CacheEntry {
  expiresAt: number;
  snapshot: UserModelSnapshot | null;
}

/**
 * Construct a heartbeat-context provider that runs only for agents whose
 * `adapterType === "hermes_local"`. Returns `{ userModel }` on hits;
 * returns `{}` for any other agent so the response stays unchanged for
 * non-Hermes adapters and for hermes_local agents without a known user.
 */
export function createHermesLocalUserModelBridge(
  deps: {
    lookupAdapterType: AgentAdapterTypeLookup;
    lookupHandle: HermesProcessHandleLookup;
    lookupUserId: AgentUserIdLookup;
  },
  options: HermesLocalUserModelBridgeOptions = {},
): HeartbeatContextProvider {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const fetchFn: GetUserModelFn = options.getUserModel ?? defaultGetUserModel;

  const cache = new Map<string, CacheEntry>();

  return async function hermesLocalUserModelBridge(
    input: HeartbeatContextProviderInput,
  ): Promise<{ userModel?: UserModelSnapshot }> {
    const agentId = input.issue.assigneeAgentId;
    if (!agentId) return {};

    const adapterType = await deps.lookupAdapterType(agentId);
    if (adapterType !== "hermes_local") return {};

    const userId = await deps.lookupUserId(agentId);
    if (!userId) return {};

    const cacheKey = `${agentId}:${userId}`;
    const ts = now();
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > ts) {
      return hit.snapshot ? { userModel: hit.snapshot } : {};
    }

    const handle = deps.lookupHandle(agentId);
    if (!handle) return {};

    const snapshot = await fetchFn(handle, userId);

    if (cache.size >= cacheMaxEntries) {
      // Drop the oldest entry — Map preserves insertion order.
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(cacheKey, { expiresAt: ts + cacheTtlMs, snapshot });

    return snapshot ? { userModel: snapshot } : {};
  };
}

async function defaultGetUserModel(
  handle: HermesProcessHandleWithConnection,
  userId: string,
): Promise<UserModelSnapshot | null> {
  // Lazy import to keep the cognios server bundle from pulling the
  // adapter package onto the hot heartbeat-context path when the
  // bridge is never actually exercised.
  const adapter = await import("@paperclipai/adapter-hermes-local/server");
  return adapter.getUserModel(handle, userId);
}
