import type { RenderedFont } from "./visual.ts";
import type { PageVisual, TypeSample } from "./visual-page.ts";

// Typefaces and type scale from rendered computed styles + Chrome's platform-font report.

export type FontRole = "heading" | "body" | "mono";

export interface FontFamilyInfo {
  roles: FontRole[];
  family: string; // first family in the CSS stack, as declared
  displayName: string;
  stack: string;
  weights: number[];
  source: "Google Fonts" | "Adobe Fonts" | "Self-hosted" | "System font" | "Unknown";
  isCustom: boolean; // a web font actually rendered (not a system fallback)
  foundry: string | null;
  files: string[];
  googleFontsUrl: string | null;
  category: "sans-serif" | "serif" | "monospace" | "display";
  substitute: string | null; // free Google Fonts stand-in when the real face is proprietary
}

export interface TypeStyle {
  role: string;
  label: string;
  sample: string;
  family: string;
  sizePx: number;
  sizeRem: number;
  weight: number;
  lineHeight: number | null; // unitless ratio
  letterSpacingEm: number | null;
  transform: string | null;
  color: string;
}

export interface Typography {
  families: FontFamilyInfo[];
  scale: TypeStyle[];
  baseSizePx: number;
}

const SYSTEM = /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|ui-serif|ui-monospace|segoe ui|helvetica neue|helvetica|arial|sans-serif|serif|monospace|georgia|times new roman|times|sf pro display|sf pro text|sf mono|menlo|monaco|consolas|courier new|roboto|verdana|tahoma)$/i;

const LABELS: Record<string, string> = {
  display: "Display / hero",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  body: "Body",
  list: "List text",
  nav: "Navigation",
  button: "Button",
  code: "Code",
  caption: "Caption / small",
};

