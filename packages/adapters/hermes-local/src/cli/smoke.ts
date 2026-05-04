// scripts/hermes-local-smoke.sh entrypoint.
//
// Single-turn live ACP exchange driver. Spawns `python -m acp_adapter.entry`
// (or whatever the operator points HERMES_ACP_COMMAND/HERMES_ACP_ARGS at),
// runs initialize → newSession → prompt → close, and exits non-zero on any
// failure. Used for the H3 board-mandated "live ACP exchange" check and as
// the E2E core of the H4 acceptance flow.
//
// Run with:
//   node --import tsx packages/adapters/hermes-local/src/cli/smoke.ts \
//     --hermes-repo /path/to/hermes-agent \
//     --message "Say hello"
//
// Pure CLI shape — does not start a Paperclip server. The H4 issue-update
// step is layered on top of this driver in scripts/hermes-local-smoke.sh.

import process from "node:process";

import { createAcpClient } from "../server/acp-client.js";
import { execute } from "../server/execute.js";
import {
  HermesProcessRegistry,
  buildHermesProcessSpec,
} from "../server/process-registry.js";
import type {
  AdapterExecutionContext,
  AdapterAgent,
} from "@paperclipai/adapter-utils";

interface CliArgs {
  hermesRepo: string | null;
  hermesHome: string | null;
  message: string;
  timeoutSec: number;
  modelId: string | null;
  command: string | null;
  args: string[] | null;
  skipPrompt: boolean;
  initializeOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    hermesRepo: process.env.HERMES_REPO_PATH || null,
    hermesHome: process.env.HERMES_HOME || null,
    message: "Smoke check from hermes_local adapter. Reply with 'ok'.",
    timeoutSec: 60,
    modelId: process.env.HERMES_MODEL || null,
    command: process.env.HERMES_ACP_COMMAND || null,
    args: process.env.HERMES_ACP_ARGS
      ? process.env.HERMES_ACP_ARGS.split(/\s+/).filter(Boolean)
      : null,
    skipPrompt: process.env.HERMES_SMOKE_SKIP_PROMPT === "1",
    initializeOnly: process.env.HERMES_SMOKE_INITIALIZE_ONLY === "1",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--hermes-repo":
        out.hermesRepo = next ?? null;
        i++;
        break;
      case "--hermes-home":
        out.hermesHome = next ?? null;
        i++;
        break;
      case "--message":
        out.message = next ?? out.message;
        i++;
        break;
      case "--timeout-sec":
        out.timeoutSec = Number(next ?? out.timeoutSec);
        i++;
        break;
      case "--model":
        out.modelId = next ?? null;
        i++;
        break;
      case "--command":
        out.command = next ?? null;
        i++;
        break;
      case "--args":
        out.args = (next ?? "").split(/\s+/).filter(Boolean);
        i++;
        break;
      case "--skip-prompt":
        // Stops after newSession — proves the live ACP wire-up
        // (initialize + newSession round-trip). Useful for dev/integration
        // envs that have a provider configured but want to skip the
        // bounded-turn prompt round-trip.
        out.skipPrompt = true;
        break;
      case "--initialize-only":
        // Stops after initialize — the wire-protocol-only mode used by
        // CI. Asserts the negotiated protocolVersion came back and exits
        // 0. No newSession, so no LLM provider configuration is needed
        // on the Hermes side. See COG-128 for the rationale.
        out.initializeOnly = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (a.startsWith("--")) {
          process.stderr.write(`[hermes_local:smoke] unknown flag ${a}\n`);
          process.exit(2);
        }
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    [
      "hermes_local smoke driver — single bounded ACP turn",
      "",
      "Usage:",
      "  node --import tsx src/cli/smoke.ts [flags]",
      "",
      "Flags:",
      "  --hermes-repo <path>    Path to hermes-agent/ checkout (cwd of spawned process)",
      "  --hermes-home <path>    HERMES_HOME for the spawned process",
      "  --message <text>        Prompt to send (default: smoke ping)",
      "  --timeout-sec <n>       Hard wall-clock budget for this turn (default 60)",
      "  --model <id>            Model id passed through to the ACP session",
      "  --command <bin>         Override interpreter (default: python)",
      "  --args   <a b c>        Override args (default: -m acp_adapter.entry)",
      "  --skip-prompt           Stop after initialize + newSession (provider-equipped envs that want to skip the prompt turn)",
      "  --initialize-only       Stop after initialize (CI default — wire format only, no provider required)",
      "",
      "Env: HERMES_REPO_PATH, HERMES_HOME, HERMES_MODEL, HERMES_ACP_COMMAND,",
      "     HERMES_ACP_ARGS, HERMES_SMOKE_SKIP_PROMPT (=1 enables --skip-prompt),",
      "     HERMES_SMOKE_INITIALIZE_ONLY (=1 enables --initialize-only)",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const config: Record<string, unknown> = {
    timeoutSec: args.timeoutSec,
  };
  if (args.command) config.hermesAcpCommand = args.command;
  if (args.args && args.args.length > 0) config.hermesAcpArgs = args.args;
  if (args.hermesRepo) config.hermesRepoPath = args.hermesRepo;
  if (args.hermesHome) config.hermesHome = args.hermesHome;
  if (args.modelId) config.model = args.modelId;

  const agent: AdapterAgent = {
    id: process.env.PAPERCLIP_AGENT_ID || "smoke-agent",
    companyId: process.env.PAPERCLIP_COMPANY_ID || "smoke-company",
    name: "hermes-local-smoke",
    adapterType: "hermes_local",
    adapterConfig: config,
  };

  const ctx: AdapterExecutionContext = {
    runId: process.env.PAPERCLIP_RUN_ID || `smoke-${Date.now()}`,
    agent,
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: process.env.PAPERCLIP_TASK_ID || "smoke-task",
    } as AdapterExecutionContext["runtime"],
    config,
    context: {
      paperclipWorkspace: {
        cwd: args.hermesRepo || process.cwd(),
      },
      taskId: process.env.PAPERCLIP_TASK_ID || "smoke-task",
      paperclipWakePayload: {
        reason: "smoke",
        message: args.message,
      },
    } as AdapterExecutionContext["context"],
    onLog: async (kind, text) => {
      const stream = kind === "stderr" ? process.stderr : process.stdout;
      stream.write(text.endsWith("\n") ? text : `${text}\n`);
    },
    onMeta: async (meta) => {
      process.stderr.write(`[hermes_local:smoke] meta ${JSON.stringify(meta)}\n`);
    },
    authToken: process.env.PAPERCLIP_API_KEY || undefined,
  };

