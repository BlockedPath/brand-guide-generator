import { chroma, contrastRatio, deltaE, describe, lightness, onColor, wcagLevel } from "./color.ts";
import type { ButtonSample, ColorStat, PageVisual } from "./visual-page.ts";

// Turn raw computed-style colour tallies into a role-based brand palette.

export type ColorRole = "primary" | "secondary" | "accent" | "background" | "surface" | "text" | "muted" | "border";

export interface PaletteColor {
  hex: string;
  name: string;
  rgb: string;
  hsl: string;
  role: ColorRole | "neutral";
  usage: number; // share of measured usage, 0–1
  evidence: string[]; // why it got this role
  tokens: string[]; // matching CSS custom properties declared by the site
  onColor: string; // readable text colour on top of it
  contrast: { white: number; black: number };
}

export interface Palette {
  primary: PaletteColor;
  secondary: PaletteColor | null;
  accents: PaletteColor[];
  background: PaletteColor;
  surface: PaletteColor | null;
  text: PaletteColor;
  muted: PaletteColor | null;
  border: PaletteColor | null;
  neutrals: PaletteColor[];
  pairings: { foreground: string; background: string; ratio: number; level: string; label: string }[];
  isMonochrome: boolean;
  mode: "light" | "dark";
}

interface Cluster extends ColorStat {
  members: string[];
}

const CHROMATIC = 18;
const MERGE_DE = 5;

function mergeStats(stats: ColorStat[]): Cluster[] {
  const sorted = [...stats].sort((a, b) => b.bgArea + b.text * 50 + b.svg - (a.bgArea + a.text * 50 + a.svg));
  const clusters: Cluster[] = [];
  for (const s of sorted) {
    const into = clusters.find((c) => deltaE(c.hex, s.hex) < MERGE_DE);
    if (!into) {
      clusters.push({ ...s, members: [s.hex] });
      continue;
    }
    into.members.push(s.hex);
    for (const k of ["bgArea", "text", "border", "svg", "gradient", "button", "link", "heading"] as const) into[k] += s[k];
  }
  return clusters;
}

function emptyStat(hex: string): ColorStat {
  return { hex, bgArea: 0, text: 0, border: 0, svg: 0, gradient: 0, button: 0, link: 0, heading: 0 };
}

function share(c: ColorStat, k: keyof Omit<ColorStat, "hex">, totals: Record<string, number>): number {
  return totals[k] ? c[k] / totals[k]! : 0;
}

const SEMANTIC_VAR = /(brand|primary|accent|highlight|cta|action)/i;

function tokensFor(hex: string, vars: PageVisual["cssVars"]): string[] {
  return vars
    .filter((v) => deltaE(v.hex, hex) < 2.5)
    .map((v) => v.name)
    .sort((a, b) => Number(SEMANTIC_VAR.test(b)) - Number(SEMANTIC_VAR.test(a)) || a.length - b.length)
    .slice(0, 4);
}

export const CONSENT_TEXT = /^(got it|accept( all)?( cookies)?|ok(ay)?|i agree|agree|allow( all)?|reject( all)?|decline|dismiss|close|no thanks|cookie settings|manage (cookies|preferences)|only necessary)$/i;

function heroButtons(page: PageVisual): ButtonSample[] {
  return page.buttons.filter((b) => !b.fixed && !CONSENT_TEXT.test(b.text) && b.y < page.viewport.height * 1.2);
}

