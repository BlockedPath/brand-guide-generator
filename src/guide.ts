import { config } from "./config.ts";
import { deltaE } from "./color.ts";
import { cleanUrl, kindOf, pickSubpages, sameSite, type PageKind, type PagePick } from "./discover.ts";
import { copySentences, extractBrandRules, extractMessaging, headlines, stripChrome, toDoc, type BrandRules, type Messaging } from "./messaging.ts";
import { buildPalette, CONSENT_TEXT, type Palette } from "./palette.ts";
import { parseHead, type DeclaredIdentity } from "./identity.ts";
import { brandName, resolveInput } from "./resolve.ts";
import { TinyFishClient, type CallRecord, type FetchedPage, type SearchHit } from "./tinyfish.ts";
import { buildTypography, type Typography } from "./typography.ts";
import { captureVisual, imageExt, type ImageExt, type VisualCapture } from "./visual.ts";
import type { ButtonSample } from "./visual-page.ts";
import { analyseVoice, type Voice } from "./voice.ts";

// Orchestrates Search → (Browser ∥ Fetch ∥ Search) → Fetch → analysis into one structured brand guide.

export interface ButtonStyle {
  label: string;
  background: string | null;
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
  textTransform: string | null;
  letterSpacing: string | null;
}

export interface LogoInfo {
  // Official logo the site declares in its schema.org data (read with Fetch), downloaded when possible.
  official: { url: string; file: string | null; source: string } | null;
  primarySource: "schema.org (Fetch)" | "brand page (Fetch)" | "site header (Browser)" | null;
  kind: "svg" | "img" | "bg" | "remote" | null;
  svgFile: string | null;
  pngFile: string | null;
  sourceUrl: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  colors: string[];
  favicon: string | null;
  appleTouchIcon: string | null;
  ogImage: string | null;
  officialFiles: string[];
}

export interface BrandGuide {
  schema: "brand-guide/v1";
  generatedAt: string;
  input: string;
  company: {
    name: string;
    domain: string;
    url: string;
    description: string | null;
    twitter: string | null;
    social: string[];
    declared: DeclaredIdentity | null;
    resolvedVia: "url" | "search";
    searchCandidates: { url: string; title: string }[];
  };
  logo: LogoInfo;
  colors: Palette | null;
  typography: Typography | null;
  components: { primaryButton: ButtonStyle | null; secondaryButton: ButtonStyle | null; radii: string[] } | null;
  voice: Voice;
  messaging: Messaging;
  brandRules: BrandRules & { statedColorMatches: { hex: string; nearest: string | null; deltaE: number | null }[] };
  imagery: { hero: string | null; display: string | null };
  sources: {
    pages: { url: string; kind: PageKind; via: PagePick["via"] | "input" | "browser fallback"; title: string | null; chars: number }[];
    failed: { url: string; error: string }[];
    searches: { query: string; results: number }[];
    tinyfish: CallRecord[];
    browser: { elementsScanned: number; scannedHeight: number; viewport: { width: number; height: number } } | null;
  };
  warnings: string[];
}

export interface GuideAssets {
  officialLogo: { bytes: Uint8Array; ext: ImageExt } | null;
  logoSvg: string | null;
  logoPng: Uint8Array | null;
  heroJpeg: Uint8Array | null;
  displayPng: Uint8Array | null;
}

export type ProgressStep = "resolve" | "render" | "fetch" | "search" | "analyse" | "write";
export interface ProgressEvent {
  step: ProgressStep;
  status: "start" | "done" | "error";
  message: string;
}

const FETCH_PURPOSE = "Build a brand guide: extract tagline, positioning, value propositions, proof points, mission, values, tone of voice and official brand rules";

const GUIDELINES_PATH = /\/(brand|brand-guidelines|brand-assets|brandkit|brand-kit|brand-center|logos?|media-kit|mediakit|media-assets|press-kit|presskit|newsroom\/(information|assets|media-kit|press-kit))(\/|$)/i;

export function brandGuidelinesPage(links: string[], hits: SearchHit[], domain: string): string | null {
  const urls = [...hits.map((h) => h.url), ...links].map((u) => cleanUrl(u)).filter((u): u is string => !!u && sameSite(u, domain));
  return urls.find((u) => GUIDELINES_PATH.test(new URL(u).pathname)) ?? null;
}

