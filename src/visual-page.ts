/// <reference lib="dom" />
// Runs INSIDE the target page via Playwright's page.evaluate. Playwright serialises the
// function source, so it must stay self-contained: no imports, no module-scope references.
// Everything is measured from the live, rendered DOM (computed styles), not from CSS source.

export interface ColorStat {
  hex: string;
  bgArea: number; // px² of visible area newly painted with this background
  text: number; // characters of text drawn in this colour, weighted by font size
  border: number;
  svg: number; // px² of SVG shapes filled/stroked with it
  gradient: number;
  button: number; // filled buttons using it as background
  link: number;
  heading: number;
}

export interface ButtonSample {
  text: string;
  kind: "filled" | "outline";
  y: number;
  bg: string | null;
  color: string;
  borderColor: string | null;
  borderWidth: number;
  radius: string;
  paddingX: number;
  paddingY: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textTransform: string;
  letterSpacing: string;
  fixed: boolean; // inside a fixed/sticky overlay below the header (banners, chat widgets)
}

export interface TypeSample {
  role: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  color: string;
}

export interface LogoCandidate {
  kind: "svg" | "img" | "bg";
  src: string | null;
  svg: string | null;
  alt: string | null;
  width: number;
  height: number;
  score: number;
  colors: string[];
}

export interface PageVisual {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scannedHeight: number;
  elementsScanned: number;
  pageBg: string;
  colors: ColorStat[];
  cssVars: { name: string; value: string; hex: string }[];
  buttons: ButtonSample[];
  type: TypeSample[];
  families: { family: string; stack: string; chars: number; weights: number[] }[];
  textSizes: { size: number; chars: number }[];
  loadedFonts: { family: string; weight: string; style: string }[];
  fontResources: string[];
  logo: LogoCandidate | null;
  meta: {
    themeColor: string | null;
    themeColorHex: string | null;
    ogImage: string | null;
    siteName: string | null;
    twitter: string | null;
    description: string | null;
    manifest: string | null;
    icons: { rel: string; href: string; sizes: string | null; color: string | null }[];
  };
}

