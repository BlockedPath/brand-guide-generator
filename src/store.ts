import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { markdownBrief } from "./brief.ts";
import { config } from "./config.ts";
import type { BrandGuide, GuideAssets } from "./guide.ts";
import { renderGuide } from "./render.ts";
import { cssTokens, dtcgTokens, tailwindPreset } from "./tokens.ts";

// Each guide lives in out/<domain>/ as JSON + HTML + token files + captured images.

export const GUIDE_FILES = ["brand.html", "brand.json", "brand.md", "tokens.css", "tokens.json", "tailwind.preset.js", "logo.svg", "logo.png", "logo-official.svg", "logo-official.png", "logo-official.jpg", "logo-official.webp", "hero.jpg", "display.png"] as const;

export function slugFor(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
}

export function guideDir(slug: string): string {
  return join(config.outDir, slug);
}

function dataUri(bytes: Uint8Array | null, mime: string): string | null {
  return bytes ? `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` : null;
}

export async function writeGuide(guide: BrandGuide, assets: GuideAssets): Promise<string> {
  const dir = guideDir(slugFor(guide.company.domain));
  await mkdir(dir, { recursive: true });
  const writes: Promise<unknown>[] = [
    Bun.write(join(dir, "brand.json"), JSON.stringify(guide, null, 2)),
    Bun.write(join(dir, "brand.md"), markdownBrief(guide)),
    Bun.write(join(dir, "tokens.css"), cssTokens(guide)),
    Bun.write(join(dir, "tokens.json"), JSON.stringify(dtcgTokens(guide), null, 2)),
    Bun.write(join(dir, "tailwind.preset.js"), tailwindPreset(guide)),
  ];
  if (assets.logoSvg) writes.push(Bun.write(join(dir, "logo.svg"), assets.logoSvg));
  if (assets.officialLogo) writes.push(Bun.write(join(dir, `logo-official.${assets.officialLogo.ext}`), assets.officialLogo.bytes));
  if (assets.logoPng) writes.push(Bun.write(join(dir, "logo.png"), assets.logoPng));
  if (assets.heroJpeg) writes.push(Bun.write(join(dir, "hero.jpg"), assets.heroJpeg));
  if (assets.displayPng) writes.push(Bun.write(join(dir, "display.png"), assets.displayPng));
  // The HTML guide is self-contained (images inlined) so it can be shared or attached as one file.
  const mimes = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;
  const html = renderGuide(guide, {
    officialLogo: assets.officialLogo ? dataUri(assets.officialLogo.bytes, mimes[assets.officialLogo.ext]) : null,
    logoSvg: assets.logoSvg ? `data:image/svg+xml;base64,${Buffer.from(assets.logoSvg).toString("base64")}` : null,
    logoPng: dataUri(assets.logoPng, "image/png"),
    hero: dataUri(assets.heroJpeg, "image/jpeg"),
    display: dataUri(assets.displayPng, "image/png"),
  });
  writes.push(Bun.write(join(dir, "brand.html"), html));
  await Promise.all(writes);
  return dir;
}

export async function readGuide(slug: string): Promise<BrandGuide | null> {
  const f = Bun.file(join(guideDir(slug), "brand.json"));
  return (await f.exists()) ? ((await f.json()) as BrandGuide) : null;
}

export interface GuideSummary {
  slug: string;
  name: string;
  domain: string;
  generatedAt: string;
  primary: string | null;
  palette: string[];
  mode: "light" | "dark" | null;
  font: string | null;
  tagline: string | null;
  voice: string[];
  logo: string | null;
}

// Compact card data for the UI gallery and the post-run result reveal.
export function summarise(slug: string, g: BrandGuide): GuideSummary {
  const p = g.colors;
  const palette = p ? [p.primary, p.secondary, ...p.accents, ...p.neutrals].filter((c): c is NonNullable<typeof c> => !!c).map((c) => c.hex) : [];
  const logoFile = g.logo.official?.file ?? g.logo.svgFile ?? g.logo.pngFile;
  return {
    slug,
    name: g.company.name,
    domain: g.company.domain,
    generatedAt: g.generatedAt,
    primary: p?.primary.hex ?? null,
    palette: [...new Set(palette)].slice(0, 7),
    mode: p?.mode ?? null,
    font: g.typography?.families.find((f) => f.roles.includes("heading"))?.displayName ?? g.typography?.families[0]?.displayName ?? null,
    tagline: g.messaging.tagline?.text ?? null,
    voice: g.voice.traits.slice(0, 3).map((t) => t.name),
    logo: logoFile ? `/g/${slug}/${logoFile}` : null,
  };
}

export async function listGuides(): Promise<GuideSummary[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(config.outDir);
  } catch {
    return [];
  }
  const out = [];
  for (const slug of entries) {
    const g = await readGuide(slug).catch(() => null);
    if (g) out.push(summarise(slug, g));
  }
  return out.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export function isFresh(g: BrandGuide): boolean {
  return Date.now() - Date.parse(g.generatedAt) < config.cacheHours * 3600_000;
}
