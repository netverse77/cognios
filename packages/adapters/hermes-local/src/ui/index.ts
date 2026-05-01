import type { StdoutLineParser, TranscriptEntry } from "@paperclipai/adapter-utils";

// H1 stub: surface raw stdout lines as plain assistant text so the UI does
// not crash when ADAPTER_HERMES_LOCAL=1 is set during the spike.
// H3 replaces this with a parser that understands Hermes' streaming output
// (assistant deltas, reasoning, tool calls, tool results).
export const parseStdoutLine: StdoutLineParser = (line, ts) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return [];
  const entry: TranscriptEntry = {
    kind: "stdout",
    ts,
    text: trimmed,
  };
  return [entry];
};
