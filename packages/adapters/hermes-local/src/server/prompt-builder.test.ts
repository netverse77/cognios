import { describe, expect, it } from "vitest";

import { PAPERCLIP_AUTH_GUARD_PROMPT, buildPrompt } from "./prompt-builder.js";

describe("buildPrompt", () => {
  const baseInput = {
    agent: { id: "agent-123", name: "Forge" },
    config: {} as Record<string, unknown>,
    context: {} as Record<string, unknown>,
    resumedSession: false,
  };

  it("renders agent identity placeholders into the default template", () => {
    const built = buildPrompt(baseInput);
    expect(built.text).toContain("agent-123");
    expect(built.text).toContain("Forge");
    expect(built.authGuardApplied).toBe(false);
  });

  it("prepends the auth guard ONLY when a custom promptTemplate is set", () => {
    const without = buildPrompt(baseInput);
    expect(without.text).not.toContain("Paperclip API safety rule");

    const withCustom = buildPrompt({
      ...baseInput,
      config: { promptTemplate: "Run task. Be terse." },
    });
    expect(withCustom.authGuardApplied).toBe(true);
    expect(withCustom.text).toContain(PAPERCLIP_AUTH_GUARD_PROMPT);
    expect(withCustom.text.indexOf(PAPERCLIP_AUTH_GUARD_PROMPT)).toBeLessThan(
      withCustom.text.indexOf("Run task. Be terse."),
    );
  });

  it("appends wake payload prose and a JSON fence when context.paperclipWakePayload is set", () => {
    const built = buildPrompt({
      ...baseInput,
      context: {
        paperclipWakePayload: {
          reason: "issue_assigned",
          issue: { identifier: "COG-115", title: "Spike" },
        },
      },
    });
    expect(built.wakeRendered).toBe(true);
    expect(built.text).toContain("```json");
    expect(built.text).toContain("COG-115");
  });

  it("never produces an empty prompt", () => {
    const built = buildPrompt(baseInput);
    expect(built.text.trim().length).toBeGreaterThan(0);
    expect(built.approxLength).toBeGreaterThan(0);
  });
});
