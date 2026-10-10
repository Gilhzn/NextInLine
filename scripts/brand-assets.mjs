// Renders every app icon / splash / favicon PNG from apps/mobile/assets/brand/mark.svg.
//   node scripts/brand-assets.mjs   (CHROMIUM_PATH optional)
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const dir = path.resolve("apps/mobile/assets");
const mark = readFileSync(path.join(dir, "brand/mark.svg"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const TEAL = "linear-gradient(135deg, #14B8A6 0%, #0F766E 55%, #115E59 100%)";

/** size: output px; scale: mark size as a share of the canvas; bg: CSS background or "none"; mono: white silhouette */
const outputs = [
  { file: "icon.png", size: 1024, scale: 0.92, bg: TEAL },
  { file: "android-icon-foreground.png", size: 1024, scale: 0.62, bg: "none" },
  { file: "android-icon-background.png", size: 1024, scale: 0, bg: TEAL },
  { file: "android-icon-monochrome.png", size: 1024, scale: 0.62, bg: "none", mono: true },
  { file: "splash-icon.png", size: 1024, scale: 0.9, bg: "none", rounded: true },
  { file: "favicon.png", size: 48, scale: 1, bg: TEAL, rounded: true },
  { file: "brand/store-icon-512.png", size: 512, scale: 0.92, bg: TEAL },
];

/** Android themed icon: one opaque silhouette; details (cross, lines, ₪) are cut out via a mask. */
function monochrome(svg) {
  const body = svg
    .replace(/^[\s\S]*?<\/defs>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/fill="#(14B8A6|99D5CC)"/g, 'fill="#000"')
    .replace(/fill="(?!none)[^"]*"/g, (m) => (m === 'fill="#000"' ? m : 'fill="#fff"'))
    .replace(/stroke="#7C2D12"/g, 'stroke="#000"');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><mask id="m">${body}</mask></defs>
    <rect width="1024" height="1024" fill="#fff" mask="url(#m)"/></svg>`;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const o of outputs) {
  await page.setViewportSize({ width: o.size, height: o.size });
  const markSize = Math.round(o.size * o.scale);
  const svg = o.mono ? monochrome(mark) : mark;
  // The splash shows the full icon tile (teal square) centered on a light background set in app.json.
  const inner = o.rounded
    ? `<div style="width:${markSize}px;height:${markSize}px;border-radius:${Math.round(markSize * 0.22)}px;background:${TEAL};display:flex;align-items:center;justify-content:center">
         <div style="width:${Math.round(markSize * 0.92)}px;height:${Math.round(markSize * 0.92)}px">${svg}</div></div>`
    : `<div style="width:${markSize}px;height:${markSize}px">${svg}</div>`;
  await page.setContent(`<html><body style="margin:0;width:${o.size}px;height:${o.size}px;display:flex;align-items:center;justify-content:center;
    background:${o.bg === "none" ? "transparent" : o.bg}">${o.scale ? inner : ""}<style>svg{width:100%;height:100%;display:block}</style></body></html>`);
  await page.screenshot({ path: path.join(dir, o.file), omitBackground: o.bg === "none" });
  console.log(`✓ ${o.file}`);
}
await browser.close();