// Download the officially declared logo (small images only) so the guide is self-contained.
async function downloadLogo(url: string): Promise<GuideAssets["officialLogo"]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 BrandGuideGenerator" } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length <= 500_000 ? toImage(bytes, res.headers.get("content-type") ?? "") : null;
  } catch {
    return null;
  }
}

function toImage(bytes: Uint8Array, contentType: string): GuideAssets["officialLogo"] {
  const ext = imageExt(bytes, contentType);
  if (!ext) return null;
  if (ext === "svg") return { bytes: new TextEncoder().encode(sanitizeSvg(new TextDecoder().decode(bytes))), ext };
  return { bytes, ext };
}

// Strip anything executable from a third-party SVG before we store or serve it.
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, "$1#");
}

function toButton(b: ButtonSample): ButtonStyle {
  return {
    label: b.text,
    background: b.bg?.toUpperCase() ?? null,
    color: b.color.toUpperCase(),
    borderColor: b.borderColor?.toUpperCase() ?? null,
    borderWidth: b.borderWidth,
    radius: b.radius,
    paddingX: b.paddingX,
    paddingY: b.paddingY,
    height: b.height,
    fontFamily: b.fontFamily,
    fontSize: b.fontSize,
    fontWeight: b.fontWeight,
    textTransform: b.textTransform === "none" ? null : b.textTransform,
    letterSpacing: b.letterSpacing === "normal" ? null : b.letterSpacing,
  };
}

const CTA_TEXT = /^(get|start|try|sign|book|request|contact|join|shop|buy|explore|learn|see|watch|download|talk|create|build|open|schedule|subscribe|apply|view|i already|log ?in|continue)\b/i;

function buildComponents(v: VisualCapture, palette: Palette | null): BrandGuide["components"] {
  const vh = v.page.viewport.height;
  const usable = v.page.buttons.filter((b) => !b.fixed && !CONSENT_TEXT.test(b.text));
  const hero = usable.filter((b) => b.y < vh * 1.2);
  const page = v.page.pageBg;
  const primary =
    (palette && hero.find((b) => b.kind === "filled" && b.bg && deltaE(b.bg, palette.primary.hex) < 5)) ??
    hero.find((b) => b.kind === "filled" && b.bg && deltaE(b.bg, page) > 8) ??
    usable.find((b) => b.kind === "filled" && b.bg && deltaE(b.bg, page) > 8);
  // Secondary CTA: sits next to the primary or reads like a call to action (not a tag/chip in a product shot).
  const ctaLike = (b: ButtonSample) => (primary && Math.abs(b.y - primary.y) < 150) || CTA_TEXT.test(b.text);
  const secondary =
    hero.find((b) => b.kind === "outline" && ctaLike(b)) ??
    hero.find((b) => b.kind === "filled" && b !== primary && ctaLike(b) && b.bg && primary?.bg && deltaE(b.bg, primary.bg) > 8) ??
    usable.find((b) => b.kind === "outline" && CTA_TEXT.test(b.text));
  const radii = [...new Set(usable.map((b) => b.radius).filter((r) => r && r !== "0px"))].slice(0, 5);
  return { primaryButton: primary ? toButton(primary) : null, secondaryButton: secondary ? toButton(secondary) : null, radii };
}

function pickIcon(v: VisualCapture | null, rel: RegExp): string | null {
  const icons = v?.page.meta.icons.filter((i) => rel.test(i.rel)) ?? [];
  const size = (s: string | null) => Number(s?.split("x")[0]) || 0;
  return icons.sort((a, b) => size(b.sizes) - size(a.sizes))[0]?.href ?? null;
}

