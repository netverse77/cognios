// Module-level registry of heartbeat-context "extras" providers.
//
// The /api/issues/:id/heartbeat-context route runs each registered
// provider, awaits its partial extras object, and shallow-merges them
// into the response. Providers are intentionally side-effect-only on the
// response shape — they MUST NOT throw; errors are swallowed and logged
// so the route stays read-safe.
//
// First user is the COG-116 H3 hermes-local memory bridge: it injects
// `memorySnippets` for `hermes_local` agents only (see
// packages/adapters/hermes-local + the boot hook in app.ts).

import type {
  MemorySnippet,
  UserModelSnapshot,
} from "@paperclipai/adapter-hermes-local/server";

/**
 * Optional fields a provider can contribute to the heartbeat-context
 * payload. Keep this union narrow on purpose — every new field needs a
 * matching shape decision in the route handler.
 */
export interface HeartbeatContextExtras {
  memorySnippets: MemorySnippet[];
  userModel: UserModelSnapshot;
}

/** Minimal slice of the issue we hand each provider. */
export interface HeartbeatContextProviderInput {
  issue: {
    id: string;
    identifier: string | null;
    title: string;
    assigneeAgentId: string | null;
  };
  /** Latest comment id at the time of the request — used as a cache key. */
  latestCommentId: string | null;
  /** Up to two most-recent comment bodies; used by query-builders. */
  recentCommentBodies: string[];
}

export type HeartbeatContextProvider = (
  input: HeartbeatContextProviderInput,
) => Promise<Partial<HeartbeatContextExtras>>;

const providers: HeartbeatContextProvider[] = [];

/** Register a provider. Idempotent — duplicates are ignored. */
export function registerHeartbeatContextProvider(provider: HeartbeatContextProvider): void {
  if (!providers.includes(provider)) providers.push(provider);
}

/** Test-only helper. */
export function clearHeartbeatContextProviders(): void {
  providers.length = 0;
}

/**
 * Run every registered provider in parallel and merge the results.
 * Provider failures are swallowed (and logged via the optional `onError`
 * hook) so a misbehaving provider can never break the route.
 */
export async function runHeartbeatContextProviders(
  input: HeartbeatContextProviderInput,
  options: { onError?: (provider: HeartbeatContextProvider, err: unknown) => void } = {},
): Promise<Partial<HeartbeatContextExtras>> {
  if (providers.length === 0) return {};
  const settled = await Promise.allSettled(providers.map((p) => p(input)));
  const merged: Partial<HeartbeatContextExtras> = {};
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      Object.assign(merged, result.value);
    } else if (options.onError) {
      try {
        options.onError(providers[i]!, result.reason);
      } catch {
        // Logging shouldn't break heartbeat-context either.
      }
    }
  }
  return merged;
}
