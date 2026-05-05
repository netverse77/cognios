import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";

import {
  asString,
  asStringArray,
  parseObject,
  buildPaperclipEnv,
  sanitizeInheritedPaperclipEnv,
} from "@paperclipai/adapter-utils/server-utils";

export interface HermesProcessSpec {
  agentId: string;
  companyId: string;
  /** Resolved interpreter, default "python". */
  command: string;
  /** Args passed to the interpreter, default ["-m", "acp_adapter.entry"]. */
  args: string[];
  /** Working directory for the spawned process; falls back to cwd. */
  cwd: string;
  /** Optional HERMES_HOME override. */
  hermesHome: string | null;
  /** Per-agent operator env (KEY=VALUE pairs). */
  extraEnv: Record<string, string>;
  /**
   * Stable identity computed by the registry to detect adapterConfig changes.
   * When the identity changes between heartbeats the registry recycles the
   * existing process before handing back a fresh one.
   */
  configIdentity: string;
}

export interface HermesProcessHandle {
  spec: HermesProcessSpec;
  child: ChildProcessWithoutNullStreams;
  /** Per-agent ACP session id, kept across heartbeats so we can `loadSession`. */
  sessionId: string | null;
  /** Set by the registry once the ACP `initialize` succeeds. */
  initialized: boolean;
  /** Last heartbeat that touched this process; used by future eviction. */
  lastUsedAt: number;
}

/** Public read-only view returned by lookup helpers. */
export interface HermesProcessSnapshot {
  agentId: string;
  configIdentity: string;
  pid: number | undefined;
  initialized: boolean;
  sessionId: string | null;
  lastUsedAt: number;
}

/**
 * In-process registry of long-lived `python -m acp_adapter.entry` children
 * keyed by agentId. Lifetime = server process. Recycled when the agent's
 * adapterConfig identity changes or when the child has exited.
 *
 * NOTE on lifetime: a server restart kills every Hermes child, which is
 * fine for the spike — Hermes' own session storage survives, and the next
 * heartbeat will `loadSession` against the persisted session id.
 */
export class HermesProcessRegistry {
  private readonly handles = new Map<string, HermesProcessHandle>();

  /**
   * Resolve the handle for an agent, spawning a fresh child if none exists
   * or if the existing one has exited or its config identity has changed.
   *
   * Spawning is intentionally synchronous from the caller's POV — the ACP
   * `initialize` handshake happens in the caller (acp-client.ts) so this
   * registry stays transport-agnostic.
   */
  acquire(spec: HermesProcessSpec): HermesProcessHandle {
    const existing = this.handles.get(spec.agentId);
    if (existing) {
      const sameConfig = existing.spec.configIdentity === spec.configIdentity;
      const stillRunning = existing.child.exitCode === null && !existing.child.killed;
      if (sameConfig && stillRunning) {
        existing.lastUsedAt = Date.now();
        return existing;
      }
      this.evict(spec.agentId, sameConfig ? "child_exited" : "config_changed");
    }
    const handle = this.spawn(spec);
    this.handles.set(spec.agentId, handle);
    return handle;
  }

  /**
   * Read-only lookup. Returns the existing handle for `agentId`, or null
   * when none has been spawned yet. Does NOT spawn a fresh process — used
   * by side-channels (heartbeat-context memory bridge) that must not
   * pay the cold-start cost.
   */
  get(agentId: string): HermesProcessHandle | null {
    const existing = this.handles.get(agentId);
    if (!existing) return null;
    const stillRunning = existing.child.exitCode === null && !existing.child.killed;
    return stillRunning ? existing : null;
  }

  /** Force-remove the handle for an agent. Kills the child if still alive. */
  evict(agentId: string, reason: string): void {
    const handle = this.handles.get(agentId);
    if (!handle) return;
    this.handles.delete(agentId);
    if (handle.child.exitCode === null && !handle.child.killed) {
      // Best-effort SIGTERM; the OS will reap the zombie. Heavy-handed
      // SIGKILL is reserved for the bounded-turn timeout path in execute.ts.
      try {
        handle.child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    handle.child.stderr?.emit("data", Buffer.from(`[hermes_local] evicted: ${reason}\n`));
  }

  /** Best-effort: kill every tracked child. Intended for server shutdown. */
  shutdown(): void {
    for (const agentId of Array.from(this.handles.keys())) {
      this.evict(agentId, "registry_shutdown");
    }
  }

  /** Test/debug helper. */
  snapshot(): HermesProcessSnapshot[] {
    return Array.from(this.handles.values()).map((h) => ({
      agentId: h.spec.agentId,
      configIdentity: h.spec.configIdentity,
      pid: h.child.pid,
      initialized: h.initialized,
      sessionId: h.sessionId,
      lastUsedAt: h.lastUsedAt,
    }));
  }

  private spawn(spec: HermesProcessSpec): HermesProcessHandle {
    const env: NodeJS.ProcessEnv = {
      ...sanitizeInheritedPaperclipEnv(process.env),
      ...spec.extraEnv,
      ...buildPaperclipEnv({ id: spec.agentId, companyId: spec.companyId }),
    };
    if (spec.hermesHome) env.HERMES_HOME = spec.hermesHome;

    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    return {
      spec,
      child,
      sessionId: null,
      initialized: false,
      lastUsedAt: Date.now(),
    };
  }
}

/**
 * Build a HermesProcessSpec from the raw adapter config + execution context.
 * Pure: same input always produces the same configIdentity, so the registry
 * can detect operator-driven config changes between heartbeats.
 */
export function buildHermesProcessSpec(input: {
  agentId: string;
  companyId: string;
  config: Record<string, unknown>;
  workspaceCwd: string;
}): HermesProcessSpec {
  const command = asString(input.config.hermesAcpCommand, "python");
  const rawArgs = asStringArray(input.config.hermesAcpArgs);
  const args = rawArgs.length > 0 ? rawArgs : ["-m", "acp_adapter.entry"];
  const hermesRepoPath = asString(input.config.hermesRepoPath, "").trim();
  const hermesHome = asString(input.config.hermesHome, "").trim();
  const cwd = (hermesRepoPath || input.workspaceCwd || process.cwd()).trim();
  const extraEnv = parseObject(input.config.env) as Record<string, string>;

  const identitySource = JSON.stringify({
    command,
    args,
    cwd,
    hermesHome: hermesHome || null,
    extraEnv,
  });
  const configIdentity = createHash("sha256").update(identitySource).digest("hex");

  return {
    agentId: input.agentId,
    companyId: input.companyId,
    command,
    args,
    cwd,
    hermesHome: hermesHome || null,
    extraEnv,
    configIdentity,
  };
}
