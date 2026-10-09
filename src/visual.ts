import dns from "node:dns";
import { chromium, type Browser, type Page } from "playwright-core";
import { config } from "./config.ts";
import type { TinyFishClient } from "./tinyfish.ts";
import { collectDomContent, collectPageVisual, collectSwatches, hideConsentOverlays, warmLazyContent, type DomContent, type PageVisual, type Swatch } from "./visual-page.ts";

// Browser API stage: render the live homepage in a TinyFish remote browser, then measure what
// actually paints — computed colours, rendered fonts, buttons and the logo — and screenshot it.

export interface RenderedFont {
  role: string;
  families: { familyName: string; postScriptName?: string; isCustomFont: boolean; glyphCount: number }[];
}

export interface VisualCapture {
  page: PageVisual;
  renderedFonts: RenderedFont[];
  heroJpeg: Uint8Array | null;
  logoPng: Uint8Array | null;
  displayPng: Uint8Array | null;
  blocked: boolean;
  brandPage: { url: string; swatches: Swatch[] } | null;
  dom: DomContent | null;
  officialLogo: { bytes: Uint8Array; contentType: string } | null;
}

export type ImageExt = "svg" | "png" | "jpg" | "webp";

// Sniff real image bytes (CDNs sometimes answer with an HTML bot-check page instead).
export function imageExt(bytes: Uint8Array, contentType = ""): ImageExt | null {
  const head = new TextDecoder().decode(bytes.slice(0, 2048)).trimStart().toLowerCase();
  if ((head.startsWith("<svg") || head.startsWith("<?xml") || /svg/.test(contentType)) && head.includes("<svg") && !head.includes("<html")) return "svg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (head.startsWith("riff") && head.slice(8, 12) === "webp") return "webp";
  return null;
}

const VIEWPORT = { width: 1440, height: 900 };
const BLOCK_TITLES = /just a moment|attention required|access denied|are you a robot|verify you are human|403 forbidden/i;

async function screenshotLocator(page: Page, selector: string, type: "png" | "jpeg"): Promise<Uint8Array | null> {
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) return null;
  try {
    const box = await loc.boundingBox();
    if (!box || box.width < 2 || box.height < 2) return null;
    return await loc.screenshot({ type, timeout: 6000, ...(type === "png" ? { omitBackground: true } : { quality: 80 }), animations: "disabled" });
  } catch {
    return null;
  }
}

// Ask Chrome which platform font actually drew each sampled node (not just the CSS stack).
async function renderedFonts(page: Page, roles: string[]): Promise<RenderedFont[]> {
  const out: RenderedFont[] = [];
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    for (const role of roles) {
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-bgg-font="${role}"]` });
      if (!nodeId) continue;
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      out.push({ role, families: fonts.sort((a, b) => b.glyphCount - a.glyphCount) });
    }
    await cdp.detach();
  } catch {
    // CDP font introspection is a bonus; computed stacks are still available
  }
  return out;
}

// brandPageUrl resolves (from Search, in parallel) to the official brand-guidelines page, if any:
// the same browser session then reads colour swatches that only exist visually on that page.
// Playwright resolves the CDP host via dns.promises.lookup (the OS resolver). Some resolvers
// (e.g. VPN/MagicDNS setups) cache "not found" for a brand-new session hostname, so on ENOTFOUND
// retry with Bun's c-ares resolver, which queries DNS directly.
const systemLookup = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = (async (host: string, opts?: dns.LookupOptions) => {
  try {
    return await systemLookup(host, opts ?? {});
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOTFOUND" && !/ENOTFOUND/.test(String(err))) throw err;
    const found = (await Bun.dns.lookup(host, { backend: "c-ares", ...(opts?.family === 4 || opts?.family === 6 ? { family: opts.family } : {}) })).map((a) => ({ address: a.address, family: a.family }));
    if (!found.length) throw err;
    return opts?.all ? found : found[0]!;
  }
}) as typeof dns.promises.lookup;

// Each browser session gets a fresh hostname. Looking it up locally before its DNS record exists
// makes the OS cache a negative answer for minutes, so first wait until public DNS (DoH) has it.
async function waitForDns(host: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    try {
      const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`, { signal: AbortSignal.timeout(3000) });
      const body = (await res.json()) as { Status?: number; Answer?: unknown[] };
      if (body.Status === 0 && body.Answer?.length) return;
    } catch {
      return; // DoH unreachable: fall through to the normal connect + retry path
    }
    await Bun.sleep(750);
  }
}

export interface CaptureExtras {
  brandPageUrl?: Promise<string | null>; // official brand-guidelines page (from Search/Fetch)
  officialLogoUrl?: Promise<string | null>; // logo declared in schema.org data (from Fetch)
}

