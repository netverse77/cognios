#!/usr/bin/env node
// COG-145: rasterize favicon-cogni-os-v1.svg into PNG fallbacks at the
// sizes browsers / PWAs request when SVG isn't preferred.
//
// Run: node scripts/render-cogni-os-v1-favicons.mjs
// Requires `sharp` from server/package.json. Re-run after editing the SVG
// to refresh the rasters before commit.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const publicDir = resolve(repoRoot, "ui/public");
const sourceSvg = resolve(publicDir, "favicon-cogni-os-v1.svg");

mkdirSync(publicDir, { recursive: true });

const targets = [
  { size: 16, file: "favicon-cogni-os-v1-16x16.png" },
  { size: 32, file: "favicon-cogni-os-v1-32x32.png" },
  { size: 180, file: "apple-touch-icon-cogni-os-v1.png" },
  { size: 192, file: "android-chrome-cogni-os-v1-192x192.png" },
  { size: 512, file: "android-chrome-cogni-os-v1-512x512.png" },
];

for (const target of targets) {
  const out = resolve(publicDir, target.file);
  await sharp(sourceSvg, { density: Math.max(96, target.size * 4) })
    .resize(target.size, target.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(out);
  console.log(`wrote ${target.file} (${target.size}x${target.size})`);
}
