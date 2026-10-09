// Brand identity declared in the page <head>, read with TinyFish Fetch (format "html" +
// include_html_head): Open Graph tags and schema.org JSON-LD (Organization/Corporation),
// which is where many sites publish their official logo, name and social profiles.

export interface DeclaredIdentity {
  siteName: string | null;
  title: string | null;
  description: string | null;
  ogImage: string | null;
  canonical: string | null;
  organization: {
    type: string;
    name: string | null;
    logo: string | null;
    slogan: string | null;
    description: string | null;
    foundingDate: string | null;
    sameAs: string[];
  } | null;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decode(m[2] ?? m[3] ?? "") : null;
}

function absolute(u: string | null, base: string): string | null {
  if (!u) return null;
  try {
    const url = new URL(u, base);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const ORG_TYPES = /^(Organization|Corporation|Brand|LocalBusiness|OnlineBusiness|OnlineStore|Store|NGO|SoftwareApplication|WebSite)$/;

function nodesOf(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.flatMap(nodesOf);
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    return [o, ...(Array.isArray(o["@graph"]) ? (o["@graph"] as unknown[]).flatMap(nodesOf) : [])];
  }
  return [];
}

function typeOf(n: Record<string, unknown>): string {
  const t = n["@type"];
  return Array.isArray(t) ? String(t.find((x) => ORG_TYPES.test(String(x))) ?? t[0]) : String(t ?? "");
}

function logoUrl(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return typeof o.url === "string" ? o.url : typeof o.contentUrl === "string" ? o.contentUrl : null;
  }
  return null;
}

export function parseHead(html: string, pageUrl: string): DeclaredIdentity {
  const end = html.indexOf("</head>");
  const head = end >= 0 ? html.slice(0, end) : html.slice(0, 20_000);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (key: string) => {
    const tag = metas.find((t) => (attr(t, "property") ?? attr(t, "name"))?.toLowerCase() === key);
    return tag ? attr(tag, "content")?.trim() || null : null;
  };
  const canonicalTag = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => attr(t, "rel")?.toLowerCase() === "canonical");

  let organization: DeclaredIdentity["organization"] = null;
  for (const m of head.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let json: unknown;
    try {
      json = JSON.parse(decode(m[1]!.trim()));
    } catch {
      continue;
    }
    const orgs = nodesOf(json).filter((n) => ORG_TYPES.test(typeOf(n)) && typeOf(n) !== "WebSite");
    const n = orgs.find((o) => o.logo) ?? orgs[0];
    if (!n) continue;
    organization = {
      type: typeOf(n),
      name: typeof n.name === "string" ? n.name : null,
      logo: absolute(logoUrl(n.logo), pageUrl),
      slogan: typeof n.slogan === "string" ? n.slogan : null,
      description: typeof n.description === "string" ? n.description : null,
      foundingDate: typeof n.foundingDate === "string" ? n.foundingDate : null,
      sameAs: (Array.isArray(n.sameAs) ? n.sameAs : typeof n.sameAs === "string" ? [n.sameAs] : []).filter((u): u is string => typeof u === "string" && /^https?:/.test(u)),
    };
    if (organization.logo) break;
  }

  return {
    siteName: meta("og:site_name") ?? meta("application-name"),
    title: meta("og:title") ?? meta("twitter:title"),
    description: meta("og:description") ?? meta("description"),
    ogImage: absolute(meta("og:image") ?? meta("twitter:image"), pageUrl),
    canonical: canonicalTag ? absolute(attr(canonicalTag, "href"), pageUrl) : null,
    organization,
  };
}
