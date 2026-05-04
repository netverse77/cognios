import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Cogni OS wordmark + glyph. The mark is the brand surface introduced in
 * COG-114 and refined for the v1 visual identity in COG-124. Internal
 * package paths and orchestrator code still use the "paperclip" name
 * (paperclip is the orchestrator inside Cogni OS).
 *
 * Slot anywhere a product brand should appear (sidebar header, splash, auth
 * landing). Pairs with the `--brand` design token so it inherits the active
 * theme automatically.
 *
 * Behind the v1 brand-layer flag (`data-theme="cogni-os-v1"` on `<html>`),
 * the glyph swaps from the COG-114 interim node-graph to the v1 Sigil
 * (C+O letterform monogram) — the locked logo direction per CEO pick on
 * 2026-05-02. Outside the flag the interim glyph stays live.
 */
export interface WordmarkProps {
  /** Visual size of the glyph + text. */
  size?: "sm" | "md" | "lg";
  /** Render the glyph only (no wordmark text). */
  iconOnly?: boolean;
  /** Render the wordmark text only (no glyph). */
  textOnly?: boolean;
  /** Optional tagline shown beneath the wordmark on `lg` size. */
  tagline?: string;
  /**
   * Which product wordmark to render in the lockup. `Cogni OS` is the
   * default product name; `Cogni` is the standalone short form used in
   * tighter chrome surfaces. Both pair with the same glyph.
   */
  productName?: "Cogni OS" | "Cogni";
  className?: string;
}

const sizeMap = {
  sm: { glyph: 18, text: "text-sm", tagline: "text-[10px]" },
  md: { glyph: 24, text: "text-lg", tagline: "text-xs" },
  lg: { glyph: 32, text: "text-2xl", tagline: "text-sm" },
} as const;

const COGNI_OS_V1_BRAND_TOKEN = "cogni-os-v1";

/**
 * Reactively reports whether the v1 brand layer is currently active on
 * `<html>`. ThemeProvider sets `data-theme="cogni-os-v1"` at boot when
 * `VITE_THEME_COGNI_OS=1`; this hook keeps consumer components in sync if
 * the attribute changes mid-session (e.g., a Storybook decorator).
 */
function useBrandLayerV1(): boolean {
  const [active, setActive] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.getAttribute("data-theme") === COGNI_OS_V1_BRAND_TOKEN;
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setActive(root.getAttribute("data-theme") === COGNI_OS_V1_BRAND_TOKEN);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return active;
}

export function Wordmark({
  size = "md",
  iconOnly = false,
  textOnly = false,
  tagline,
  productName = "Cogni OS",
  className,
}: WordmarkProps) {
  const dims = sizeMap[size];
  return (
    <div
      className={cn("inline-flex items-center gap-2", className)}
      aria-label={productName}
      role="img"
    >
      {!textOnly && <WordmarkGlyph size={dims.glyph} />}
      {!iconOnly && (
        <div className="flex flex-col leading-none">
          <span
            className={cn("font-semibold tracking-tight", dims.text)}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {productName === "Cogni OS" ? (
              <>
                {/* Both halves render in currentColor so the wordmark stays
                    legible on any surface (neutral foreground OR brand fill).
                    Brand emphasis is carried by the glyph. "Cogni OS" is two
                    words; the "OS" suffix is visually separated by weight. */}
                <span>Cogni</span>
                <span className="ml-[0.25em] font-bold opacity-90">OS</span>
              </>
            ) : (
              /* Standalone `Cogni` lockup — used in tighter chrome where the
                 product-name suffix is contextually implied. */
              <span>Cogni</span>
            )}
          </span>
          {tagline && size === "lg" && (
            <span
              className={cn(
                "mt-1 font-medium uppercase tracking-[0.18em] opacity-65",
                dims.tagline,
              )}
            >
              {tagline}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Active glyph for the brand. Picks between the v1 Sigil (under the
 * `data-theme="cogni-os-v1"` brand-layer flag) and the COG-114 interim
 * node-graph glyph (default).
 */
export function WordmarkGlyph({ size = 24 }: { size?: number }) {
  const v1 = useBrandLayerV1();
  return v1 ? <SigilGlyph size={size} /> : <InterimNodeGraphGlyph size={size} />;
}

/**
 * The locked v1 Sigil — a C+O letterform monogram. The C wraps an inner
 * O dot, opening 60° to the right; the C's terminals end with sharp,
 * square caps (the "engineered, not decorative" cut detail that signals
 * tech-credibility, not stylistic flourish).
 *
 * Both letters render in `currentColor` so the mark survives single-color
 * contexts unchanged — favicon, terminal, dark backgrounds, print.
 *
 * Geometry (viewBox 32×32, center 16,16):
 *   - Outer C: stroked arc, radius 12.5, stroke width 4, butt caps,
 *     spanning 300° (60° gap centered on the right).
 *   - Inner O: filled circle, radius 4.
 *
 * Render budget at small sizes:
 *   - 32px: full geometry, all detail visible.
 *   - 16px: ring stroke ~2px, inner O ~2px diameter, gap ~2.5px — readable.
 *   - 12px: ring stroke ~1.5px, inner O ~1.5px diameter, gap ~1.9px —
 *     marginal but holds; this is the design's tightest rendering.
 */
export function SigilGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden="true"
    >
      {/* C — outer arc, opens 60° to the right, square-cap terminals */}
      <path
        d="M 26.83 9.75 A 12.5 12.5 0 1 0 26.83 22.25"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="butt"
      />
      {/* O — inner filled circle */}
      <circle cx="16" cy="16" r="4" fill="currentColor" />
    </svg>
  );
}

/**
 * The COG-114 interim glyph — three stacked nodes joined by a routing
 * line, evoking the agent → orchestrator → board flow. Retained as the
 * default mark when the v1 brand-layer flag is off so the existing
 * surface keeps shipping until packaging flips `THEME_COGNI_OS=1`.
 */
export function InterimNodeGraphGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden="true"
    >
      {/* Routing path */}
      <path
        d="M7 8 L7 16 L25 16 L25 24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      {/* Top node — incoming work */}
      <circle cx="7" cy="8" r="3" fill="currentColor" opacity="0.7" />
      {/* Middle node — orchestrator (brand) */}
      <rect
        x="13"
        y="13"
        width="6"
        height="6"
        rx="1.5"
        fill="var(--brand)"
      />
      {/* Bottom node — execution */}
      <circle cx="25" cy="24" r="3" fill="currentColor" opacity="0.85" />
    </svg>
  );
}