export function collectPageVisual(brandHint: string): PageVisual {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxY = Math.min(document.documentElement.scrollHeight, vh * 4);

  // Any CSS colour syntax (oklch, color(), hsl, named…) → sRGB via a 1px canvas.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const colorCache = new Map<string, { hex: string; a: number } | null>();
  function toColor(value: string | null | undefined): { hex: string; a: number } | null {
    if (!value) return null;
    const v = value.trim();
    if (!v || v === "none" || v === "transparent" || v.startsWith("url(") || v.includes("var(")) return null;
    const cached = colorCache.get(v);
    if (cached !== undefined) return cached;
    let out: { hex: string; a: number } | null = null;
    ctx.fillStyle = "#010203";
    ctx.fillStyle = v;
    const accepted = String(ctx.fillStyle) !== "#010203" || /^#010203$/i.test(v);
    if (accepted) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      const a = d[3]! / 255;
      if (a > 0) {
        const h = (n: number) => n.toString(16).padStart(2, "0");
        out = { hex: `#${h(d[0]!)}${h(d[1]!)}${h(d[2]!)}`, a };
      }
    }
    colorCache.set(v, out);
    return out;
  }

  const stats = new Map<string, ColorStat>();
  function stat(hex: string): ColorStat {
    let s = stats.get(hex);
    if (!s) {
      s = { hex, bgArea: 0, text: 0, border: 0, svg: 0, gradient: 0, button: 0, link: 0, heading: 0 };
      stats.set(hex, s);
    }
    return s;
  }

  function clippedArea(r: DOMRect): number {
    const top = r.top + window.scrollY;
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(top + r.height, maxY) - Math.max(top, 0));
    return w * h;
  }

  function isVisible(el: Element, cs: CSSStyleDeclaration, r: DOMRect): boolean {
    if (r.width < 1 || r.height < 1) return false;
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.1) return false;
    return true;
  }

  function directTextLength(el: Element): number {
    let n = 0;
    for (const c of el.childNodes) if (c.nodeType === 3) n += (c.textContent ?? "").trim().length;
    return n;
  }

  function firstFamily(stack: string): string {
    return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
  }

  const root = document.documentElement;
  const rootBg = toColor(getComputedStyle(root).backgroundColor);
  const bodyBg = toColor(getComputedStyle(document.body).backgroundColor);
  const pageBg =
    bodyBg && bodyBg.a >= 0.5 ? bodyBg.hex : rootBg && rootBg.a >= 0.5 ? rootBg.hex : "#ffffff";
  stat(pageBg).bgArea += vw * maxY;

  // Effective background per element (parents are visited before children in document order).
  const effBg = new WeakMap<Element, string>();
  // Fixed overlays below the header (cookie/language pop-ups, chat widgets) aren't brand surfaces.
  const overlayOf = new WeakMap<Element, boolean>();
  effBg.set(document.body, pageBg);
  const parentBg = (el: Element) => (el.parentElement && effBg.get(el.parentElement)) || pageBg;

  const families = new Map<string, { stack: string; chars: number; weights: Set<number> }>();
  const textSizes = new Map<number, number>();
  const buttons: ButtonSample[] = [];
  const GRADIENT_COLOR = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lch\([^)]*\)|lab\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;

  const all = document.body.querySelectorAll("*");
  let scanned = 0;
  for (let i = 0; i < all.length && scanned < 9000; i++) {
    const el = all[i]!;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") continue;
    const r = el.getBoundingClientRect();
    const absTop = r.top + window.scrollY;
    const cs = getComputedStyle(el);
    const overlay =
      (el.parentElement ? overlayOf.get(el.parentElement) ?? false : false) ||
      (cs.position === "fixed" && (r.top > 160 || el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true"));
    overlayOf.set(el, overlay);
    if (overlay || absTop > maxY || !isVisible(el, cs, r)) {
      effBg.set(el, parentBg(el));
      continue;
    }
    scanned++;
    const area = clippedArea(r);
    const inherited = parentBg(el);

    const bg = toColor(cs.backgroundColor);
    const ownBg = bg && bg.a >= 0.5 ? bg.hex : null;
    effBg.set(el, ownBg ?? inherited);
    if (ownBg && ownBg !== inherited) stat(ownBg).bgArea += area;

    if (cs.backgroundImage && cs.backgroundImage.includes("gradient")) {
      for (const m of cs.backgroundImage.match(GRADIENT_COLOR) ?? []) {
        const c = toColor(m);
        if (c && c.a >= 0.5) stat(c.hex).gradient += area * 0.3 + 1;
      }
    }

    const textLen = directTextLength(el);
    const fontSize = parseFloat(cs.fontSize) || 16;
    if (textLen > 0) {
      const c = toColor(cs.color);
      if (c && c.a >= 0.4) {
        const s = stat(c.hex);
        s.text += textLen * (fontSize / 16);
        if (/^H[1-3]$/.test(tag)) s.heading += textLen;
        if (tag === "A") s.link += textLen;
      }
      if (!/^H[1-6]$/.test(tag)) textSizes.set(Math.round(fontSize), (textSizes.get(Math.round(fontSize)) ?? 0) + textLen);
      const fam = firstFamily(cs.fontFamily);
      if (fam) {
        let f = families.get(fam);
        if (!f) families.set(fam, (f = { stack: cs.fontFamily, chars: 0, weights: new Set() }));
        f.chars += textLen;
        f.weights.add(Number(cs.fontWeight) || 400);
      }
    }

    const bw = parseFloat(cs.borderTopWidth) || 0;
    if (bw > 0 && cs.borderTopStyle !== "none") {
      const c = toColor(cs.borderTopColor);
      if (c && c.a >= 0.3) stat(c.hex).border += (r.width + r.height) * 2 * bw;
    }

    if (el instanceof SVGGeometryElement || tag.toLowerCase() === "text") {
      for (const prop of ["fill", "stroke"] as const) {
        const c = toColor(cs.getPropertyValue(prop));
        if (c && c.a >= 0.5) stat(c.hex).svg += Math.max(area, 20);
      }
    }

    // Buttons / CTAs: real buttons, links styled as buttons, and .btn-like wrappers.
    // Many sites paint the button surface on ::before/::after (e.g. 3D buttons): count that as the fill.
    let pseudoBg: string | null = null;
    let pseudoBorder: { hex: string; w: number } | null = null;
    if (!ownBg && (tag === "A" || tag === "BUTTON" || el.getAttribute("role") === "button") && r.height >= 24 && r.height <= 90) {
      for (const pseudo of ["::before", "::after"]) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === "none") continue;
        const pbg = toColor(ps.backgroundColor);
        if (pbg && pbg.a >= 0.5 && pbg.hex !== inherited) pseudoBg = pbg.hex;
        const pbw = parseFloat(ps.borderTopWidth) || 0;
        const pbc = toColor(ps.borderTopColor);
        if (pbw >= 1 && pbc && pbc.a >= 0.3 && pbc.hex !== inherited) pseudoBorder = { hex: pbc.hex, w: pbw };
        if (pseudoBg) break;
      }
      if (pseudoBg) stat(pseudoBg).bgArea += area;
    }
    const looksButton =
      pseudoBg !== null ||
      pseudoBorder !== null ||
      tag === "BUTTON" ||
      el.getAttribute("role") === "button" ||
      (tag === "A" && (ownBg !== null || bw > 0)) ||
      /(^|[\s_-])(btn|button|cta)([\s_-]|$)/i.test(typeof el.className === "string" ? el.className : "");
    if (looksButton && r.height >= 24 && r.height <= 90 && r.width >= 40 && r.width <= 480) {
      const text = ((el as HTMLElement).innerText ?? "").trim().replace(/\s+/g, " ").replace(/^(.+?)\s+\1$/i, "$1");
      if (text.length >= 2 && text.length <= 40 && !/^skip to/i.test(text)) {
        const ownBorder = toColor(cs.borderTopColor);
        const border = ownBorder && ownBorder.a >= 0.3 && bw >= 1 ? ownBorder : pseudoBorder ? { hex: pseudoBorder.hex, a: 1 } : null;
        const borderW = ownBorder && ownBorder.a >= 0.3 && bw >= 1 ? bw : pseudoBorder?.w ?? 0;
        const fill = ownBg !== null && ownBg !== inherited ? ownBg : pseudoBg;
        const filled = fill !== null;
        const outlined = !filled && borderW >= 1 && border !== null && border.hex !== inherited;
        if (filled || outlined) {
          let fixed = false;
          for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
            const pos = getComputedStyle(p).position;
            if (pos === "fixed" || pos === "sticky") {
              fixed = p.getBoundingClientRect().top > 160 || !!p.closest("[role='dialog'], dialog, [aria-modal='true']");
              break;
            }
          }
          if (filled && !fixed) stat(fill!).button += 1;
          const color = toColor(cs.color);
          buttons.push({
            text,
            kind: filled ? "filled" : "outline",
            y: Math.round(absTop),
            bg: filled ? fill : null,
            color: color ? color.hex : "#000000",
            borderColor: borderW >= 1 && border ? border.hex : null,
            borderWidth: borderW,
            radius: cs.borderTopLeftRadius,
            paddingX: parseFloat(cs.paddingLeft) || 0,
            paddingY: parseFloat(cs.paddingTop) || 0,
            height: Math.round(r.height),
            fontFamily: firstFamily(cs.fontFamily),
            fontSize,
            fontWeight: Number(cs.fontWeight) || 400,
            textTransform: cs.textTransform,
            letterSpacing: cs.letterSpacing,
            fixed,
          });
        }
      }
    }
  }

  // Typography samples per role; mark nodes so the caller can ask CDP which font actually rendered.
  const type: TypeSample[] = [];
  const roleSelectors: [string, string][] = [
    ["h1", "h1"],
    ["h2", "h2"],
    ["h3", "h3"],
    ["h4", "h4"],
    ["body", "main p, article p, section p, p"],
    ["list", "main li, li"],
    ["nav", "header nav a, nav a, header a"],
    ["button", "button, a[class*='btn' i], a[class*='button' i]"],
    ["code", "code, pre, kbd"],
    ["caption", "small, figcaption, footer p"],
  ];
  function sample(role: string, el: Element) {
    const cs = getComputedStyle(el);
    const c = toColor(cs.color);
    el.setAttribute("data-bgg-font", role);
    type.push({
      role,
      text: ((el as HTMLElement).innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
      fontFamily: cs.fontFamily,
      fontSize: parseFloat(cs.fontSize) || 16,
      fontWeight: Number(cs.fontWeight) || 400,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      color: c ? c.hex : "#000000",
    });
  }
  // Body copy = the most common running-text size, not just the first <p> (often a large lead).
  let bodySize = 16;
  let bodyChars = 0;
  for (const [size, chars] of textSizes) if (size >= 12 && size <= 22 && chars > bodyChars) [bodySize, bodyChars] = [size, chars];
  for (const [role, sel] of roleSelectors) {
    let fallback: Element | null = null;
    let chosen: Element | null = null;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const text = ((el as HTMLElement).innerText ?? "").trim();
      if (text.length < 2 || !isVisible(el, cs, r) || r.top + window.scrollY >= maxY) continue;
      if (role !== "body" || Math.round(parseFloat(cs.fontSize)) === bodySize) {
        chosen = el;
        break;
      }
      fallback ??= el;
    }
    if (chosen ?? fallback) sample(role, (chosen ?? fallback)!);
  }
  // "Display": the largest text in the first viewport — often the hero headline even when it isn't an <h1>.
  let display: Element | null = null;
  let displaySize = 0;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.top + window.scrollY > vh || r.width < 1) continue;
    if (directTextLength(el) < 3) continue;
    const size = parseFloat(getComputedStyle(el).fontSize) || 0;
    if (size > displaySize) {
      displaySize = size;
      display = el;
    }
  }
  if (display) sample("display", display);

  // Declared colour tokens (custom properties) on :root.
  const cssVars: { name: string; value: string; hex: string }[] = [];
  const seenVar = new Set<string>();
  function addVar(name: string, raw: string) {
    if (seenVar.has(name) || cssVars.length >= 200) return;
    let value = raw.trim();
    let c = toColor(value);
    if (!c && /^\d+(\.\d+)?(deg)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(value)) c = toColor(`hsl(${value})`);
    if (!c && /^\d+(\.\d+)?%?\s+\d+(\.\d+)?%?\s+\d+(\.\d+)?(deg)?$/.test(value) && /oklch|lch/i.test(name)) c = toColor(`oklch(${value})`);
    if (c && c.a >= 0.5) {
      seenVar.add(name);
      cssVars.push({ name, value, hex: c.hex });
    }
  }
  const rootCs = getComputedStyle(root);
  for (let i = 0; i < rootCs.length; i++) {
    const p = rootCs[i]!;
    if (p.startsWith("--")) addVar(p, rootCs.getPropertyValue(p));
  }
  if (cssVars.length === 0) {
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule && /^(:root|html|body)\b/.test(rule.selectorText)) {
          for (const p of rule.style) if (p.startsWith("--")) addVar(p, rootCs.getPropertyValue(p) || rule.style.getPropertyValue(p));
        } else if ("cssRules" in rule) {
          walk((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        // cross-origin stylesheet without CORS — computed styles above already cover what renders
      }
    }
  }

  // Logo: score candidates near the top of the page.
  const host = location.hostname.replace(/^www\./, "");
  const brand = brandHint.toLowerCase().replace(/[^a-z0-9]/g, "");
  function isHomeLink(a: HTMLAnchorElement | null): boolean {
    if (!a) return false;
    try {
      const u = new URL(a.getAttribute("href") ?? "", location.href);
      if (u.hostname.replace(/^www\./, "") !== host) return false;
      const p = u.pathname.replace(/\/+$/, "");
      return p === "" || p === "/home" || /^\/[a-z]{2}([-_][a-z]{2})?$/i.test(p);
    } catch {
      return false;
    }
  }
  function labelOf(el: Element): string {
    const bits = [
      el.getAttribute("alt"),
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.querySelector?.("title")?.textContent,
      typeof el.className === "string" ? el.className : (el.className as unknown as SVGAnimatedString)?.baseVal,
      el.id,
    ];
    return bits.filter(Boolean).join(" ").toLowerCase();
  }
  let best: { el: Element; score: number } | null = null;
  for (const el of document.querySelectorAll("svg, img, [class*='logo' i], [id*='logo' i]")) {
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    if (el.tagName.toLowerCase() === "svg" && el.parentElement?.closest("svg")) continue;
    const r = el.getBoundingClientRect();
    const top = r.top + window.scrollY;
    if (top > 220 || r.width < 16 || r.width > 420 || r.height < 10 || r.height > 180) continue;
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs, r)) continue;
    let score = 0;
    if (isHomeLink(el.closest("a"))) score += 4;
    let label = labelOf(el);
    for (let p = el.parentElement, d = 0; p && d < 3; p = p.parentElement, d++) label += " " + labelOf(p);
    if (label.includes("logo")) score += 3;
    if (brand && label.replace(/[^a-z0-9]/g, "").includes(brand)) score += 2;
    if (el.closest("header, nav, [role='banner']")) score += 2;
    if (r.left < vw * 0.3) score += 1;
    if (top < 120) score += 1;
    if (r.width < 26 && r.height < 26) score -= 3;
    if (el.closest("button")) score -= 2;
    const tag = el.tagName.toLowerCase();
    if (tag !== "svg" && tag !== "img") {
      const inner = el.querySelector("svg, img");
      if (!inner && !cs.backgroundImage.startsWith("url(")) continue;
    }
    if (!best || score > best.score) best = { el, score };
  }

  function inlineSvg(svg: SVGSVGElement): { markup: string; colors: string[] } {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const orig = [svg, ...svg.querySelectorAll("*")];
    const copy = [clone, ...clone.querySelectorAll("*")];
    const colors = new Set<string>();
    orig.forEach((o, i) => {
      const c = copy[i] as SVGElement | undefined;
      if (!c?.style) return;
      const cs = getComputedStyle(o);
      for (const p of ["fill", "stroke", "stroke-width", "fill-opacity", "fill-rule", "clip-rule", "stop-color", "stop-opacity", "opacity"]) {
        const v = cs.getPropertyValue(p);
        if (v) c.style.setProperty(p, v);
      }
      if (o instanceof SVGGeometryElement || o.tagName.toLowerCase() === "use" || o.tagName.toLowerCase() === "text") {
        for (const p of ["fill", "stroke"]) {
          const col = toColor(cs.getPropertyValue(p));
          if (col && col.a >= 0.5) colors.add(col.hex);
        }
      }
    });
    for (const u of clone.querySelectorAll("use")) {
      const ref = u.getAttribute("href") ?? u.getAttribute("xlink:href");
      if (!ref?.startsWith("#") || clone.querySelector(ref)) continue;
      const target = document.getElementById(ref.slice(1));
      if (!target) continue;
      let defs = clone.querySelector("defs");
      if (!defs) defs = clone.insertBefore(document.createElementNS("http://www.w3.org/2000/svg", "defs"), clone.firstChild);
      defs.appendChild(target.cloneNode(true));
    }
    if (colors.size === 0) {
      const own = toColor(getComputedStyle(svg).fill) ?? toColor(getComputedStyle(svg).color);
      if (own && own.a >= 0.5) colors.add(own.hex);
    }
    const r = svg.getBoundingClientRect();
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    clone.setAttribute("width", String(Math.round(r.width)));
    clone.setAttribute("height", String(Math.round(r.height)));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.removeAttribute("class");
    clone.removeAttribute("data-bgg-logo");
    return { markup: clone.outerHTML, colors: [...colors] };
  }

  let logo: LogoCandidate | null = null;
  if (best && best.score >= 3) {
    let el = best.el;
    const tag = el.tagName.toLowerCase();
    if (tag !== "svg" && tag !== "img") el = el.querySelector("svg, img") ?? el;
    el.setAttribute("data-bgg-logo", "1");
    const r = el.getBoundingClientRect();
    const base = { alt: el.getAttribute("alt") ?? el.getAttribute("aria-label"), width: Math.round(r.width), height: Math.round(r.height), score: best.score };
    if (el instanceof SVGSVGElement) {
      const { markup, colors } = inlineSvg(el);
      logo = { kind: "svg", src: null, svg: markup.length <= 150_000 ? markup : null, colors, ...base };
    } else if (el instanceof HTMLImageElement) {
      logo = { kind: "img", src: el.currentSrc || el.src, svg: null, colors: [], ...base };
    } else {
      const m = getComputedStyle(el).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      logo = { kind: "bg", src: m ? new URL(m[1]!, location.href).href : null, svg: null, colors: [], ...base };
    }
  }

  const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() || null;
  const abs = (v: string | null) => {
    if (!v) return null;
    try {
      return new URL(v, location.href).href;
    } catch {
      return null;
    }
  };

  const fontResources = [
    ...performance.getEntriesByType("resource").map((e) => e.name),
    ...[...document.querySelectorAll("link[href]")].map((l) => (l as HTMLLinkElement).href),
  ].filter(
    (n) =>
      /\.(woff2?|ttf|otf)(\?|#|$)/i.test(n) ||
      /fonts\.googleapis\.com|use\.typekit\.net|p\.typekit\.net|fonts\.gstatic\.com|fonts\.bunny\.net|cloud\.typography\.com|fast\.fonts\.net/i.test(n),
  );

  return {
    url: location.href,
    title: document.title,
    viewport: { width: vw, height: vh },
    scannedHeight: maxY,
    elementsScanned: scanned,
    pageBg,
    colors: [...stats.values()],
    cssVars,
    buttons: buttons.sort((a, b) => a.y - b.y).slice(0, 40),
    type,
    families: [...families.entries()]
      .map(([family, f]) => ({ family, stack: f.stack, chars: f.chars, weights: [...f.weights].sort((a, b) => a - b) }))
      .sort((a, b) => b.chars - a.chars)
      .slice(0, 12),
    textSizes: [...textSizes.entries()].map(([size, chars]) => ({ size, chars })).sort((a, b) => b.chars - a.chars).slice(0, 12),
    loadedFonts: [...document.fonts]
      .filter((f) => f.status === "loaded")
      .map((f) => ({ family: f.family.replace(/^["']|["']$/g, ""), weight: f.weight, style: f.style }))
      .slice(0, 60),
    fontResources: [...new Set(fontResources)].slice(0, 40),
    logo,
    meta: {
      themeColor: meta('meta[name="theme-color"]'),
      themeColorHex: toColor(meta('meta[name="theme-color"]'))?.hex ?? null,
      ogImage: abs(meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]')),
      siteName: meta('meta[property="og:site_name"]') ?? meta('meta[name="application-name"]'),
      twitter: meta('meta[name="twitter:site"]'),
      description: meta('meta[name="description"]') ?? meta('meta[property="og:description"]'),
      manifest: abs(document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null),
      icons: [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]')].map((l) => ({
        rel: l.getAttribute("rel") ?? "icon",
        href: (l as HTMLLinkElement).href,
        sizes: l.getAttribute("sizes"),
        color: l.getAttribute("color"),
      })),
    },
  };
}

// Hide cookie/consent overlays rather than accepting them, so they don't pollute colours.
export function hideConsentOverlays(): number {
  let hidden = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    const id = `${el.id} ${typeof el.className === "string" ? el.className : ""}`;
    const text = ((el as HTMLElement).innerText ?? "").slice(0, 400);
    if (/cookie|consent|gdpr|onetrust|privacy-banner|cmp/i.test(id) || (/cookie/i.test(text) && text.length < 1500 && el.tagName !== "HEADER")) {
      (el as HTMLElement).style.setProperty("display", "none", "important");
      hidden++;
    }
  }
  return hidden;
}

// Scroll through the scanned region so lazy sections render, then return to the top.
export async function warmLazyContent(viewports: number): Promise<void> {
  const step = window.innerHeight * 0.8;
  const end = Math.min(document.documentElement.scrollHeight, window.innerHeight * viewports);
  for (let y = 0; y < end; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));
}