export async function captureVisual(tf: TinyFishClient, url: string, brandHint: string, extras: CaptureExtras = {}): Promise<VisualCapture> {
  try {
    return await captureOnce(tf, url, brandHint, extras, true);
  } catch (err) {
    // The residential proxy tunnel occasionally fails: retry once on a direct (unproxied) session.
    if (!/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_CONNECTION_(RESET|CLOSED|REFUSED)|ERR_TIMED_OUT|Timeout \d+ms exceeded/i.test(String(err))) throw err;
    return await captureOnce(tf, url, brandHint, extras, false);
  }
}

async function captureOnce(tf: TinyFishClient, url: string, brandHint: string, extras: CaptureExtras, proxy: boolean): Promise<VisualCapture> {
  const brandPageUrl = extras.brandPageUrl ?? Promise.resolve(null);
  const handle = await tf.openBrowser(proxy ? "Open a remote browser to render the live site" : "Retry the render on a direct (unproxied) browser session", config.browserCountry, proxy);
  const t0 = performance.now();
  let browser: Browser | null = null;
  try {
    await waitForDns(new URL(handle.cdpUrl).hostname);
    // Fresh session hosts can take a moment to resolve in DNS: retry the CDP connection briefly.
    for (let attempt = 1; ; attempt++) {
      try {
        browser = await chromium.connectOverCDP(handle.cdpUrl, { timeout: 45_000 });
        break;
      } catch (err) {
        if (attempt >= 5 || !/ENOTFOUND|ECONNREFUSED|ECONNRESET|1006|WebSocket error/i.test(String(err))) throw err;
        await Bun.sleep(1500 * attempt);
      }
    }
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize(VIEWPORT);
    // Heavy SPAs can stall before DOMContentLoaded through a residential proxy: fall back to
    // "commit" and give the app time to render rather than failing the whole capture.
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (err) {
      if (page.url() === "about:blank") await page.goto(url, { waitUntil: "commit", timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
    }
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const title = await page.title().catch(() => "");
    const blocked = BLOCK_TITLES.test(title);

    await page.evaluate(hideConsentOverlays).catch(() => 0);
    await page.evaluate(warmLazyContent, 4).catch(() => {});
    await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});

    const visual = await page.evaluate(collectPageVisual, brandHint);
    const fonts = await renderedFonts(page, visual.type.map((t) => t.role));
    const dom = await page.evaluate(collectDomContent).catch(() => null);

    const heroJpeg = await page.screenshot({ type: "jpeg", quality: 72, animations: "disabled" }).catch(() => null);
    const logoPng = visual.logo ? await screenshotLocator(page, "[data-bgg-logo]", "png") : null;
    const displayPng = await screenshotLocator(page, '[data-bgg-font="display"]', "png");

    tf.noteBrowserWork(`${visual.elementsScanned} elements scanned on ${new URL(visual.url).hostname}`, Math.round(performance.now() - t0));

    // Download the officially declared logo through the same browser (CDNs often bot-block plain requests).
    let officialLogo: VisualCapture["officialLogo"] = null;
    const logoUrl = await (extras.officialLogoUrl ?? Promise.resolve(null)).catch(() => null);
    if (logoUrl) {
      try {
        const res = await page.goto(logoUrl, { waitUntil: "load", timeout: 20_000 });
        const bytes = res ? new Uint8Array(await res.body()) : null;
        const contentType = res?.headers()["content-type"] ?? "";
        if (bytes && bytes.length <= 500_000 && imageExt(bytes, contentType)) officialLogo = { bytes, contentType };
      } catch {
        // fall back to a direct download in the caller
      }
    }

    let brandPage: VisualCapture["brandPage"] = null;
    const brandUrl = await brandPageUrl.catch(() => null);
    if (brandUrl) {
      const t1 = performance.now();
      try {
        await page.goto(brandUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
        await page.evaluate(hideConsentOverlays).catch(() => 0);
        await page.evaluate(warmLazyContent, 10).catch(() => {});
        const swatches = await page.evaluate(collectSwatches);
        brandPage = { url: page.url(), swatches };
        tf.noteBrowserWork(`${swatches.length} colour swatches read on ${new URL(brandUrl).pathname}`, Math.round(performance.now() - t1));
      } catch (err) {
        tf.noteBrowserWork(`brand page ${brandUrl} failed`, Math.round(performance.now() - t1), false, err instanceof Error ? err.message : String(err));
      }
    }
    return { page: visual, renderedFonts: fonts, heroJpeg, logoPng, displayPng, blocked, brandPage, dom, officialLogo };
  } catch (err) {
    tf.noteBrowserWork("render failed", Math.round(performance.now() - t0), false, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    await browser?.close().catch(() => {});
    await tf.closeBrowser(handle.sessionId);
  }
}
