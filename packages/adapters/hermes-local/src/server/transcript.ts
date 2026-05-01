import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

// ACP `session/update` notifications carry a discriminated `update` object.
// We only structurally name the variants we care to surface; everything else
// falls through to a generic `[hermes:<kind>]` log line so we don't lose
// information when Hermes adds new update types upstream.
type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: { type: string; text?: string } }
  | { sessionUpdate: "thought_chunk"; content: { type: string; text?: string } }
  | { sessionUpdate: "user_message_chunk"; content: { type: string; text?: string } }
  | {
      sessionUpdate: "tool_call";
      toolCallId?: string;
      title?: string;
      kind?: string;
      rawInput?: unknown;
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId?: string;
      status?: string;
      content?: Array<{ type: string; text?: string }>;
    }
  | { sessionUpdate: "plan"; entries: Array<{ content: string; status?: string }> }
  | { sessionUpdate: string; [extra: string]: unknown };

export interface SessionUpdateEnvelope {
  sessionId: string;
  update: SessionUpdate;
}

/**
 * Translate a Hermes ACP `session/update` notification into an `onLog` call.
 *
 * We render one stdout line per notification so claude-local-style log
 * consumers (CLI, UI tail, debug capture) get the same line-oriented stream
 * regardless of which adapter produced it. The UI parser
 * (`src/ui/parse-stdout.ts`) is what later turns these into TranscriptEntry
 * variants — H3 tightens that round-trip.
 */
export async function emitSessionUpdate(
  ctx: Pick<AdapterExecutionContext, "onLog">,
  envelope: SessionUpdateEnvelope,
): Promise<void> {
  const { update } = envelope;
  const kind = update.sessionUpdate;

  switch (kind) {
    case "agent_message_chunk": {
      const text = (update as { content?: { text?: string } }).content?.text ?? "";
      if (text.length > 0) await ctx.onLog("stdout", text);
      return;
    }
    case "thought_chunk": {
      const text = (update as { content?: { text?: string } }).content?.text ?? "";
      if (text.length > 0) await ctx.onLog("stdout", `[thought] ${text}\n`);
      return;
    }
    case "user_message_chunk": {
      // Replayed during loadSession; not a runtime event we need to forward.
      return;
    }
    case "tool_call": {
      const tc = update as { toolCallId?: string; title?: string; kind?: string };
      const id = tc.toolCallId ?? "?";
      await ctx.onLog(
        "stdout",
        `[tool_call ${id}] ${tc.title ?? tc.kind ?? "tool"}\n`,
      );
      return;
    }
    case "tool_call_update": {
      const tc = update as {
        toolCallId?: string;
        status?: string;
        content?: Array<{ type: string; text?: string }>;
      };
      const id = tc.toolCallId ?? "?";
      const status = tc.status ?? "update";
      const text = (tc.content ?? [])
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .join("");
      const suffix = text.length > 0 ? ` ${text}` : "";
      await ctx.onLog("stdout", `[tool_call ${id} ${status}]${suffix}\n`);
      return;
    }
    case "plan": {
      const entries = (update as { entries?: Array<{ content: string; status?: string }> })
        .entries ?? [];
      await ctx.onLog("stdout", `[plan] ${entries.length} step(s)\n`);
      for (const entry of entries) {
        await ctx.onLog("stdout", `  - [${entry.status ?? "pending"}] ${entry.content}\n`);
      }
      return;
    }
    default: {
      await ctx.onLog("stdout", `[hermes:${kind}]\n`);
      return;
    }
  }
}
