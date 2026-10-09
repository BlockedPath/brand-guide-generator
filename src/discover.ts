import type { SearchHit } from "./tinyfish.ts";

// URL helpers and subpage selection: which pages beyond the homepage say the most about the brand.

export type PageKind = "home" | "about" | "brand" | "product" | "pricing" | "customers" | "careers";

export interface PagePick {
  url: string;
  kind: PageKind;
  via: "homepage link" | "search";
}

// Search results sometimes arrive as Google redirect links; unwrap and drop tracking params.
export function cleanUrl(raw: string): string | null {
  let u = raw.trim();
  if (u.startsWith("/url?") || /google\.[a-z.]+\/url\?/.test(u)) {
    const q = new URLSearchParams(u.slice(u.indexOf("?") + 1)).get("q");
    if (!q) return null;
    u = q;
  }
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return null;
    for (const p of [...url.searchParams.keys()]) if (/^(srsltid|utm_|gclid|fbclid|ref$)/i.test(p)) url.searchParams.delete(p);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function siteDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
}

export function sameSite(url: string, domain: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return h === domain || h.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

const KINDS: [PageKind, RegExp][] = [
  ["brand", /\/(brand|brand-guidelines|brand-assets|brandkit|brand-kit|press|press-kit|presskit|media-kit|mediakit|media-assets|logos?|trademarks?|trademark-guidelines|newsroom\/(information|assets|media-kit|press-kit))(\/|$)/i],
  ["about", /\/(about|about-us|company|our-story|story|mission|values|core-values|our-values|who-we-are|company-history|purpose|manifesto)(\/|$)/i],
  ["product", /\/(product|products|features|platform|how-it-works|overview)(\/|$)/i],
  ["pricing", /\/(pricing|plans)(\/|$)/i],
  ["customers", /\/(customers|case-studies|customer-stories)\/?$/i],
  ["careers", /\/(careers|jobs)\/?$/i],
];

const LIMITS: Record<PageKind, number> = { home: 0, brand: 2, about: 2, product: 1, pricing: 1, customers: 1, careers: 1 };

export function kindOf(url: string): PageKind | null {
  try {
    const u = new URL(url);
    if (/^brand\./i.test(u.hostname) && u.pathname.replace(/\/+$/, "") === "") return "brand";
    for (const [kind, re] of KINDS) if (re.test(u.pathname)) return kind;
  } catch {
    // ignore malformed links
  }
  return null;
}

function depth(url: string): number {
  return new URL(url).pathname.split("/").filter(Boolean).length;
}

// Search results are ranked for our about/brand queries, so a matching title is enough even when
// the URL doesn't follow /about-style paths (e.g. a blog post "Our values: a letter from the CEO").
const TITLE_HINT: Partial<Record<PageKind, RegExp>> = {
  about: /\b(about|mission|values|our story|who we are|principles|manifesto|purpose|handbook|culture)\b/i,
  brand: /\b(brand (guidelines|guide|assets|center|centre|kit|book|resources|portal|policy|standards)|logo (usage|guidelines|downloads?|files)|logos|press ?kit|media ?(kit|assets)|trademark( guidelines| usage| policy)?|style ?guide)\b/i,
};

// A hinted title must be about the company itself ("Duolingo's values…", "Our mission"),
// not content marketing on the same domain ("How to write a mission statement | Stripe").
function aboutTheBrand(title: string, brand: string): boolean {
  const core = title.replace(/\s+[|–—-]\s+[^|–—-]+$/, "");
  const b = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (!!b && core.toLowerCase().replace(/[^a-z0-9]/g, "").includes(b)) || /\b(our|we)\b/i.test(core);
}

export function pickSubpages(homeUrl: string, links: string[], hits: Partial<Record<PageKind, SearchHit[]>>, max: number, brand = ""): PagePick[] {
  const domain = siteDomain(homeUrl);
  const home = new URL(homeUrl);
  const candidates = new Map<string, PagePick>();
  const consider = (raw: string, via: PagePick["via"], intended?: PageKind, title = "") => {
    const url = cleanUrl(raw);
    if (!url || !sameSite(url, domain)) return;
    const u = new URL(url);
    if (u.pathname === home.pathname && u.hostname === home.hostname) return;
    if (/\.(pdf|zip|png|jpe?g|svg|gif|webp|mp4)$/i.test(u.pathname) || /static-files|news-release|\/investors?\b|^investors?\./i.test(u.hostname + u.pathname)) return;
    const hintOk = intended && TITLE_HINT[intended]?.test(`${title} ${u.pathname}`) && !/^(how|what|why|when)\b/i.test(title.trim());
    const hinted = hintOk && (intended !== "about" || aboutTheBrand(title, brand)) ? intended : null;
    const kind = kindOf(url) ?? hinted;
    if (!kind) return;
    if (depth(url) > (kind === "brand" || kind === "about" ? 3 : 2)) return;
    const key = `${u.hostname}${u.pathname.replace(/\/+$/, "")}`;
    if (!candidates.has(key)) candidates.set(key, { url, kind, via });
  };
  for (const [kind, list] of Object.entries(hits) as [PageKind, SearchHit[]][]) for (const h of list.slice(0, 6)) consider(h.url, "search", kind, h.title);
  for (const l of links) consider(l, "homepage link");

  const byKind = new Map<PageKind, PagePick[]>();
  for (const c of candidates.values()) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const picks: PagePick[] = [];
  for (const kind of ["brand", "about", "product", "pricing", "customers", "careers"] as PageKind[]) {
    const list = (byKind.get(kind) ?? []).sort(
      (a, b) => Number(b.via === "search") - Number(a.via === "search") || depth(a.url) - depth(b.url) || a.url.length - b.url.length,
    );
    picks.push(...list.slice(0, LIMITS[kind]));
  }
  return picks.slice(0, max);
}
