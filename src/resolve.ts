import { cleanUrl, siteDomain } from "./discover.ts";
import type { SearchHit, TinyFishClient } from "./tinyfish.ts";

// Input → official homepage. URLs/domains are used directly; company names go through TinyFish Search.

export interface ResolvedSite {
  input: string;
  url: string;
  domain: string;
  nameHint: string;
  via: "url" | "search";
  candidates: { url: string; title: string }[];
}

const NOT_OFFICIAL =
  /(^|\.)(wikipedia\.org|wikidata\.org|linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|crunchbase\.com|bloomberg\.com|reuters\.com|forbes\.com|glassdoor\.com|indeed\.com|reddit\.com|medium\.com|quora\.com|g2\.com|capterra\.com|trustpilot\.com|yelp\.com|amazon\.[a-z.]+|apps\.apple\.com|play\.google\.com|github\.com|pitchbook\.com|zoominfo\.com|brandfetch\.com|logo\.dev|wikiwand\.com|britannica\.com|cbinsights\.com|tracxn\.com|craft\.co|similarweb\.com|google\.com|bing\.com|pinterest\.com|behance\.net|dribbble\.com|nytimes\.com|cnbc\.com|techcrunch\.com|theverge\.com)$/i;

export function looksLikeUrl(input: string): boolean {
  return !/\s/.test(input.trim()) && /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(input.trim());
}

export function normaliseUrl(input: string): string {
  const withScheme = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const u = new URL(withScheme);
  return `${u.protocol}//${u.host}${u.pathname === "/" ? "/" : u.pathname}`;
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

export function scoreCandidate(name: string, hit: SearchHit): number {
  const url = cleanUrl(hit.url);
  if (!url) return -Infinity;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  if (NOT_OFFICIAL.test(host)) return -Infinity;
  const label = slug(host.split(".").slice(0, -1).join(""));
  const n = slug(name);
  let score = 10 - hit.position;
  if (label === n) score += 12;
  else if (label.startsWith(n) || n.startsWith(label)) score += 7;
  else if (label.includes(n) || n.includes(label)) score += 4;
  if (slug(hit.title).includes(n)) score += 2;
  if (/official/i.test(hit.title + hit.snippet)) score += 1;
  const segs = u.pathname.split("/").filter(Boolean).length;
  score -= segs * 1.5;
  return score;
}

export function domainLabel(domain: string): string {
  const parts = domain.split(".");
  const label = parts.length > 2 && parts.at(-2)!.length <= 3 ? parts.at(-3)! : parts.at(-2) ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export async function resolveInput(tf: TinyFishClient, input: string): Promise<ResolvedSite> {
  const raw = input.trim();
  if (!raw) throw new Error("Give a company name or website URL.");
  if (looksLikeUrl(raw)) {
    const url = normaliseUrl(raw);
    const domain = siteDomain(url);
    return { input: raw, url, domain, nameHint: domainLabel(domain), via: "url", candidates: [] };
  }
  const hits = await tf.search(`${raw} official website`, `Find the official homepage of the company or brand "${raw}"`);
  const ranked = hits
    .map((h) => ({ h, score: scoreCandidate(raw, h) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) throw new Error(`Couldn't find an official website for "${raw}". Try passing its URL instead.`);
  const u = new URL(cleanUrl(best.h.url)!);
  const url = `${u.protocol}//${u.host}/`;
  return {
    input: raw,
    url,
    domain: siteDomain(url),
    nameHint: raw,
    via: "search",
    candidates: ranked.slice(0, 5).map((x) => ({ url: cleanUrl(x.h.url)!, title: x.h.title })),
  };
}

// Best display name: og:site_name, else the title segment that matches the domain, else the domain label.
export function brandName(domain: string, hint: string, siteName: string | null, titles: (string | null)[], viaSearch: boolean): string {
  if (viaSearch && hint) return hint.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const label = domainLabel(domain);
  if (siteName && siteName.length <= 40 && slug(siteName).includes(slug(label).slice(0, 4))) return siteName.trim();
  for (const t of titles) {
    if (!t) continue;
    for (const part of t.split(/\s+[|–—·-]\s+|:\s+/)) {
      const p = part.trim();
      if (p && p.split(/\s+/).length <= 3 && slug(p) === slug(label)) return p;
    }
  }
  return label;
}