export interface Swatch {
  hex: string;
  label: string | null;
  score: number;
}

// On an official brand-guidelines page: read colour swatches that only exist visually
// (solid tiles near "colour" headings or labelled with hex/RGB/Pantone values).
export function collectSwatches(): Swatch[] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const toHex = (v: string): { hex: string; a: number } | null => {
    if (!v || v === "transparent") return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#010203";
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const h = (n: number) => n.toString(16).padStart(2, "0");
    return d[3]! > 0 ? { hex: `#${h(d[0]!)}${h(d[1]!)}${h(d[2]!)}`, a: d[3]! / 255 } : null;
  };
  const bodyBg = toHex(getComputedStyle(document.body).backgroundColor);
  const pageBg = bodyBg && bodyBg.a > 0.5 ? bodyBg.hex : toHex(getComputedStyle(document.documentElement).backgroundColor)?.hex ?? "#ffffff";
  const COLOR_WORD = /colou?rs?|palette|swatch/i;
  const VALUE = /#[0-9a-f]{6}\b|\brgb\s*\(|\bcmyk\b|\bpantone\b|\bpms\b|\bhsl\s*\(/i;
  const byHex = new Map<string, Swatch>();
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 28 || r.height < 28 || r.width > 720 || r.height > 520) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const c = toHex(cs.backgroundColor);
    if (!c || c.a < 0.95 || c.hex === pageBg) continue;
    if (el.querySelector("img, video, canvas, picture") || el.children.length > 8) continue;
    const own = ((el as HTMLElement).innerText ?? "").trim().replace(/\s+/g, " ");
    if (/^(copy|copied|download|copy (hex|code|value))$/i.test(own) || r.width < 48 || r.height < 40) continue;
    const around = ((el.parentElement as HTMLElement | null)?.innerText ?? "").trim().replace(/\s+/g, " ");
    if (own.length > 140) continue;
    let section = "";
    for (let p = el.parentElement, d = 0; p && d < 6; p = p.parentElement, d++) {
      const head = p.querySelector("h1, h2, h3, h4");
      if (head) {
        section = head.textContent ?? "";
        break;
      }
    }
    const aspect = r.width / r.height;
    let score = 0;
    if (VALUE.test(own)) score += 3;
    else if (VALUE.test(around) && around.length < 200) score += 2;
    if (COLOR_WORD.test(section)) score += 2;
    if (aspect > 0.4 && aspect < 2.6) score += 1;
    if (el.closest("nav, header, footer")) score -= 3;
    else if ((el.tagName === "A" || el.tagName === "BUTTON") && !VALUE.test(own)) score -= 3;
    if (score < 3) continue;
    const raw = own || (around.length < 120 ? around : "");
    const name = raw.split(/\b(?:RGB|HEX|CMYK|HSL|PMS|Pantone)\b|#[0-9a-f]{6}\b|\bcopy\b/i)[0]!.trim();
    const label = (name || raw).slice(0, 60) || null;
    const prev = byHex.get(c.hex);
    if (!prev || score > prev.score) byHex.set(c.hex, { hex: c.hex, label, score });
  }
  return [...byHex.values()].sort((a, b) => b.score - a.score).slice(0, 16);
}

export interface DomContent {
  markdown: string;
  links: string[];
}

// Fallback content source for JS-only sites where Fetch returns no text: turn the rendered
// DOM's headings, paragraphs and list items into Markdown, plus every link on the page.
export function collectDomContent(): DomContent {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const el of document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote")) {
    if (el.closest("nav, footer, [role='navigation'], [aria-hidden='true']")) continue;
    if (el.tagName === "LI" && el.querySelector("p, h1, h2, h3, h4, li")) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.display === "none" || cs.visibility === "hidden") continue;
    const text = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const level = /^H([1-6])$/.exec(el.tagName)?.[1];
    lines.push(level ? `${"#".repeat(Number(level))} ${text}` : el.tagName === "LI" ? `- ${text}` : text);
  }
  const links = [...new Set([...document.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).href).filter((h) => /^https?:/.test(h)))].slice(0, 400);
  return { markdown: lines.join("\n\n"), links };
}
