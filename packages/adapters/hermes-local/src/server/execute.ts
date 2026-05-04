import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";

import { createAcpClient, type PromptResult } from "./acp-client.js";
import {
  HermesProcessRegistry,
  buildHermesProcessSpec,
} from "./process-registry.js";
import { buildPrompt } from "./prompt-builder.js";

const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_GRACE_SEC = 5;

// Module-scoped so the registry survives across heartbeats while the
// adapter package stays loaded.
const processRegistry = new HermesProcessRegistry();

/**
 * Public accessor for the long-lived in-tree process registry. Side-channel
 * features (e.g. the COG-116 H3 heartbeat-context memory bridge) read from
 * this registry to find an already-spawned ACP process without paying for
 * a fresh acquire().
 */
export function getDefaultHermesProcessRegistry(): HermesProcessRegistry {
  return processRegistry;
}

/** Test-only helper. Not exported through the package barrel. */
export function __getRegistry(): HermesProcessRegistry {
  return processRegistry;
}

export async function execute(
  ctx: AdapterExecutionContext,
): Promise<AdapterExecutionResult> {
  const config = ctx.config ?? {};
  const workspaceCtx = parseObject(ctx.context.paperclipWorkspace);
  const workspaceCwd =
    asString(workspaceCtx.cwd, "") ||
    asString(config.cwd, "") ||
    process.cwd();

  const spec = buildHermesProcessSpec({
    agentId: ctx.agent.id,
    companyId: ctx.agent.companyId,
    config: config as Record<string, unknown>,
    workspaceCwd,
  });

  // Per-heartbeat env additions. These ride on top of the spawn env that
  // process-registry.ts already wired up via buildPaperclipEnv. We append
  // them to spec.extraEnv on the first acquire and never mutate after.
  const perHeartbeatEnv: Record<string, string> = {
    PAPERCLIP_RUN_ID: ctx.runId,
  };
  if (typeof ctx.authToken === "string" && ctx.authToken.trim().length > 0) {
    perHeartbeatEnv.PAPERCLIP_API_KEY = ctx.authToken;
  }
  const taskId = asString(ctx.context.taskId, "");
  if (taskId) perHeartbeatEnv.PAPERCLIP_TASK_ID = taskId;

  const handle = processRegistry.acquire({
    ...spec,
    extraEnv: { ...spec.extraEnv, ...perHeartbeatEnv },
  });

  const onMeta = ctx.onMeta;
  if (onMeta) {
    await onMeta({
      adapterType: "hermes_local",
      command: handle.spec.command,
      cwd: handle.spec.cwd,
      commandArgs: handle.spec.args,
      env: { HERMES_HOME: handle.spec.hermesHome ?? "(default)" },
      context: { configIdentity: handle.spec.configIdentity },
    });
  }

  const client = await createAcpClient(handle, ctx);

  if (!handle.initialized) {
    try {
      await client.initialize();
    } catch (err) {
      processRegistry.evict(ctx.agent.id, "initialize_failed");
      return failed(err, "hermes_local_initialize_failed");
    }
  }

  // Resume continuity if we have a sessionId from a prior heartbeat,
  // otherwise allocate a fresh one. Either way handle.sessionId is set on
  // success so the codec can persist it for the next heartbeat.
  try {
    if (handle.sessionId) {
      await client.loadSession(handle.sessionId, handle.spec.cwd);
    } else {
      await client.newSession(handle.spec.cwd);
    }
  } catch (err) {
    // A failed loadSession on a stale session id is recoverable; evict and
    // let the next heartbeat start fresh.
    processRegistry.evict(ctx.agent.id, "session_setup_failed");
    return failed(err, "hermes_local_session_setup_failed");
  }

  const sessionId = handle.sessionId;
  if (!sessionId) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorCode: "hermes_local_no_session",
      errorMessage:
        "Hermes ACP server returned without producing a session id; check acp_adapter.entry logs.",
    };
  }

  const built = buildPrompt({
    agent: { id: ctx.agent.id, name: ctx.agent.name },
    config: config as Record<string, unknown>,
    context: ctx.context as Record<string, unknown>,
    resumedSession: false,
  });

  const timeoutSec = asNumber(config.timeoutSec, DEFAULT_TIMEOUT_SEC);
  const graceSec = asNumber(config.graceSec, DEFAULT_GRACE_SEC);

  let timedOut = false;
  let promptResult: PromptResult | null = null;
  const cancelTimeout = setTimeout(() => {
    timedOut = true;
    void client.cancel(sessionId).catch(() => {
      // Cancel-best-effort; the SIGTERM/SIGKILL ladder handles the rest.
    });
    setTimeout(() => {
      if (handle.child.exitCode === null) {
        try {
          handle.child.kill("SIGTERM");
        } catch {}
      }
      setTimeout(() => {
        if (handle.child.exitCode === null) {
          try {
            handle.child.kill("SIGKILL");
          } catch {}
        }
      }, graceSec * 1000).unref();
    }, graceSec * 1000).unref();
  }, timeoutSec * 1000);
  cancelTimeout.unref();

  try {
    promptResult = await client.prompt(sessionId, built.text, {
      runId: ctx.runId,
      taskId: taskId || undefined,
    });
  } catch (err) {
    clearTimeout(cancelTimeout);
    return failed(err, "hermes_local_prompt_failed");
  }
  clearTimeout(cancelTimeout);

  await client.close();

  return {
    exitCode: timedOut ? 124 : 0,
    signal: null,
    timedOut,
    sessionParams: { sessionId, cwd: handle.spec.cwd },
    sessionDisplayId: sessionId,
    provider: "hermes",
    biller: null,
    model: asString(config.model, "") || null,
    billingType: "unknown",
    summary: `stop_reason=${promptResult?.stopReason ?? "unknown"}`,
    usage: promptResult?.usage
      ? {
          inputTokens: promptResult.usage.inputTokens ?? 0,
          outputTokens: promptResult.usage.outputTokens ?? 0,
          cachedInputTokens: promptResult.usage.cachedInputTokens,
        }
      : undefined,
    resultJson: promptResult ? { stopReason: promptResult.stopReason } : null,
  };
}

function failed(err: unknown, code: string): AdapterExecutionResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorCode: code,
    errorMessage: message,
  };
}
