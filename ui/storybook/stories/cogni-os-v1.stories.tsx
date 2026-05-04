import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Wordmark,
  WordmarkGlyph,
  SigilGlyph,
  InterimNodeGraphGlyph,
} from "@/components/Wordmark";

/**
 * Cogni OS — Pixel v1 (COG-124).
 *
 * Showcases the four pillars of the v1 brand identity behind the
 * `data-theme="cogni-os-v1"` flag: palette semantic tokens, type ramp,
 * Sigil mark + lockups, and the named-motion library. Outside of these
 * stories the COG-114 interim tokens stay live.
 */

/** Decorator that flips the v1 brand layer on for the duration of a story. */
function BrandLayerV1Decorator({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "cogni-os-v1");
    return () => {
      if (previous) {
        root.setAttribute("data-theme", previous);
      } else {
        root.removeAttribute("data-theme");
      }
    };
  }, []);
  return <>{children}</>;
}

function StoryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="paperclip-story">
      <main className="paperclip-story__inner space-y-6">{children}</main>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="paperclip-story__frame overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <div className="paperclip-story__label">{eyebrow}</div>
        <h2 className="mt-1 text-xl font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground max-w-prose">
            {description}
          </p>
        )}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Single colored swatch + token-name caption. */
function Swatch({
  label,
  bg,
  fg,
  description,
}: {
  label: string;
  bg: string;
  fg: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-16 rounded-md border border-border flex items-center justify-center font-medium text-sm"
        style={{ background: `var(${bg})`, color: `var(${fg})` }}
      >
        {label}
      </div>
      <div className="text-[11px] font-mono text-muted-foreground">{bg}</div>
      <div className="text-[11px] text-muted-foreground">{description}</div>
    </div>
  );
}

function PaletteShowcase() {
  return (
    <StoryShell>
      <Section
        eyebrow="Pillar 1 of 4"
        title="Semantic palette"
        description="Adds success, warning, info to the COG-114 base. Destructive (existing) serves as the error semantic. Each color pairs with a -foreground token for legible text on the colored surface. Light + dark themes both populated."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Swatch
            label="Success"
            bg="--success"
            fg="--success-foreground"
            description="Confirm actions, positive states"
          />
          <Swatch
            label="Warning"
            bg="--warning"
            fg="--warning-foreground"
            description="Risky actions, attention-needed"
          />
          <Swatch
            label="Info"
            bg="--info"
            fg="--info-foreground"
            description="Notices, supplemental context"
          />
          <Swatch
            label="Destructive"
            bg="--destructive"
            fg="--destructive-foreground"
            description="Errors, destructive actions (COG-114 base)"
          />
        </div>
      </Section>
    </StoryShell>
  );
}

