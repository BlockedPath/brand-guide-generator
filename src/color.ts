// Small colour toolkit: sRGB ⇄ HSL/Lab, ΔE, WCAG contrast and plain-English names.

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h *= 60;
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function linear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab({ r, g, b }: RGB): { L: number; a: number; b: number } {
  const R = linear(r), G = linear(g), B = linear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function deltaE(hexA: string, hexB: string): number {
  const a = rgbToLab(hexToRgb(hexA));
  const b = rgbToLab(hexToRgb(hexB));
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

// LCh chroma: ~0 for greys, 30+ for clearly coloured.
export function chroma(hex: string): number {
  const { a, b } = rgbToLab(hexToRgb(hex));
  return Math.hypot(a, b);
}

export function lightness(hex: string): number {
  return rgbToLab(hexToRgb(hex)).L;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export function wcagLevel(ratio: number): "AAA" | "AA" | "AA Large" | "Fail" {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}

// Best text colour (white or near-black) to put on top of a swatch.
export function onColor(hex: string): "#ffffff" | "#111111" {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#111111") ? "#ffffff" : "#111111";
}

const HUES: [number, string][] = [
  [10, "Red"], [25, "Vermilion"], [40, "Orange"], [52, "Amber"], [64, "Yellow"], [80, "Chartreuse"],
  [100, "Lime"], [140, "Green"], [165, "Emerald"], [180, "Teal"], [195, "Cyan"], [210, "Sky"],
  [228, "Blue"], [248, "Indigo"], [265, "Violet"], [285, "Purple"], [310, "Magenta"], [335, "Pink"],
  [350, "Rose"], [361, "Red"],
];

// Deterministic descriptive name, e.g. "Vivid Indigo", "Deep Navy", "Off-White".
export function colorName(hex: string): string {
  const { h, s, l } = rgbToHsl(hexToRgb(hex));
  const c = chroma(hex);
  if (c < 6 || s < 8) {
    if (l >= 97) return "White";
    if (l >= 90) return "Off-White";
    if (l >= 75) return "Light Grey";
    if (l >= 45) return "Grey";
    if (l >= 20) return "Charcoal";
    if (l >= 6) return "Near Black";
    return "Black";
  }
  let hue = HUES.find(([max]) => h < max)?.[1] ?? "Red";
  if (hue === "Blue" && l < 25) hue = "Navy";
  if ((hue === "Orange" || hue === "Amber") && l < 35) hue = "Brown";
  const tint = c < 15 ? (l > 60 ? "Pale" : "Slate") : l >= 85 ? "Pale" : l >= 70 ? "Light" : l <= 18 ? "Deep" : l <= 32 ? "Dark" : s >= 75 ? "Vivid" : "";
  return tint ? `${tint} ${hue}` : hue;
}

export function describe(hex: string) {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  return {
    hex: hex.toUpperCase(),
    rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    name: colorName(hex),
  };
}
