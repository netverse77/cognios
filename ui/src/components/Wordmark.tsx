import { cn } from "@/lib/utils";

/**
 * Cogni OS wordmark + glyph. The mark is the brand surface introduced in
 * COG-114. Internal package paths and orchestrator code still use the
 * "paperclip" name (paperclip is the orchestrator inside Cogni OS).
 *
 * Slot anywhere a product brand should appear (sidebar header, splash, auth
 * landing). Pairs with the `--brand` design token so it inherits the active
 * theme automatically.
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
  className?: string;
}

const sizeMap = {
  sm: { glyph: 18, text: "text-sm", tagline: "text-[10px]" },
  md: { glyph: 24, text: "text-lg", tagline: "text-xs" },
  lg: { glyph: 32, text: "text-2xl", tagline: "text-sm" },
} as const;

export function Wordmark({
  size = "md",
  iconOnly = false,
  textOnly = false,
  tagline,
  className,
}: WordmarkProps) {
  const dims = sizeMap[size];
  return (
    <div
      className={cn("inline-flex items-center gap-2", className)}
      aria-label="Cogni OS"
      role="img"
    >
      {!textOnly && <WordmarkGlyph size={dims.glyph} />}
      {!iconOnly && (
        <div className="flex flex-col leading-none">
          <span
            className={cn("font-semibold tracking-tight", dims.text)}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {/* Both halves render in currentColor so the wordmark stays
                legible on any surface (neutral foreground OR brand fill).
                Brand emphasis is carried by the glyph. "Cogni OS" is two
                words; the "OS" suffix is visually separated by weight. */}
            <span>Cogni</span>
            <span className="ml-[0.25em] font-bold opacity-90">OS</span>
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
 * The glyph alone — three stacked nodes joined by a routing line, evoking the
 * agent → orchestrator → board flow at the heart of Cogni OS. Renders as
 * currentColor for the line and `--brand` for the active node so it adapts to
 * any surface.
 */
export function WordmarkGlyph({ size = 24 }: { size?: number }) {
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