function clean(name: string): string {
  return name.trim().replace(/^["']|["']$/g, "");
}

function prettify(family: string): string {
  const base = family.replace(/[-_ ]?(variable|var|vf|webfont|web)$/i, "").replace(/[-_]+/g, " ").trim();
  return base.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function categoryOf(stack: string, role: FontRole | null): FontFamilyInfo["category"] {
  const s = stack.toLowerCase();
  if (role === "mono" || /monospace|mono\b|code/.test(s)) return "monospace";
  if (/(^|,)\s*serif\s*($|,)/.test(s) || /georgia|times/.test(s)) return "serif";
  if (/cursive|fantasy/.test(s)) return "display";
  return "sans-serif";
}

const SUBSTITUTES: Record<FontFamilyInfo["category"], string> = {
  "sans-serif": "Inter",
  serif: "Source Serif 4",
  monospace: "JetBrains Mono",
  display: "Bricolage Grotesque",
};

const googleCache = new Map<string, boolean>();
async function onGoogleFonts(name: string): Promise<boolean> {
  const cached = googleCache.get(name);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}`, {
      signal: AbortSignal.timeout(5000),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  googleCache.set(name, ok);
  return ok;
}

export function googleFontsCss(name: string, weights: number[]): string {
  const ws = [...new Set(weights.map((w) => Math.min(900, Math.max(100, Math.round(w / 100) * 100))))].sort((a, b) => a - b);
  const axis = ws.length ? `:wght@${ws.join(";")}` : "";
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}${axis}&display=swap`;
}

function ratio(value: string, size: number): number | null {
  const px = parseFloat(value);
  if (!Number.isFinite(px) || !value.endsWith("px")) return null;
  return Math.round((px / size) * 100) / 100;
}

function toStyle(t: TypeSample): TypeStyle {
  return {
    role: t.role,
    label: LABELS[t.role] ?? t.role,
    sample: t.text,
    family: clean(t.fontFamily.split(",")[0] ?? ""),
    sizePx: Math.round(t.fontSize * 10) / 10,
    sizeRem: Math.round((t.fontSize / 16) * 1000) / 1000,
    weight: t.fontWeight,
    lineHeight: ratio(t.lineHeight, t.fontSize),
    letterSpacingEm: t.letterSpacing === "normal" ? null : ratio(t.letterSpacing, t.fontSize),
    transform: t.textTransform === "none" ? null : t.textTransform,
    color: t.color.toUpperCase(),
  };
}

export async function buildTypography(page: PageVisual, rendered: RenderedFont[]): Promise<Typography> {
  const byRole = new Map(page.type.map((t) => [t.role, t]));
  const famOf = (role: string) => {
    const t = byRole.get(role);
    return t ? clean(t.fontFamily.split(",")[0] ?? "") : null;
  };
  const isMono = (fam: string | null, stack = "") => !!fam && /mono|code|courier|consolas|menlo/i.test(`${fam} ${stack}`);
  const heading = famOf("display") ?? famOf("h1") ?? famOf("h2");
  // Body = the family carrying the most running text (UI mock-ups can put code fonts in a <p>).
  const sampled = famOf("body") ?? famOf("list");
  const topText = page.families.find((f) => !isMono(f.family, f.stack))?.family ?? null;
  const body = sampled && !isMono(sampled) ? sampled : topText ?? sampled;
  const mono = famOf("code") ?? page.families.find((f) => isMono(f.family, f.stack))?.family ?? null;

  const roleMap = new Map<string, FontRole[]>();
  const add = (fam: string | null, role: FontRole) => {
    if (!fam) return;
    roleMap.set(fam, [...(roleMap.get(fam) ?? []), role]);
  };
  add(heading, "heading");
  add(body, "body");
  if (mono && mono !== body) add(mono, "mono");

  const renderedFor = (fam: string) => {
    const roles = page.type.filter((t) => clean(t.fontFamily.split(",")[0] ?? "") === fam).map((t) => t.role);
    return rendered.filter((r) => roles.includes(r.role)).flatMap((r) => r.families.slice(0, 1));
  };

  const families: FontFamilyInfo[] = [];
  for (const [family, roles] of roleMap) {
    const usage = page.families.find((f) => f.family === family);
    const stack = usage?.stack ?? byRole.get(roles[0] === "heading" ? "h1" : "body")?.fontFamily ?? family;
    const plat = renderedFor(family);
    const isCustom = plat.some((p) => p.isCustomFont);
    const copyright = plat.map((p) => p.familyName).find((n) => /copyright|©/i.test(n));
    const foundry = copyright ? copyright.replace(/.*?(copyright|©)\s*(\(c\))?\s*(\d{4}[-–,\s\d]*)?/i, "").trim() || null : null;
    const slug = family.toLowerCase().replace(/[^a-z0-9]/g, "");
    const files = page.fontResources.filter((u) => {
      const tail = decodeURIComponent(u.split("?")[0]!.split("/").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return slug.length >= 3 && tail.includes(slug.replace(/(variable|var|vf)$/, ""));
    });
    const gfHit = page.fontResources.some((u) => /fonts\.googleapis\.com/.test(u) && decodeURIComponent(u).toLowerCase().replace(/\+/g, " ").includes(family.toLowerCase()));
    const typekit = page.fontResources.some((u) => /typekit\.net/.test(u));
    const system = SYSTEM.test(family) && !isCustom;

    const displayName = prettify(family);
    const googleName = (await onGoogleFonts(family)) ? family : (await onGoogleFonts(displayName)) ? displayName : null;
    const category = categoryOf(stack, roles.includes("mono") ? "mono" : null);
    families.push({
      roles,
      family,
      displayName,
      stack,
      weights: (usage?.weights ?? []).filter((w) => w > 0),
      source: system ? "System font" : gfHit ? "Google Fonts" : files.length ? "Self-hosted" : typekit && isCustom ? "Adobe Fonts" : isCustom ? "Self-hosted" : googleName ? "Google Fonts" : "Unknown",
      isCustom,
      foundry,
      files: files.slice(0, 4),
      googleFontsUrl: googleName ? googleFontsCss(googleName, usage?.weights ?? [400, 700]) : null,
      category,
      substitute: googleName || system ? null : SUBSTITUTES[category],
    });
  }

  const order = ["display", "h1", "h2", "h3", "h4", "body", "list", "button", "nav", "caption", "code"];
  const scale = page.type
    .filter((t) => order.includes(t.role))
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
    .map(toStyle)
    .filter((s, i, all) => !(s.role === "display" && all.some((o) => o.role === "h1" && o.sizePx === s.sizePx && o.family === s.family)))
    .filter((s) => s.role !== "list" || !(byRole.get("body") && Math.abs(byRole.get("body")!.fontSize - s.sizePx) < 1));

  const baseSizePx = page.textSizes.filter((t) => t.size >= 12 && t.size <= 22).sort((a, b) => b.chars - a.chars)[0]?.size ?? 16;
  return { families, scale, baseSizePx };
}
