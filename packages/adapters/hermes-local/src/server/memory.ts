// Memory bridge — TS-side half of COG-116 H3.
//
// Wraps Hermes' `experimental/factSearch` ACP method (delivered by COG-134)
// so the cognios heartbeat-context route can fold a small set of relevant
// memory snippets into the payload it returns to `hermes_local` agents.
//
// We deliberately type our own narrow handle shape rather than re-declaring
// the SdkConnection here, so this module stays import-cheap and easy to mock
// in unit tests on the cognios server side.

import type { HermesProcessHandle } from "./process-registry.js";

/**
 * One fact returned by Hermes' fact retriever, narrowed to the fields the
 * heartbeat-context payload needs. Matches the response shape pinned in
 * COG-134 (`{ snippets: [{ factId, content, score, createdAt }] }`).
 */
export interface MemorySnippet {
  factId: string;
  content: string;
  score: number;
  createdAt: string;
}

/**
 * Minimal slice of the SDK's ClientSideConnection we depend on.
 *
 * `extMethod` is the SDK's first-class extension hook for non-spec ACP
 * methods (`@agentclientprotocol/sdk@0.11`, dist/acp.d.ts:365). Hermes
 * registers `experimental/factSearch` as one of those.
 */
export interface AcpExtMethodConnection {
  extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Historical alias preserved for callers that imported the `WithConnection`
 * shape before the connection field moved onto the base handle type
 * (COG-137). The base `HermesProcessHandle.acpConnection` is `null` until
 * `createAcpClient` wraps the child in a live SDK connection — heartbeat-
 * context fires before execute() does, so callers MUST still treat an empty
 * result as "no memory yet" and not as an error.
 */
export type HermesProcessHandleWithConnection = HermesProcessHandle;

const MAX_QUERY_CHARS = 4096;
const MIN_TOPK = 1;
const MAX_TOPK = 100;

/**
 * Call `experimental/factSearch` against the long-lived Hermes ACP process
 * owned by `HermesProcessRegistry` and return up to `topK` snippets.
 *
 * Returns `[]` (rather than throwing) when there is no cached ACP
 * connection on the handle yet — heartbeat-context is read-only and must
 * not block the response when memory is unavailable.
 */
export async function searchFacts(
  handle: HermesProcessHandleWithConnection,
  query: string,
  topK = 3,
): Promise<MemorySnippet[]> {
  const trimmed = (query ?? "").trim();
  if (trimmed.length === 0) return [];

  const connection = handle.acpConnection;
  if (!connection) return [];
  if (!handle.initialized) return [];

  const safeQuery = trimmed.slice(0, MAX_QUERY_CHARS);
  const safeTopK = Math.max(MIN_TOPK, Math.min(topK, MAX_TOPK));

  const response = await connection.extMethod("experimental/factSearch", {
    query: safeQuery,
    topK: safeTopK,
  });

  return parseSnippets(response, safeTopK);
}

function parseSnippets(response: unknown, topK: number): MemorySnippet[] {
  if (!response || typeof response !== "object") return [];
  const raw = (response as { snippets?: unknown }).snippets;
  if (!Array.isArray(raw)) return [];

  const out: MemorySnippet[] = [];
  for (const item of raw) {
    if (out.length >= topK) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.factId !== "string" ||
      typeof r.content !== "string" ||
      typeof r.score !== "number" ||
      typeof r.createdAt !== "string"
    ) {
      continue;
    }
    out.push({
      factId: r.factId,
      content: r.content,
      score: r.score,
      createdAt: r.createdAt,
    });
  }
  return out;
}
