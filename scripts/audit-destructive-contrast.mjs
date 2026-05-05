#!/usr/bin/env node
// COG-141: WCAG 2.1 AA audit for destructive token pairs.
// OKLCH → linear sRGB → relative luminance → contrast ratio.
// Mirrors the COG-124 HB6 Pixel audit math.

// --- OKLCH → linear sRGB ---------------------------------------------------
// Reference: CSS Color Module Level 4, Björn Ottosson's Oklab.
function oklchToLinearSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // Oklab → linear sRGB matrix
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bl];
}

// --- linear → gamma-encoded sRGB ------------------------------------------
function linearToSrgb(c) {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function oklchToHex(L, C, h) {
  const [lr, lg, lb] = oklchToLinearSrgb(L, C, h);
  const r = Math.round(linearToSrgb(lr) * 255);
  const g = Math.round(linearToSrgb(lg) * 255);
  const b = Math.round(linearToSrgb(lb) * 255);
  const clamp = (n) => Math.max(0, Math.min(255, n));
  const hex = (n) => clamp(n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// --- WCAG 2.1 relative luminance ------------------------------------------
function relLumFromLinearSrgb(lr, lg, lb) {
  const c = (x) => Math.max(0, Math.min(1, x));
  return 0.2126 * c(lr) + 0.7152 * c(lg) + 0.0722 * c(lb);
}

function wcagContrast(okA, okB) {
  const [ar, ag, ab] = oklchToLinearSrgb(...okA);
  const [br, bg, bb] = oklchToLinearSrgb(...okB);
  const La = relLumFromLinearSrgb(ar, ag, ab);
  const Lb = relLumFromLinearSrgb(br, bg, bb);
  const [hi, lo] = La >= Lb ? [La, Lb] : [Lb, La];
  return (hi + 0.05) / (lo + 0.05);
}

// --- Token pairs to audit -------------------------------------------------
// Format: [L, C, hDeg]
const tokens = {
  // Light theme
  "light.destructive (current)": [0.577, 0.245, 27.325],
  "light.destructive-foreground (current = same as bg)": [0.577, 0.245, 27.325],
  "light.destructive-foreground (proposed white)": [0.985, 0, 0],

  // Dark theme
  "dark.destructive (current)": [0.637, 0.237, 25.331],
  "dark.destructive-foreground (current near-white)": [0.985, 0, 0],
  "dark.destructive (proposed darker)": [0.505, 0.213, 27.5],
};

function fmt(name, ok) {
  return `${name}\n  oklch(${ok[0]} ${ok[1]} ${ok[2]})  →  ${oklchToHex(...ok)}`;
}

console.log("=== Token sRGB previews ===");
for (const [name, ok] of Object.entries(tokens)) {
  console.log(fmt(name, ok));
}
console.log();

const tests = [
  {
    label: "BEFORE  light.destructive  fg-on-bg",
    fg: tokens["light.destructive-foreground (current = same as bg)"],
    bg: tokens["light.destructive (current)"],
    target: 4.5,
  },
  {
    label: "AFTER   light.destructive  fg-on-bg (white fg)",
    fg: tokens["light.destructive-foreground (proposed white)"],
    bg: tokens["light.destructive (current)"],
    target: 4.5,
  },
  {
    label: "BEFORE  dark.destructive   fg-on-bg",
    fg: tokens["dark.destructive-foreground (current near-white)"],
    bg: tokens["dark.destructive (current)"],
    target: 4.5,
  },
  {
    label: "AFTER   dark.destructive   fg-on-bg (darker bg, same fg)",
    fg: tokens["dark.destructive-foreground (current near-white)"],
    bg: tokens["dark.destructive (proposed darker)"],
    target: 4.5,
  },
  // Cross-check: button/badge variants hardcode text-white on bg-destructive
  // (they don't actually consume --destructive-foreground). Verify both
  // themes' solid-destructive surfaces still pass AA after the fix.
  {
    label: "AFTER   light  text-white on bg-destructive (button/badge)",
    fg: [1, 0, 0],
    bg: tokens["light.destructive (current)"],
    target: 4.5,
  },
  {
    label: "AFTER   dark   text-white on bg-destructive (button/badge)",
    fg: [1, 0, 0],
    bg: tokens["dark.destructive (proposed darker)"],
    target: 4.5,
  },
];

console.log("=== WCAG 2.1 contrast ===");
let allPass = true;
for (const t of tests) {
  const ratio = wcagContrast(t.fg, t.bg);
  const pass = ratio >= t.target;
  if (!t.label.startsWith("BEFORE") && !pass) allPass = false;
  console.log(
    `${pass ? "✓" : "✗"} ${t.label}: ${ratio.toFixed(2)}:1  (target ${t.target}:1)`,
  );
}

console.log();
process.exit(allPass ? 0 : 1);
