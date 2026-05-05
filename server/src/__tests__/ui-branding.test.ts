import { describe, expect, it } from "vitest";
import {
  applyUiBranding,
  getWorktreeUiBranding,
  isWorktreeUiBrandingEnabled,
  renderFaviconLinks,
  renderRuntimeBrandingMeta,
} from "../ui-branding.js";

const TEMPLATE = `<!doctype html>
<head>
    <!-- PAPERCLIP_RUNTIME_BRANDING_START -->
    <!-- PAPERCLIP_RUNTIME_BRANDING_END -->
    <!-- PAPERCLIP_FAVICON_START -->
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <!-- PAPERCLIP_FAVICON_END -->
</head>`;

describe("ui branding", () => {
  it("detects worktree mode from PAPERCLIP_IN_WORKTREE", () => {
    expect(isWorktreeUiBrandingEnabled({ PAPERCLIP_IN_WORKTREE: "true" })).toBe(true);
    expect(isWorktreeUiBrandingEnabled({ PAPERCLIP_IN_WORKTREE: "1" })).toBe(true);
    expect(isWorktreeUiBrandingEnabled({ PAPERCLIP_IN_WORKTREE: "false" })).toBe(false);
  });

  it("resolves name, color, and text color for worktree branding", () => {
    const branding = getWorktreeUiBranding({
      PAPERCLIP_IN_WORKTREE: "true",
      PAPERCLIP_WORKTREE_NAME: "paperclip-pr-432",
      PAPERCLIP_WORKTREE_COLOR: "#4f86f7",
    });

    expect(branding.enabled).toBe(true);
    expect(branding.name).toBe("paperclip-pr-432");
    expect(branding.color).toBe("#4f86f7");
    expect(branding.textColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(branding.faviconHref).toContain("data:image/svg+xml,");
  });

  it("renders a dynamic worktree favicon when enabled", () => {
    const links = renderFaviconLinks(
      getWorktreeUiBranding({
        PAPERCLIP_IN_WORKTREE: "true",
        PAPERCLIP_WORKTREE_NAME: "paperclip-pr-432",
        PAPERCLIP_WORKTREE_COLOR: "#4f86f7",
      }),
    );
    expect(links).toContain("data:image/svg+xml,");
    expect(links).toContain('rel="shortcut icon"');
  });

  it("renders runtime branding metadata for the ui", () => {
    const meta = renderRuntimeBrandingMeta(
      getWorktreeUiBranding({
        PAPERCLIP_IN_WORKTREE: "true",
        PAPERCLIP_WORKTREE_NAME: "paperclip-pr-432",
        PAPERCLIP_WORKTREE_COLOR: "#4f86f7",
      }),
    );
    expect(meta).toContain('name="paperclip-worktree-name"');
    expect(meta).toContain('content="paperclip-pr-432"');
    expect(meta).toContain('name="paperclip-worktree-color"');
  });

  it("rewrites the favicon and runtime branding blocks for worktree instances only", () => {
    const branded = applyUiBranding(TEMPLATE, {
      PAPERCLIP_IN_WORKTREE: "true",
      PAPERCLIP_WORKTREE_NAME: "paperclip-pr-432",
      PAPERCLIP_WORKTREE_COLOR: "#4f86f7",
    });
    expect(branded).toContain("data:image/svg+xml,");
    expect(branded).toContain('name="paperclip-worktree-name"');
    expect(branded).not.toContain('href="/favicon.svg"');

    const defaultHtml = applyUiBranding(TEMPLATE, {});
    expect(defaultHtml).toContain('href="/favicon.svg"');
    expect(defaultHtml).not.toContain('name="paperclip-worktree-name"');
  });

  it("flips favicon and emits theme meta when THEME_COGNI_OS=1 (COG-117)", () => {
    const branded = applyUiBranding(TEMPLATE, { THEME_COGNI_OS: "1" });
    expect(branded).toContain('href="/favicon-cogni-os-v1.svg"');
    expect(branded).toContain('name="paperclip-theme"');
    expect(branded).toContain('content="cogni-os-v1"');
    // Default Paperclip favicon links must be replaced, not augmented.
    expect(branded).not.toContain('href="/favicon.svg"');
    // Worktree-specific meta must NOT appear when only brand mode is on.
    expect(branded).not.toContain('name="paperclip-worktree-name"');
  });

  it("references the v1 PNG fallbacks (not the legacy paperclip PNGs) under THEME_COGNI_OS=1 (COG-145)", () => {
    const branded = applyUiBranding(TEMPLATE, { THEME_COGNI_OS: "1" });
    expect(branded).toContain('href="/favicon-cogni-os-v1-32x32.png"');
    expect(branded).toContain('href="/favicon-cogni-os-v1-16x16.png"');
    expect(branded).toContain('href="/apple-touch-icon-cogni-os-v1.png"');
    // Legacy paperclip-glyph PNGs must NOT leak into brand mode.
    expect(branded).not.toContain('href="/favicon-32x32.png"');
    expect(branded).not.toContain('href="/favicon-16x16.png"');
  });

  it("worktree favicon takes precedence over brand favicon when both are set", () => {
    const branded = applyUiBranding(TEMPLATE, {
      PAPERCLIP_IN_WORKTREE: "true",
      PAPERCLIP_WORKTREE_NAME: "paperclip-pr-432",
      PAPERCLIP_WORKTREE_COLOR: "#4f86f7",
      THEME_COGNI_OS: "1",
    });
    // Worktree dynamic SVG wins on favicon.
    expect(branded).toContain("data:image/svg+xml,");
    expect(branded).not.toContain('href="/favicon-cogni-os-v1.svg"');
    // Both theme + worktree meta coexist.
    expect(branded).toContain('name="paperclip-worktree-name"');
    expect(branded).toContain('name="paperclip-theme"');
  });
});
