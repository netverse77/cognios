// All `@agentclientprotocol/sdk` imports live in this file. If the upstream
// SDK ships a different signature than what's documented today, only this
// wrapper needs to change; execute.ts, prompt-builder.ts, transcript.ts,
// and process-registry.ts stay stable.
//
// SDK reference (verified via context7 against
// /agentclientprotocol/agent-client-protocol on 2026-04-25):
//   - npm package: @agentclientprotocol/sdk
//   - Class: ClientSideConnection
//   - Methods on returned connection (Agent interface):
//       initialize, newSession, loadSession?, prompt, cancel
//   - Method names on the wire: initialize, session/new, session/load,
//       session/prompt, session/cancel, session/update (notification)
//   - Protocol version: integer (e.g. 1)
//
// The actual Node-stream wiring shape (Web streams vs Duplex, exact Client
// interface members) is the part most likely to need an H3 tweak once we
// can `pnpm install` and typecheck against the real SDK.

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";

import type { HermesProcessHandle } from "./process-registry.js";
import { emitSessionUpdate, type SessionUpdateEnvelope } from "./transcript.js";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

// Re-declared locally so callers don't have to import from the SDK.
// Mirrors the structures documented at
// https://zed-industries.github.io/agent-client-protocol/.
export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: Record<string, unknown>;
    [extra: string]: unknown;
  };
  agentInfo?: { name?: string; version?: string };
  authMethods?: Array<{ id: string; name?: string; description?: string }>;
}

export interface NewSessionResult {
  sessionId: string;
  models?: unknown;
}

export interface PromptResult {
  stopReason: "end_turn" | "max_tokens" | "max_turns" | "refusal" | "cancelled" | string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
  };
  userMessageId?: string;
}

export interface PromptOptions {
  /**
   * Per-turn Paperclip run id. Threaded onto the ACP request envelope as
   * `_meta.requestId` so Hermes-side tooling (memory writes, traces) can tag
   * facts with the run that produced them. Coordinated with COG-116 (Nova).
   */
  runId?: string;
  /** Optional Paperclip task id for the same audit purpose. */
  taskId?: string;
}

