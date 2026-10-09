import type { BrandGuide } from "./guide.ts";
import type { PaletteColor } from "./palette.ts";

// Drop-in exports for design tools and codebases: CSS variables, W3C Design Tokens (DTCG)
// JSON — importable by Figma Tokens Studio, Style Dictionary, etc. — and a Tailwind preset.

function namedColors(g: BrandGuide): [string, PaletteColor][] {
  const p = g.colors;
  if (!p) return [];
  const out: [string, PaletteColor][] = [["primary", p.primary]];
  if (p.secondary) out.push(["secondary", p.secondary]);
  p.accents.forEach((c, i) => out.push([`accent-${i + 1}`, c]));
  out.push(["background", p.background]);
  if (p.surface) out.push(["surface", p.surface]);
  out.push(["text", p.text]);
  if (p.muted) out.push(["muted", p.muted]);
  if (p.border) out.push(["border", p.border]);
  p.neutrals.forEach((c, i) => out.push([`neutral-${(i + 1) * 100}`, c]));
  return out;
}

function fontStack(g: BrandGuide, role: "heading" | "body" | "mono"): string | null {
  return g.typography?.families.find((f) => f.roles.includes(role))?.stack ?? null;
}

function stackList(stack: string): string[] {
  return stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
}

export function cssTokens(g: BrandGuide): string {
  const lines = [`/* ${g.company.name} brand tokens — extracted from ${g.company.url} on ${g.generatedAt.slice(0, 10)} */`, ":root {"];
  for (const [name, c] of namedColors(g)) lines.push(`  --brand-${name}: ${c.hex.toLowerCase()}; /* ${c.name} */`);
  for (const role of ["heading", "body", "mono"] as const) {
    const s = fontStack(g, role);
    if (s) lines.push(`  --font-${role}: ${s};`);
  }
  for (const t of g.typography?.scale ?? []) {
    const key = t.role === "display" ? "display" : t.role;
    lines.push(`  --text-${key}-size: ${t.sizeRem}rem;`);
    lines.push(`  --text-${key}-weight: ${t.weight};`);
    if (t.lineHeight) lines.push(`  --text-${key}-line-height: ${t.lineHeight};`);
    if (t.letterSpacingEm) lines.push(`  --text-${key}-tracking: ${t.letterSpacingEm}em;`);
  }
  const b = g.components?.primaryButton;
  if (b) {
    lines.push(`  --button-radius: ${b.radius};`);
    lines.push(`  --button-padding: ${b.paddingY}px ${b.paddingX}px;`);
    lines.push(`  --button-font-weight: ${b.fontWeight};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

export function dtcgTokens(g: BrandGuide): Record<string, unknown> {
  const color: Record<string, unknown> = {};
  for (const [name, c] of namedColors(g)) color[name] = { $type: "color", $value: c.hex.toLowerCase(), $description: `${c.name}${c.evidence.length ? ` — ${c.evidence.slice(0, 2).join("; ")}` : ""}` };
  const family: Record<string, unknown> = {};
  for (const role of ["heading", "body", "mono"] as const) {
    const s = fontStack(g, role);
    if (s) family[role] = { $type: "fontFamily", $value: stackList(s) };
  }
  const typography: Record<string, unknown> = {};
  for (const t of g.typography?.scale ?? []) {
    const fam = g.typography?.families.find((f) => f.family === t.family);
    const ref = fam ? `{font.family.${fam.roles.includes("heading") && /^(display|h\d)$/.test(t.role) ? "heading" : fam.roles.includes("mono") ? "mono" : fam.roles[0]}}` : t.family;
    typography[t.role] = {
      $type: "typography",
      $value: {
        fontFamily: ref,
        fontSize: `${t.sizePx}px`,
        fontWeight: t.weight,
        ...(t.lineHeight ? { lineHeight: t.lineHeight } : {}),
        ...(t.letterSpacingEm ? { letterSpacing: `${t.letterSpacingEm}em` } : {}),
      },
    };
  }
  const radius: Record<string, unknown> = {};
  if (g.components?.primaryButton) radius.button = { $type: "dimension", $value: g.components.primaryButton.radius };
  return {
    $description: `${g.company.name} brand tokens extracted from ${g.company.url} (${g.generatedAt.slice(0, 10)})`,
    color,
    font: { family },
    typography,
    ...(Object.keys(radius).length ? { radius } : {}),
  };
}

export function tailwindPreset(g: BrandGuide): string {
  const colors: Record<string, string> = {};
  for (const [name, c] of namedColors(g)) colors[name] = c.hex.toLowerCase();
  const fontFamily: Record<string, string[]> = {};
  for (const role of ["heading", "body", "mono"] as const) {
    const s = fontStack(g, role);
    if (s) fontFamily[role] = stackList(s);
  }
  const preset = {
    theme: {
      extend: {
        colors: { brand: colors },
        fontFamily,
        ...(g.components?.primaryButton ? { borderRadius: { brand: g.components.primaryButton.radius } } : {}),
      },
    },
  };
  return `// ${g.company.name} Tailwind preset — generated from ${g.company.url}\n// Usage: presets: [require("./tailwind.preset.js")]\nmodule.exports = ${JSON.stringify(preset, null, 2)};\n`;
}
