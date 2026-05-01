import { describe, expect, it } from "vitest";

import { emitSessionUpdate, type SessionUpdateEnvelope } from "./transcript.js";

function recorder() {
  const lines: Array<{ kind: string; text: string }> = [];
  return {
    lines,
    onLog: async (kind: string, text: string) => {
      lines.push({ kind, text });
    },
  };
}

describe("emitSessionUpdate", () => {
  it("forwards agent_message_chunk text to onLog stdout", async () => {
    const r = recorder();
    const env: SessionUpdateEnvelope = {
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
      },
    };
    await emitSessionUpdate({ onLog: r.onLog }, env);
    expect(r.lines).toEqual([{ kind: "stdout", text: "hello" }]);
  });

  it("does not emit a line when agent_message_chunk text is empty", async () => {
    const r = recorder();
    await emitSessionUpdate(
      { onLog: r.onLog },
      {
        sessionId: "s1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text" } },
      },
    );
    expect(r.lines).toEqual([]);
  });

  it("prefixes thought_chunk text with [thought]", async () => {
    const r = recorder();
    await emitSessionUpdate(
      { onLog: r.onLog },
      {
        sessionId: "s1",
        update: {
          sessionUpdate: "thought_chunk",
          content: { type: "text", text: "let me think" },
        },
      },
    );
    expect(r.lines[0]?.text).toBe("[thought] let me think\n");
  });

  it("ignores user_message_chunk (replayed during loadSession)", async () => {
    const r = recorder();
    await emitSessionUpdate(
      { onLog: r.onLog },
      {
        sessionId: "s1",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "user said this earlier" },
        },
      },
    );
    expect(r.lines).toEqual([]);
  });

  it("renders tool_call with id + title", async () => {
    const r = recorder();
    await emitSessionUpdate(
      { onLog: r.onLog },
      {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tc-42",
          title: "FactRetriever.search",
          kind: "search",
        },
      },
    );
    expect(r.lines[0]?.text).toBe("[tool_call tc-42] FactRetriever.search\n");
  });

  it("renders tool_call_update with id, status, and concatenated content", async () => {
    const r = recorder();
    await emitSessionUpdate(
      { onLog: r.onLog },
      {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-42",
          status: "completed",
          content: [
            { type: "text", text: "ok" },
            { type: "text", text: " (12 results)" },
          ],
        },
      },
    );
    expect(r.lines[0]?.text).toBe("[tool_call tc-42 completed] ok (12 results)\n");
  });

  it("emits a header + per-step lines for plan updates", async () => {
    const r = recorder();
    await emitSessionUpdate(
      { onLog: r.onLog },
      {
        sessionId: "s1",
        update: {
          sessionUpdate: "plan",
          entries: [
            { content: "Read the spec", status: "done" },
            { content: "Write the code" },
          ],
        },
      },
    );
    expect(r.lines.map((l) => l.text)).toEqual([
      "[plan] 2 step(s)\n",
      "  - [done] Read the spec\n",
      "  - [pending] Write the code\n",
    ]);
  });

  it("falls through unknown update kinds with [hermes:<kind>]", async () => {
    const r = recorder();
    await emitSessionUpdate(
      { onLog: r.onLog },
      {
        sessionId: "s1",
        update: { sessionUpdate: "future_event_2027", payload: { foo: 1 } } as never,
      },
    );
    expect(r.lines[0]?.text).toBe("[hermes:future_event_2027]\n");
  });
});