export interface AcpClient {
  initialize(): Promise<InitializeResult>;
  newSession(cwd: string): Promise<NewSessionResult>;
  loadSession(sessionId: string, cwd: string): Promise<void>;
  prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult>;
  cancel(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

interface SdkConnection {
  initialize(params: {
    protocolVersion: number;
    clientCapabilities?: Record<string, unknown>;
    clientInfo?: { name: string; title?: string; version?: string };
  }): Promise<InitializeResult>;
  newSession(params: { cwd: string; mcpServers?: unknown[] }): Promise<NewSessionResult>;
  loadSession?(params: { sessionId: string; cwd: string; mcpServers?: unknown[] }): Promise<unknown>;
  prompt(params: {
    sessionId: string;
    prompt: Array<{ type: "text"; text: string }>;
    _meta?: Record<string, unknown>;
  }): Promise<PromptResult>;
  cancel(params: { sessionId: string }): Promise<void>;
}

/**
 * Build an AcpClient bound to the given long-lived Hermes child process.
 *
 * The caller is responsible for keeping `handle` alive; this wrapper does
 * not own the child. `close()` only tears down ACP-level state, never the
 * process — process eviction is the registry's job.
 */
export async function createAcpClient(
  handle: HermesProcessHandle,
  ctx: Pick<AdapterExecutionContext, "onLog">,
): Promise<AcpClient> {
  const child = handle.child;
  const connection = await connectClientSide(child, ctx);

  const client: AcpClient = {
    async initialize() {
      const result = await connection.initialize({
        protocolVersion: 1,
        // Spike posture: zero capabilities surfaced to Hermes so we don't
        // have to implement Client-side handlers (fs read/write, terminal,
        // permission elicitation, etc.). Hermes runs entirely with its own
        // built-in tool surface for v1, per the COG-115 spike doc.
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: "paperclip-hermes-local",
          title: "Paperclip hermes_local adapter",
          version: "0.0.1",
        },
      });
      handle.initialized = true;
      return result;
    },
    async newSession(cwd) {
      const result = await connection.newSession({ cwd });
      handle.sessionId = result.sessionId;
      return result;
    },
    async loadSession(sessionId, cwd) {
      if (typeof connection.loadSession !== "function") {
        // Hermes advertises loadSession=true; if the SDK does not expose it,
        // fall back to a fresh session and lose continuity for this turn.
        const fresh = await connection.newSession({ cwd });
        handle.sessionId = fresh.sessionId;
        return;
      }
      await connection.loadSession({ sessionId, cwd });
      handle.sessionId = sessionId;
    },
    async prompt(sessionId, text, opts) {
      const meta: Record<string, unknown> = {};
      if (opts?.runId) meta.requestId = opts.runId;
      if (opts?.taskId) meta.taskId = opts.taskId;
      return await connection.prompt({
        sessionId,
        prompt: [{ type: "text", text }],
        ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
      });
    },
    async cancel(sessionId) {
      await connection.cancel({ sessionId });
    },
    async close() {
      // No-op for now. The SDK may expose a teardown method later; the
      // process lifetime is owned by the registry, not by this wrapper.
    },
  };

  return client;
}

/**
 * Lazy-import the SDK and build the connection. Kept lazy so the adapter
 * package can compile (and run unit tests against pure modules like
 * prompt-builder/process-registry) even when @agentclientprotocol/sdk is
 * not yet installed in the workspace.
 *
 * v0.11.0 ClientSideConnection signature (per dist/acp.d.ts:226):
 *
 *   constructor(toClient: (agent: Agent) => Client, stream: Stream)
 *
 * - `toClient` is a factory that receives the Agent proxy (exposed by the
 *   connection itself once it's constructed) and returns the Client handler
 *   object. This lets the Client implementation hold a reference to the
 *   remote Agent for outbound calls. We don't need that reference here, so
 *   we ignore it and return a plain handler.
 * - `stream` is a single `{ readable, writable }` of `AnyMessage` chunks.
 *   For stdio transport we wrap Node's child stdio into Web streams and
 *   pipe through `ndJsonStream` to get the message-typed pair the SDK
 *   wants.
 */
async function connectClientSide(
  child: ChildProcessWithoutNullStreams,
  ctx: Pick<AdapterExecutionContext, "onLog">,
): Promise<SdkConnection> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk: any = await import("@agentclientprotocol/sdk").catch((err: unknown) => {
    throw new Error(
      `[hermes_local] Failed to load @agentclientprotocol/sdk: ${
        err instanceof Error ? err.message : String(err)
      }. Run \`pnpm -w install\` so the in-tree adapter can talk to Hermes.`,
    );
  });

  // Convert Node's child stdio to Web streams of bytes. Hermes' ACP server
  // reads JSON-RPC frames from stdin and writes responses to stdout, so the
  // adapter writes to `child.stdin` and reads from `child.stdout`.
  const childStdoutWeb = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  const childStdinWeb = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;

  // ndJsonStream(output, input): the SDK's helper that adapts a byte-stream
  // pair into a message-stream pair (newline-delimited JSON in both
  // directions). `output` is what the SDK writes to (-> child stdin) and
  // `input` is what the SDK reads from (-> child stdout).
  const stream = sdk.ndJsonStream(childStdinWeb, childStdoutWeb);

  // First constructor arg is `toClient: (agent) => Client`. We ignore the
  // passed-in agent reference and return the Client handler directly. The
  // adapter only handles `sessionUpdate` notifications (we declared zero
  // fs/terminal capabilities on `initialize`, so nothing else should be
  // dispatched our way).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toClient = (_agent: any) => ({
    sessionUpdate: async (params: SessionUpdateEnvelope) => {
      await emitSessionUpdate(ctx, params);
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connection: SdkConnection = new sdk.ClientSideConnection(toClient, stream);
  return connection;
}