function TypographyShowcase() {
  const sizes = [
    { token: "--text-xs", label: "Extra small (12px)" },
    { token: "--text-sm", label: "Small (14px)" },
    { token: "--text-base", label: "Base (16px)" },
    { token: "--text-lg", label: "Large (18px)" },
    { token: "--text-xl", label: "Extra large (20px)" },
    { token: "--text-2xl", label: "2x large (24px)" },
    { token: "--text-3xl", label: "3x large (30px)" },
    { token: "--text-4xl", label: "4x large (36px)" },
  ];
  const weights = [
    { token: "--font-weight-regular", label: "Regular (400)" },
    { token: "--font-weight-medium", label: "Medium (500)" },
    { token: "--font-weight-semibold", label: "Semibold (600)" },
    { token: "--font-weight-bold", label: "Bold (700)" },
  ];
  return (
    <StoryShell>
      <Section
        eyebrow="Pillar 2 of 4"
        title="Typography ramp"
        description="Display + body share the Inter stack (OFL). Mono is JetBrains Mono with broad fallback (OFL). Weight scale and text-size ramp match Tailwind v4 defaults so utility classes compose without surprises."
      >
        <div className="space-y-6">
          <div className="space-y-1">
            <div className="text-[11px] font-mono text-muted-foreground">
              Size scale
            </div>
            <div className="space-y-2">
              {sizes.map((s) => (
                <div key={s.token} className="flex items-baseline gap-4">
                  <span className="w-32 font-mono text-[11px] text-muted-foreground shrink-0">
                    {s.token}
                  </span>
                  <span style={{ fontSize: `var(${s.token})`, fontFamily: "var(--font-body)" }}>
                    {s.label} — Cogni OS thinks in cycles.
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-mono text-muted-foreground">
              Weight scale
            </div>
            <div className="space-y-2">
              {weights.map((w) => (
                <div key={w.token} className="flex items-baseline gap-4">
                  <span className="w-44 font-mono text-[11px] text-muted-foreground shrink-0">
                    {w.token}
                  </span>
                  <span
                    style={{
                      fontWeight: `var(${w.token})`,
                      fontFamily: "var(--font-body)",
                      fontSize: "var(--text-lg)",
                    }}
                  >
                    {w.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-mono text-muted-foreground">
              Mono face
            </div>
            <pre
              className="rounded-md border border-border bg-card p-4 text-sm overflow-auto"
              style={{ fontFamily: "var(--font-mono)" }}
            >
{`// VITE_THEME_COGNI_OS=1 activates the v1 brand layer.
const enabled = import.meta.env.VITE_THEME_COGNI_OS === "1";
if (enabled) document.documentElement.setAttribute(
  "data-theme", "cogni-os-v1");`}
            </pre>
          </div>
        </div>
      </Section>
    </StoryShell>
  );
}

function LogoShowcase() {
  return (
    <StoryShell>
      <Section
        eyebrow="Pillar 3 of 4"
        title="Sigil mark + lockups"
        description="Locked direction: a C+O letterform monogram. Square-cap C terminals are the engineered detail (deliberate cut, not flourish). Both lockup variants — Cogni OS and standalone Cogni — pair with the same glyph."
      >
        <div className="space-y-6">
          <div className="rounded-md border border-border bg-card p-6">
            <div className="text-[11px] font-mono text-muted-foreground mb-3">
              Glyph at favicon-relevant sizes
            </div>
            <div className="flex items-end gap-8 text-foreground">
              {[12, 16, 24, 32, 48, 64].map((px) => (
                <div key={px} className="flex flex-col items-center gap-1.5">
                  <SigilGlyph size={px} />
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {px}px
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-6">
            <div className="text-[11px] font-mono text-muted-foreground mb-3">
              Cogni OS lockup (default)
            </div>
            <div className="flex flex-wrap items-end gap-8">
              <Wordmark size="sm" productName="Cogni OS" />
              <Wordmark size="md" productName="Cogni OS" />
              <Wordmark size="lg" productName="Cogni OS" tagline="Operator console" />
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-6">
            <div className="text-[11px] font-mono text-muted-foreground mb-3">
              Cogni standalone lockup (tighter chrome surfaces)
            </div>
            <div className="flex flex-wrap items-end gap-8">
              <Wordmark size="sm" productName="Cogni" />
              <Wordmark size="md" productName="Cogni" />
              <Wordmark size="lg" productName="Cogni" />
            </div>
          </div>

          <div className="rounded-md border border-border bg-foreground p-6 text-background">
            <div className="text-[11px] font-mono opacity-70 mb-3">
              Mono on dark background — survives single-color contexts
            </div>
            <div className="flex items-end gap-8">
              <SigilGlyph size={24} />
              <Wordmark size="md" productName="Cogni OS" />
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-6">
            <div className="text-[11px] font-mono text-muted-foreground mb-3">
              Glyph picker (Sigil active under v1 flag; interim node-graph in
              the COG-114 default theme)
            </div>
            <div className="flex items-end gap-12">
              <div className="flex flex-col items-center gap-2">
                <SigilGlyph size={48} />
                <span className="text-[11px] text-muted-foreground">v1 Sigil</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <InterimNodeGraphGlyph size={48} />
                <span className="text-[11px] text-muted-foreground">
                  COG-114 interim (flag off)
                </span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <WordmarkGlyph size={48} />
                <span className="text-[11px] text-muted-foreground">
                  Active picker — currently {"v1"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </StoryShell>
  );
}

function MotionShowcase() {
  return (
    <StoryShell>
      <Section
        eyebrow="Pillar 4 of 4"
        title="Named-motion library"
        description="Each primitive composes the existing COG-114 duration × easing tokens — no bespoke values inside primitives. prefers-reduced-motion drops animations to opacity-only at the fastest duration."
      >
        <div className="space-y-6">
          <div className="rounded-md border border-border bg-card p-6">
            <div className="text-[11px] font-mono text-muted-foreground mb-3">
              motion-sigil-enter — signature brand motion (replay on Storybook
              re-render; controls the entry resolve)
            </div>
            <div className="flex items-center justify-center py-6">
              <span className="motion-sigil-enter">
                <SigilGlyph size={96} />
              </span>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-6">
            <div className="text-[11px] font-mono text-muted-foreground mb-3">
              motion-modal-enter — fade + subtle scale
            </div>
            <div className="flex items-center justify-center py-6">
              <div className="motion-modal-enter rounded-md border border-border bg-popover p-6 shadow-lg">
                <div className="font-semibold">Dialog title</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Replay the story to see the entry transition.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-6">
            <div className="text-[11px] font-mono text-muted-foreground mb-3">
              motion-toast-enter — slide + fade from bottom
            </div>
            <div className="flex items-center justify-center py-6">
              <div className="motion-toast-enter rounded-md border border-border bg-popover px-4 py-3 shadow">
                <div className="text-sm">Action completed</div>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-6">
            <div className="text-[11px] font-mono text-muted-foreground mb-3">
              motion-state — generic property-change transition (hover the
              swatch to see)
            </div>
            <div className="flex items-center justify-center py-6 gap-4">
              <button
                type="button"
                className="motion-state rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-accent hover:scale-[1.02]"
              >
                Hover me — base
              </button>
              <button
                type="button"
                className="motion-state-fast rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-accent hover:scale-[1.02]"
              >
                Hover me — fast
              </button>
              <button
                type="button"
                className="motion-state-emphasized rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-accent hover:scale-[1.02]"
              >
                Hover me — emphasized
              </button>
            </div>
          </div>
        </div>
      </Section>
    </StoryShell>
  );
}

const meta = {
  title: "Foundations/Cogni OS v1",
  parameters: {
    docs: {
      description: {
        component:
          "Pixel v1 brand layer (COG-124) — palette semantic tokens, type ramp, Sigil mark + lockups, and the named-motion library. All four pillars activate together behind data-theme=\"cogni-os-v1\"; this Storybook section forces the flag on via a decorator.",
      },
    },
  },
  decorators: [
    (Story) => (
      <BrandLayerV1Decorator>
        <Story />
      </BrandLayerV1Decorator>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Palette: Story = { render: () => <PaletteShowcase /> };
export const Typography: Story = { render: () => <TypographyShowcase /> };
export const Logo: Story = { render: () => <LogoShowcase /> };
export const Motion: Story = { render: () => <MotionShowcase /> };
