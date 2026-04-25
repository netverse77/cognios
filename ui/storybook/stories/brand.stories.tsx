import type { Meta, StoryObj } from "@storybook/react-vite";
import { Wordmark, WordmarkGlyph } from "@/components/Wordmark";

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
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="paperclip-story__frame overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <div className="paperclip-story__label">{eyebrow}</div>
        <h2 className="mt-1 text-xl font-semibold">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function WordmarkShowcase() {
  return (
    <StoryShell>
      <Section eyebrow="Wordmark" title="Cogni OS brand surface">
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-8 rounded-md border border-border bg-card p-6">
            <Wordmark size="sm" />
            <Wordmark size="md" />
            <Wordmark size="lg" tagline="Operator console" />
          </div>

          <div className="flex flex-wrap items-center gap-6 rounded-md border border-border bg-card p-6 text-foreground">
            <div className="flex flex-col items-center gap-1.5">
              <WordmarkGlyph size={20} />
              <span className="text-[10px] text-muted-foreground font-mono">20px</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <WordmarkGlyph size={32} />
              <span className="text-[10px] text-muted-foreground font-mono">32px</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <WordmarkGlyph size={48} />
              <span className="text-[10px] text-muted-foreground font-mono">48px</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 text-brand">
              <WordmarkGlyph size={48} />
              <span className="text-[10px] text-muted-foreground font-mono">on brand</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div
              className="rounded-md border border-border p-6"
              style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
            >
              <Wordmark size="md" />
              <p className="mt-3 text-xs opacity-80">
                Brand fill — reserve for splash, auth, and marketing surfaces.
              </p>
            </div>
            <div className="rounded-md border border-border bg-card p-6 text-foreground">
              <Wordmark size="md" iconOnly />
              <span className="ml-2 align-middle text-xs text-muted-foreground">
                Glyph-only variant for sidebars and rails.
              </span>
            </div>
          </div>
        </div>
      </Section>
    </StoryShell>
  );
}

const meta = {
  title: "Foundations/Brand",
  component: WordmarkShowcase,
  parameters: {
    docs: {
      description: {
        component:
          "Wordmark and glyph slots introduced in COG-114 for the Cogni OS rebrand. Slot the Wordmark anywhere a product brand should appear; the glyph alone is meant for compact rails.",
      },
    },
  },
} satisfies Meta<typeof WordmarkShowcase>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WordmarkAndGlyph: Story = {};
