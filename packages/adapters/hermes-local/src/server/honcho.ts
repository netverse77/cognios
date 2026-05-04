// User-model bridge — TS-side half of COG-116 H4.
//
// Wraps Hermes' `experimental/honchoUserModel` ACP method (delivered by the
// paired COG-136 hermes-agent PR) so the cognios heartbeat-context route
// can fold a per-peer Honcho user-model snapshot into the payload it
// returns to `hermes_local` agents.
//
// Read-only passthrough — Hermes owns the snapshot shape per COG-116 §2.5,
// so we deliberately keep the TS type permissive and only validate that
// `userId` round-trips as a string.

import type { HermesProcessHandleWithConnection } from "./memory.js";

/**
 * One peer's Honcho user-model snapshot, as surfaced by Hermes.
 *
 * Hermes owns the shape (read-only contract from COG-116 §2.5), so this
 * type intentionally uses a permissive index signature — the only field we
 * pin is `userId`, which is the lookup key the Paperclip bridge sent in.
 * Everything else is whatever Hermes' Honcho integration returned, untouched.
 */
export interface UserModelSnapshot {
  userId: string;
  [key: string]: unknown;
}

/**
 * Call `experimental/honchoUserModel` against the long-lived Hermes ACP
 * process owned by `HermesProcessRegistry` and return the snapshot for
 * `userId`, or `null` when there is no profile / Honcho is unconfigured /
 * the process hasn't been spawned yet.
 *
 * Heartbeat-context fires before execute() does, so the very first
 * request for an agent will see no connection — the caller MUST treat
 * `null` as "no profile yet" and not as an error.
 */
export async function getUserModel(
  handle: HermesProcessHandleWithConnection,
  userId: string,
): Promise<UserModelSnapshot | null> {
  const trimmed = (userId ?? "").trim();
  if (trimmed.length === 0) return null;

  const connection = handle.acpConnection;
  if (!connection) return null;
  if (!handle.initialized) return null;

  const response = await connection.extMethod("experimental/honchoUserModel", {
    userId: trimmed,
  });

  return parseUserModel(response, trimmed);
}

function parseUserModel(
  response: unknown,
  expectedUserId: string,
): UserModelSnapshot | null {
  if (!response || typeof response !== "object") return null;
  const raw = (response as { userModel?: unknown }).userModel;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;
  // Hermes is the source of truth; we only require that userId is a
  // non-empty string. If it's missing or wrong type, fall back to the
  // request key so callers always get a consistent identifier they
  // can correlate.
  const userId = typeof obj.userId === "string" && obj.userId.length > 0
    ? obj.userId
    : expectedUserId;

  return { ...obj, userId };
}