  process.stderr.write(
    `[hermes_local:smoke] launching ${args.command ?? "python"} ${(args.args ?? ["-m", "acp_adapter.entry"]).join(" ")} cwd=${args.hermesRepo ?? process.cwd()} initializeOnly=${args.initializeOnly} skipPrompt=${args.skipPrompt}\n`,
  );

  // Mode precedence: --initialize-only is the most-restricted (handshake only,
  // no provider needed) and wins if both are set, since it's a strict subset.
  if (args.initializeOnly) {
    await runInitializeOnlySmoke(ctx, config);
    return;
  }

  if (args.skipPrompt) {
    await runSkipPromptSmoke(ctx, config);
    return;
  }

  const result = await execute(ctx);

  process.stderr.write(
    `[hermes_local:smoke] result ${JSON.stringify({
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      errorCode: result.errorCode,
      summary: result.summary,
      sessionDisplayId: result.sessionDisplayId,
      usage: result.usage,
    })}\n`,
  );

  if (result.exitCode !== 0) {
    process.stderr.write(
      `[hermes_local:smoke] FAIL exitCode=${result.exitCode} errorCode=${result.errorCode ?? ""} message=${
        result.errorMessage ?? ""
      }\n`,
    );
    process.exit(result.exitCode || 1);
  }
  process.stderr.write(`[hermes_local:smoke] PASS\n`);
  process.exit(0);
}

/**
 * --initialize-only code path.
 *
 * Drives `initialize` only against a live `python -m acp_adapter.entry`,
 * asserts that the negotiated protocolVersion came back, and exits 0.
 *
 * This is the wire-protocol-only mode: it proves the registry + ACP client
 * wrapper + JSON-RPC framing + process spawn all work end-to-end, without
 * touching `session/new` (which constructs a session object that pulls a
 * configured LLM provider). CI uses this mode because GitHub Actions has no
 * LLM provider creds and `session/new` would otherwise fail with
 * `No LLM provider configured`. See COG-128 for the rationale.
 */
