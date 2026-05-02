import {
  parseObject,
  renderPaperclipWakePrompt,
  stringifyPaperclipWakePayload,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  asString,
} from "@paperclipai/adapter-utils/server-utils";

// Auth-guard fragment with byte-identical text to the existing npm-backed
// adapter (registry.ts:255-260). The board-protected security posture says
// every Paperclip API request from a hermes_local agent must use the run JWT.
// Inserted in front of any operator-supplied promptTemplate, never on its own
// (Hermes' built-in default heartbeat prompt is preserved when no custom
// template is configured).
export const PAPERCLIP_AUTH_GUARD_PROMPT = [
  "Paperclip API safety rule:",
  "Use Authorization: Bearer $PAPERCLIP_API_KEY on every Paperclip API request.",
  "Use X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID on every Paperclip API request that writes or mutates data, including comments and issue updates.",
  "Never use a board, browser, or local-board session for Paperclip API writes.",
].join("\n");

export interface BuiltPrompt {
  /** Single text content block ready to drop into an ACP PromptRequest. */
  text: string;
  /** True if a custom promptTemplate was supplied and the auth guard was prepended. */
  authGuardApplied: boolean;
  /** True if the wake payload was rendered into the prompt. */
  wakeRendered: boolean;
  /** Approximate character length, useful for logs. */
  approxLength: number;
}

export interface BuildPromptInput {
  agent: { id: string; name: string };
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  resumedSession: boolean;
}

/**
 * Compose the prompt body for a single ACP `session/prompt` turn.
 *
 * Layered, deterministic order so the auth-guard is never silently dropped:
 *   1. promptTemplate (operator-supplied) OR DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE
 *   2. wake-payload prose (`renderPaperclipWakePrompt` already handles
 *      "resumed session" framing)
 *   3. raw wake-payload JSON appended as a fenced block so Hermes can read it
 *      programmatically when needed
 *
 * The auth-guard rule (parity with registry.ts:255-276) is prepended only
 * when a custom promptTemplate is provided — the built-in template already
 * carries the right instructions.
 */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const { agent, config, context, resumedSession } = input;

  const customTemplate = asString(config.promptTemplate, "").trim();
  const baseTemplate = customTemplate || DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE;
  const withAuthGuard = customTemplate
    ? `${PAPERCLIP_AUTH_GUARD_PROMPT}\n\n${baseTemplate}`
    : baseTemplate;

  const rendered = withAuthGuard
    .replaceAll("{{agent.id}}", agent.id)
    .replaceAll("{{agent.name}}", agent.name);

  const wakePayload = parseObject(context.paperclipWakePayload);
  const wakeProse = renderPaperclipWakePrompt(wakePayload, { resumedSession });
  const wakeJson = stringifyPaperclipWakePayload(wakePayload);

  const sections: string[] = [rendered];
  if (wakeProse.trim().length > 0) sections.push(wakeProse.trim());
  if (wakeJson) sections.push("```json\n" + wakeJson + "\n```");

  const text = sections.join("\n\n").trim() + "\n";
  return {
    text,
    authGuardApplied: Boolean(customTemplate),
    wakeRendered: Boolean(wakePayload),
    approxLength: text.length,
  };
}