export function buildPalette(page: PageVisual, logoColors: string[]): Palette {
  const clusters = mergeStats(page.colors);
  const totals: Record<string, number> = {};
  for (const k of ["bgArea", "text", "border", "svg", "gradient", "button", "link", "heading"] as const) {
    totals[k] = clusters.reduce((s, c) => s + c[k], 0);
  }
  const usage = (c: Cluster) =>
    share(c, "bgArea", totals) * 0.45 + share(c, "text", totals) * 0.35 + share(c, "svg", totals) * 0.1 + share(c, "gradient", totals) * 0.05 + share(c, "border", totals) * 0.05;

  const hero = heroButtons(page);
  const heroFill = new Map<string, number>();
  for (const b of hero) if (b.kind === "filled" && b.bg) heroFill.set(b.bg, (heroFill.get(b.bg) ?? 0) + 1);
  const heroOutline = new Map<string, number>();
  for (const b of hero) if (b.kind === "outline" && b.borderColor) heroOutline.set(b.borderColor, (heroOutline.get(b.borderColor) ?? 0) + 1);
  const near = (m: Map<string, number>, hex: string) => [...m.entries()].reduce((n, [h, c]) => (deltaE(h, hex) < MERGE_DE ? n + c : n), 0);

  const theme = page.meta.themeColorHex;
  const semanticVars = page.cssVars.filter((v) => SEMANTIC_VAR.test(v.name));

  const evidenceFor = (c: Cluster): string[] => {
    const ev: string[] = [];
    const fills = near(heroFill, c.hex);
    if (fills) ev.push(`fills ${fills} hero button${fills > 1 ? "s" : ""}`);
    if (c.button && !fills) ev.push(`fills ${c.button} button${c.button > 1 ? "s" : ""}`);
    const outlines = near(heroOutline, c.hex);
    if (outlines) ev.push(`outlines ${outlines} hero button${outlines > 1 ? "s" : ""}`);
    if (c.link) ev.push(`link text (${Math.round(share(c, "link", totals) * 100)}% of links)`);
    if (c.heading) ev.push("heading text");
    if (logoColors.some((l) => deltaE(l, c.hex) < MERGE_DE)) ev.push("logo colour");
    if (theme && deltaE(theme, c.hex) < MERGE_DE) ev.push("declared theme-color");
    if (share(c, "bgArea", totals) > 0.02) ev.push(`${Math.round(share(c, "bgArea", totals) * 100)}% of painted background`);
    if (share(c, "text", totals) >= 0.02) ev.push(`${Math.round(share(c, "text", totals) * 100)}% of text`);
    if (c.gradient) ev.push("used in gradients");
    if (semanticVars.some((v) => deltaE(v.hex, c.hex) < 2.5)) ev.push("named as a brand/primary token");
    return ev;
  };

  const brandScore = (c: Cluster) =>
    near(heroFill, c.hex) * 3 +
    share(c, "button", totals) * 3 +
    share(c, "link", totals) * 1.2 +
    share(c, "heading", totals) * 0.6 +
    near(heroOutline, c.hex) * 0.15 +
    (logoColors.some((l) => deltaE(l, c.hex) < MERGE_DE) ? 1.5 : 0) +
    (theme && deltaE(theme, c.hex) < MERGE_DE ? 0.8 : 0) +
    (semanticVars.some((v) => deltaE(v.hex, c.hex) < 2.5) ? 0.3 : 0) +
    share(c, "svg", totals) * 0.4 +
    share(c, "bgArea", totals) * 0.8 +
    share(c, "gradient", totals) * 0.3 +
    share(c, "text", totals) * 0.4;

  const mk = (c: Cluster, role: PaletteColor["role"], extra: string[] = []): PaletteColor => ({
    ...describe(c.hex),
    role,
    usage: Math.round(usage(c) * 1000) / 1000,
    evidence: [...extra, ...evidenceFor(c)],
    tokens: tokensFor(c.hex, page.cssVars),
    onColor: onColor(c.hex),
    contrast: { white: contrastRatio(c.hex, "#ffffff"), black: contrastRatio(c.hex, "#000000") },
  });

  const bgCluster = clusters.find((c) => deltaE(c.hex, page.pageBg) < MERGE_DE) ?? clusters[0]!;
  const mode: Palette["mode"] = lightness(bgCluster.hex) < 50 ? "dark" : "light";
  const textCluster =
    [...clusters].filter((c) => contrastRatio(c.hex, bgCluster.hex) >= 3).sort((a, b) => b.text - a.text)[0] ??
    clusters.find((c) => c !== bgCluster)!;

  const used = new Set<Cluster>([bgCluster, textCluster]);
  const actuallyUsed = (c: Cluster) => usage(c) >= 0.0005 || c.button > 0 || c.link > 0 || c.heading > 0;
  const chromatic = clusters
    .filter((c) => chroma(c.hex) >= CHROMATIC && actuallyUsed(c) && brandScore(c) > 0.02)
    .sort((a, b) => brandScore(b) - brandScore(a));

  // Primary: the strongest chromatic brand signal; for monochrome brands, the hero CTA fill.
  let primaryCluster: Cluster | undefined = chromatic[0];
  let isMonochrome = false;
  const topFill = [...heroFill.entries()].filter(([h]) => deltaE(h, bgCluster.hex) >= MERGE_DE).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!primaryCluster || brandScore(primaryCluster) < 0.35) {
    const anyFill = page.buttons.filter((b) => !b.fixed && !CONSENT_TEXT.test(b.text) && b.kind === "filled" && b.bg && deltaE(b.bg, bgCluster.hex) >= MERGE_DE)[0]?.bg;
    const logoNeutral = logoColors.find((l) => deltaE(l, bgCluster.hex) >= MERGE_DE);
    const ctaHex = topFill ?? logoNeutral ?? anyFill;
    const ctaCluster = ctaHex ? clusters.find((c) => deltaE(c.hex, ctaHex) < MERGE_DE && c !== bgCluster) : undefined;
    if (ctaCluster && chroma(ctaCluster.hex) < CHROMATIC) {
      isMonochrome = true;
      primaryCluster = ctaCluster;
    } else if (ctaCluster) {
      primaryCluster = ctaCluster;
    } else if (!primaryCluster) {
      isMonochrome = true;
      primaryCluster = ctaCluster ?? textCluster;
    }
  }
  const monoSource = topFill ? "the hero call-to-action colour" : logoColors.length ? "the logo colour" : "the main button colour";
  let primaryEvidence = isMonochrome ? [`monochrome brand: primary is ${monoSource}`] : [];

  // A monochrome UI can still declare a chromatic brand colour as a CSS token
  // (e.g. Linear's --color-brand-bg): that token is the brand colour, the CTA stays a neutral.
  const tokenScore = (n: string) =>
    (/brand/i.test(n) ? 3 : 0) + (/primary/i.test(n) ? 2 : 0) + (/accent/i.test(n) ? 1 : 0) - (/hover|active|tint|subdued|disabled|muted|text|border|shadow|focus|\d{2,3}a?$/i.test(n) ? 1.5 : 0);
  const declaredBrand = isMonochrome
    ? page.cssVars.filter((v) => chroma(v.hex) >= CHROMATIC && tokenScore(v.name) >= 2).sort((a, b) => tokenScore(b.name) - tokenScore(a.name))[0]
    : undefined;
  let ctaNeutral: Cluster | undefined;
  if (declaredBrand) {
    const cta = primaryCluster;
    ctaNeutral = cta;
    primaryCluster = clusters.find((c) => deltaE(c.hex, declaredBrand.hex) < MERGE_DE) ?? { ...emptyStat(declaredBrand.hex), members: [declaredBrand.hex] };
    primaryEvidence = [`brand colour declared as ${declaredBrand.name} in the site's CSS; the interface itself uses ${cta ? cta.hex.toUpperCase() : "neutrals"} for calls to action`];
  }
  const primary = mk(primaryCluster!, "primary", primaryEvidence);
  used.add(primaryCluster!);

  const distinct = (c: Cluster, min = 18) => [...used].every((u) => deltaE(u.hex, c.hex) >= min);
  const rest = chromatic.filter((c) => !used.has(c) && distinct(c));
  // A secondary must be visibly used (fills, links, headings, text, art, logo), not just a border or a token.
  const substantial = (c: Cluster) =>
    c.button >= 2 || share(c, "link", totals) >= 0.05 || c.heading > 0 || share(c, "bgArea", totals) >= 0.005 || share(c, "text", totals) >= 0.02 || share(c, "svg", totals) >= 0.02 || logoColors.some((l) => deltaE(l, c.hex) < MERGE_DE);
  const secondaryCluster = rest.find((c) => substantial(c) && brandScore(c) > 0.12);
  if (secondaryCluster) used.add(secondaryCluster);
  const accents: PaletteColor[] = [];
  for (const c of rest.filter((x) => x !== secondaryCluster)) {
    if (accents.length >= 3) break;
    if (!distinct(c)) continue;
    used.add(c);
    accents.push(mk(c, "accent"));
  }

  const neutralsPool = clusters.filter((c) => !used.has(c) && chroma(c.hex) < CHROMATIC).sort((a, b) => usage(b) - usage(a));
  const surfaceCluster = neutralsPool.find(
    (c) => share(c, "bgArea", totals) > 0.01 && Math.abs(lightness(c.hex) - lightness(bgCluster.hex)) < 20 && deltaE(c.hex, bgCluster.hex) >= 2,
  );
  if (surfaceCluster) used.add(surfaceCluster);
  const mutedCluster = neutralsPool.find(
    (c) => !used.has(c) && share(c, "text", totals) > 0.03 && contrastRatio(c.hex, bgCluster.hex) >= 2.5 && deltaE(c.hex, textCluster.hex) >= 10,
  );
  if (mutedCluster) used.add(mutedCluster);
  const borderCluster = [...clusters].filter((c) => !used.has(c) && c.border > 0).sort((a, b) => b.border - a.border)[0];
  if (borderCluster) used.add(borderCluster);

  const neutrals: PaletteColor[] = [];
  for (const c of [bgCluster, surfaceCluster, mutedCluster, textCluster, ctaNeutral, borderCluster, ...neutralsPool]) {
    if (!c || chroma(c.hex) >= CHROMATIC || neutrals.some((n) => deltaE(n.hex, c.hex) < 6)) continue;
    if (usage(c) < 0.002 && ![bgCluster, textCluster, ctaNeutral].includes(c)) continue;
    neutrals.push(mk(c, "neutral"));
    if (neutrals.length >= 7) break;
  }
  neutrals.sort((a, b) => lightness(b.hex) - lightness(a.hex));

  const background = mk(bgCluster, "background", ["page background"]);
  const text = mk(textCluster, "text", ["most-used text colour"]);
  const pairings = [
    { foreground: text.hex, background: background.hex, label: "Body text on background" },
    ...(hero.find((b) => b.kind === "filled" && b.bg && deltaE(b.bg, primary.hex) < MERGE_DE)
      ? [{ foreground: hero.find((b) => b.kind === "filled" && b.bg && deltaE(b.bg, primary.hex) < MERGE_DE)!.color.toUpperCase(), background: primary.hex, label: "Button label on primary" }]
      : [{ foreground: primary.onColor.toUpperCase(), background: primary.hex, label: "Text on primary" }]),
    { foreground: primary.hex, background: background.hex, label: "Primary on background" },
    ...(mutedCluster ? [{ foreground: mutedCluster.hex.toUpperCase(), background: background.hex, label: "Muted text on background" }] : []),
  ].map((p) => {
    const ratio = contrastRatio(p.foreground, p.background);
    return { ...p, ratio, level: wcagLevel(ratio) };
  });

  return {
    primary,
    secondary: secondaryCluster ? mk(secondaryCluster, "secondary") : null,
    accents,
    background,
    surface: surfaceCluster ? mk(surfaceCluster, "surface") : null,
    text,
    muted: mutedCluster ? mk(mutedCluster, "muted") : null,
    border: borderCluster ? mk(borderCluster, "border") : null,
    neutrals,
    pairings,
    isMonochrome,
    mode,
  };
}