async function runInitializeOnlySmoke(
  ctx: AdapterExecutionContext,
  config: Record<string, unknown>,
): Promise<void> {
  const registry = new HermesProcessRegistry();
  const workspace = (ctx.context.paperclipWorkspace ?? {}) as { cwd?: string };
  const spec = buildHermesProcessSpec({
    agentId: ctx.agent.id,
    companyId: ctx.agent.companyId,
    config,
    workspaceCwd: workspace.cwd ?? process.cwd(),
  });
  const handle = registry.acquire(spec);
  process.stderr.write(
    `[hermes_local:smoke] spawned pid=${handle.child.pid} cwd=${handle.spec.cwd} configIdentity=${handle.spec.configIdentity.slice(0, 12)}\n`,
  );

  handle.child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(`[acp:stderr] ${chunk.toString().replace(/\n+$/, "")}\n`);
  });

  let success = false;
  try {
    const client = await createAcpClient(handle, ctx);
    const initResult = await client.initialize();
    process.stderr.write(
      `[hermes_local:smoke] initialize ok protocolVersion=${initResult.protocolVersion} agentInfo=${JSON.stringify(initResult.agentInfo ?? {})}\n`,
    );

    if (typeof initResult.protocolVersion !== "number") {
      throw new Error(
        `initialize returned non-numeric protocolVersion=${JSON.stringify(initResult.protocolVersion)}`,
      );
    }

    success = true;
  } catch (err) {
    const message = formatError(err);
    process.stderr.write(`[hermes_local:smoke] FAIL --initialize-only\n${message}\n`);
  } finally {
    registry.shutdown();
  }

  if (success) {
    process.stderr.write(`[hermes_local:smoke] PASS (initialize-only mode)\n`);
    process.exit(0);
  }
  process.exit(1);
}

/**
 * --skip-prompt code path.
 *
 * Drives `initialize` + `newSession` against a live `python -m acp_adapter.entry`
 * and exits as soon as the session id comes back. Captures the negotiated
 * protocol version and session id so logs carry the spike-doc evidence.
 *
 * Use this in dev/integration envs that have an LLM provider configured but
 * want to skip the bounded-turn prompt round-trip. CI uses --initialize-only
 * instead, since GitHub Actions has no provider creds and `session/new`
 * fails with `No LLM provider configured` (see COG-128).
 */
async function runSkipPromptSmoke(
  ctx: AdapterExecutionContext,
  config: Record<string, unknown>,
): Promise<void> {
  const registry = new HermesProcessRegistry();
  const workspace = (ctx.context.paperclipWorkspace ?? {}) as { cwd?: string };
  const spec = buildHermesProcessSpec({
    agentId: ctx.agent.id,
    companyId: ctx.agent.companyId,
    config,
    workspaceCwd: workspace.cwd ?? process.cwd(),
  });
  const handle = registry.acquire(spec);
  process.stderr.write(
    `[hermes_local:smoke] spawned pid=${handle.child.pid} cwd=${handle.spec.cwd} configIdentity=${handle.spec.configIdentity.slice(0, 12)}\n`,
  );

  // Surface stderr from the Python child so CI logs the ACP server's own
  // startup lines. The registry never reads stderr itself, so without this
  // the smoke logs would be silent on the Python side.
  handle.child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(`[acp:stderr] ${chunk.toString().replace(/\n+$/, "")}\n`);
  });

  let success = false;
  try {
    const client = await createAcpClient(handle, ctx);
    const initResult = await client.initialize();
    process.stderr.write(
      `[hermes_local:smoke] initialize ok protocolVersion=${initResult.protocolVersion} agentInfo=${JSON.stringify(initResult.agentInfo ?? {})}\n`,
    );

    const session = await client.newSession(handle.spec.cwd);
    process.stderr.write(
      `[hermes_local:smoke] newSession ok sessionId=${session.sessionId}\n`,
    );

    success = true;
  } catch (err) {
    const message = formatError(err);
    process.stderr.write(`[hermes_local:smoke] FAIL --skip-prompt\n${message}\n`);
  } finally {
    registry.shutdown();
  }

  if (success) {
    process.stderr.write(`[hermes_local:smoke] PASS (skip-prompt mode)\n`);
    process.exit(0);
  }
  process.exit(1);
}

main().catch((err: unknown) => {
  const message = formatError(err);
  process.stderr.write(`[hermes_local:smoke] FATAL\n${message}\n`);
  process.exit(1);
});

/**
 * Stringify an unknown thrown value for CI logs. The ACP SDK throws plain
 * JSON-RPC error objects of shape `{ code, message, data }` (not Error
 * instances) when the agent returns an error response, so falling back to
 * `String(err)` would print "[object Object]". Prefer `Error.stack`/`message`
 * when available, then JSON, then the unhelpful default.
 */
function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack || err.message;
  }
  if (err === null || err === undefined) {
    return String(err);
  }
  if (typeof err === "object") {
    try {
      return JSON.stringify(err, null, 2);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