export async function generateGuide(
  input: string,
  onProgress: (e: ProgressEvent) => void = () => {},
): Promise<{ guide: BrandGuide; assets: GuideAssets }> {
  const tf = new TinyFishClient();
  const warnings: string[] = [];
  const searches: BrandGuide["sources"]["searches"] = [];
  const emit = (step: ProgressStep, status: ProgressEvent["status"], message: string) => onProgress({ step, status, message });

  emit("resolve", "start", `Resolving “${input}”`);
  const site = await resolveInput(tf, input);
  if (site.via === "search") searches.push({ query: `${input} official website`, results: site.candidates.length });
  emit("resolve", "done", site.via === "search" ? `Found ${site.url} with TinyFish Search` : `Using ${site.url}`);

  emit("fetch", "start", "Reading the homepage with TinyFish Fetch");
  emit("search", "start", "Searching the site for brand, press and about pages");
  const search = (q: string, purpose: string) =>
    tf
      .search(q, purpose, { includeDomains: [site.domain] })
      .then((r) => {
        searches.push({ query: q, results: r.length });
        return r;
      })
      .catch((): SearchHit[] => []);
  const homeP = tf.fetch([site.url], FETCH_PURPOSE).catch((err): { pages: FetchedPage[]; failed: { url: string; error: string }[] } => ({
    pages: [],
    failed: [{ url: site.url, error: err instanceof Error ? err.message : String(err) }],
  }));
  const identityP: Promise<DeclaredIdentity | null> = tf
    .fetchHead(site.url, "Read the brand's declared identity: Open Graph tags and schema.org Organization data (official logo, name, social profiles)")
    .then((html) => (html ? parseHead(html, site.url) : null))
    .catch(() => null);
  const brandHitsP = search(`${site.nameHint} brand guidelines logo press kit`, "Find the official brand guidelines, logo downloads and press kit");
  const aboutHitsP = search(`${site.nameHint} about mission values`, "Find the company's about, mission and values pages");

  // The browser renders the homepage first; by then Search/Fetch have usually found the official
  // brand-guidelines page, which the same session visits to read its visual colour swatches.
  const brandPageUrl = Promise.all([homeP, brandHitsP]).then(([home, hits]) => brandGuidelinesPage(home.pages[0]?.links ?? [], hits, site.domain));
  emit("render", "start", "Rendering the live site in a TinyFish remote browser");
  const officialLogoUrl = identityP.then((id) => id?.organization?.logo ?? null);
  const visualP: Promise<VisualCapture | null> = captureVisual(tf, site.url, site.nameHint, { brandPageUrl, officialLogoUrl })
    .then((v) => {
      if (v.blocked) warnings.push("The site showed a bot-check page to the browser; visual tokens may be incomplete.");
      emit("render", "done", `Measured ${v.page.elementsScanned} rendered elements, ${v.page.colors.length} colours, ${v.page.families.length} font families${v.brandPage ? `; read ${v.brandPage.swatches.length} swatches on the brand page` : ""}`);
      return v;
    })
    .catch((err) => {
      warnings.push(`Browser render failed (${err instanceof Error ? err.message : err}); colours, fonts and logo are unavailable.`);
      emit("render", "error", `Browser render failed (${err instanceof Error ? err.message.split("\n")[0] : err}) — continuing with content only`);
      return null;
    });

  const [home, brandHits, aboutHits, identity] = await Promise.all([homeP, brandHitsP, aboutHitsP, identityP]);
  emit("search", "done", `${brandHits.length + aboutHits.length} on-site results for brand and about pages`);

  let homePage: FetchedPage | undefined = home.pages[0];
  let homeVia: "input" | "browser fallback" = "input";
  let subPages: FetchedPage[] = [];
  let picks: PagePick[] = [];
  const failed = [...home.failed];
  // JS-heavy sites: Fetch returns little or no text, so read the copy from the DOM the Browser rendered.
  if (!homePage || homePage.text.trim().length < 1200) {
    emit("fetch", "start", "Fetch found little server-rendered text; checking the rendered page for more copy");
    const v = await visualP;
    if (v?.dom && v.dom.markdown.length > 2 * (homePage?.text.length ?? 0)) {
      homePage = {
        url: site.url,
        finalUrl: v.page.url,
        title: homePage?.title ?? v.page.title,
        description: homePage?.description ?? v.page.meta.description,
        language: homePage?.language ?? null,
        text: v.dom.markdown,
        links: [...new Set([...(homePage?.links ?? []), ...v.dom.links])],
        imageLinks: homePage?.imageLinks ?? [],
      };
      homeVia = "browser fallback";
      warnings.push(`Fetch returned ${homePage?.text.length ? "very little" : "no"} text for the homepage (a JavaScript-rendered site), so its copy was read from the Browser-rendered page.`);
    }
  }
  if (homePage) {
    emit("fetch", "done", `Homepage read: ${homePage.text.length.toLocaleString()} characters, ${homePage.links.length} links`);
    picks = pickSubpages(homePage.finalUrl, homePage.links, { brand: brandHits, about: aboutHits }, config.maxSubpages, site.nameHint);
    if (picks.length) {
      emit("fetch", "start", `Reading ${picks.length} more pages with Fetch: ${[...new Set(picks.map((p) => p.kind))].join(", ")}`);
      const sub = await tf.fetch(picks.map((p) => p.url), FETCH_PURPOSE).catch((err) => {
        warnings.push(`Fetch of subpages failed: ${err instanceof Error ? err.message : err}`);
        return { pages: [] as FetchedPage[], failed: [] as { url: string; error: string }[] };
      });
      subPages = sub.pages;
      failed.push(...sub.failed);
      emit("fetch", "done", `Read ${sub.pages.length}/${picks.length} pages${sub.failed.length ? ` (${sub.failed.length} failed)` : ""}`);
    }
  } else {
    warnings.push(`TinyFish Fetch couldn't read the homepage (${home.failed[0]?.error ?? "unknown error"}); messaging is limited.`);
    emit("fetch", "error", "Homepage fetch failed");
  }

  const visual = await visualP;
  if ((!homePage || homePage.text.trim().length < 50) && !visual) throw new Error(`Couldn't read ${site.url} with Fetch or the Browser API.`);

  emit("analyse", "start", "Deriving palette, typography, voice and messaging");
  const pickFor = (p: FetchedPage) => picks.find((x) => x.url === p.url || x.url === p.finalUrl);
  const docs = [
    ...(homePage ? [toDoc(homePage, "home")] : []),
    ...subPages.map((p) => toDoc(p, pickFor(p)?.kind ?? kindOf(p.finalUrl) ?? "about")),
  ];
  const cleaned = stripChrome(docs);
  const name = brandName(site.domain, site.nameHint, identity?.siteName ?? identity?.organization?.name ?? visual?.page.meta.siteName ?? null, [homePage?.title ?? null, identity?.title ?? null, visual?.page.title ?? null], site.via === "search");

  const ctaTexts = visual?.page.buttons.filter((b) => !b.fixed).map((b) => b.text) ?? [];
  const messaging = extractMessaging(cleaned.length ? cleaned : [{ url: site.url, kind: "home", title: visual?.page.title ?? null, description: visual?.page.meta.description ?? null, blocks: [], links: [], imageLinks: [], linkTexts: [] }], name, ctaTexts);
  const declaredDescription = identity?.description ?? identity?.organization?.description ?? visual?.page.meta.description;
  if (!messaging.positioning && declaredDescription) messaging.positioning = { text: declaredDescription, source: site.url };
  if (identity?.organization?.slogan && !messaging.slogans.some((s) => s.text.toLowerCase() === identity.organization!.slogan!.toLowerCase())) {
    messaging.slogans.unshift({ text: identity.organization.slogan, source: site.url });
  }
  const rules = extractBrandRules(cleaned, name);
  // Voice comes from marketing pages; brand/press pages are legal or press-release register.
  const voiceDocs = cleaned.filter((d) => d.kind !== "brand");
  const voice = analyseVoice(
    copySentences(voiceDocs.length ? voiceDocs : cleaned).map((s) => s.text),
    headlines(voiceDocs.length ? voiceDocs : cleaned).map((h) => h.text),
  );
  if (voice.metrics.sentences < 8) warnings.push(`Only ${voice.metrics.sentences} copy sentences were found, so tone-of-voice scores are low-confidence.`);

  const palette = visual ? buildPalette(visual.page, visual.page.logo?.colors ?? []) : null;
  const typography = visual ? await buildTypography(visual.page, visual.renderedFonts) : null;
  const components = visual ? buildComponents(visual, palette) : null;

  for (const s of visual?.brandPage?.swatches ?? []) {
    if (rules.statedColors.some((c) => deltaE(c.hex, s.hex) < 2)) continue;
    rules.statedColors.push({ hex: s.hex.toUpperCase(), label: s.label, source: visual!.brandPage!.url });
  }
  const allPaletteHexes = palette ? [palette.primary, palette.secondary, ...palette.accents, ...palette.neutrals].filter(Boolean).map((c) => c!.hex) : [];
  const statedColorMatches = rules.statedColors.map((c) => {
    const nearest = allPaletteHexes.map((h) => ({ h, d: deltaE(h, c.hex) })).sort((a, b) => a.d - b.d)[0];
    return { hex: c.hex, nearest: nearest?.h ?? null, deltaE: nearest ? Math.round(nearest.d * 10) / 10 : null };
  });

  const vLogo = visual?.page.logo ?? null;
  const logoSvg = vLogo?.svg ? sanitizeSvg(vLogo.svg) : null;
  const fallbackLogo = rules.logoFiles.find((u) => /\.svg(\?|$)/i.test(u)) ?? rules.logoFiles[0] ?? null;
  const declaredLogo = identity?.organization?.logo ?? null;
  const viaBrowser = visual?.officialLogo ? toImage(visual.officialLogo.bytes, visual.officialLogo.contentType) : null;
  const officialLogo = viaBrowser ?? (declaredLogo ? await downloadLogo(declaredLogo) : null);
  if (!vLogo && !fallbackLogo && !declaredLogo) warnings.push("No logo was detected in the page header or declared in the site's metadata.");
  const logo: LogoInfo = {
    official: declaredLogo ? { url: declaredLogo, file: officialLogo ? `logo-official.${officialLogo.ext}` : null, source: `schema.org ${identity?.organization?.type ?? "Organization"} logo declared in the page head (read with TinyFish Fetch)` } : null,
    primarySource: declaredLogo ? "schema.org (Fetch)" : fallbackLogo && !vLogo ? "brand page (Fetch)" : vLogo ? "site header (Browser)" : null,
    kind: vLogo ? vLogo.kind : fallbackLogo ? "remote" : null,
    svgFile: logoSvg ? "logo.svg" : null,
    pngFile: visual?.logoPng ? "logo.png" : null,
    sourceUrl: vLogo ? vLogo.src : fallbackLogo,
    alt: vLogo?.alt ?? null,
    width: vLogo?.width ?? null,
    height: vLogo?.height ?? null,
    colors: (vLogo?.colors ?? []).map((c) => c.toUpperCase()),
    favicon: pickIcon(visual, /(^|\s)icon/i),
    appleTouchIcon: pickIcon(visual, /apple-touch-icon/i),
    ogImage: identity?.ogImage ?? visual?.page.meta.ogImage ?? null,
    officialFiles: rules.logoFiles,
  };
  emit("analyse", "done", `${palette ? `${1 + (palette.secondary ? 1 : 0) + palette.accents.length} brand colours, ` : ""}${typography?.families.length ?? 0} typefaces, ${voice.traits.length} voice traits`);

  const guide: BrandGuide = {
    schema: "brand-guide/v1",
    generatedAt: new Date().toISOString(),
    input,
    company: {
      name,
      domain: site.domain,
      url: homePage?.finalUrl ?? site.url,
      description: messaging.positioning?.text ?? null,
      twitter: visual?.page.meta.twitter ?? null,
      social: identity?.organization?.sameAs ?? [],
      declared: identity,
      resolvedVia: site.via,
      searchCandidates: site.candidates,
    },
    logo,
    colors: palette,
    typography,
    components,
    voice,
    messaging,
    brandRules: { ...rules, statedColorMatches },
    imagery: { hero: visual?.heroJpeg ? "hero.jpg" : null, display: visual?.displayPng ? "display.png" : null },
    sources: {
      pages: [
        ...(homePage ? [{ url: homePage.finalUrl, kind: "home" as PageKind, via: homeVia, title: homePage.title, chars: homePage.text.length }] : []),
        ...subPages.map((p) => ({ url: p.finalUrl, kind: pickFor(p)?.kind ?? ("about" as PageKind), via: pickFor(p)?.via ?? ("homepage link" as const), title: p.title, chars: p.text.length })),
      ],
      failed,
      searches,
      tinyfish: tf.calls,
      browser: visual ? { elementsScanned: visual.page.elementsScanned, scannedHeight: visual.page.scannedHeight, viewport: visual.page.viewport } : null,
    },
    warnings,
  };
  return {
    guide,
    assets: { officialLogo, logoSvg, logoPng: visual?.logoPng ?? null, heroJpeg: visual?.heroJpeg ?? null, displayPng: visual?.displayPng ?? null },
  };
}
