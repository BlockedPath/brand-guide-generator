import { TinyFish, APIStatusError, RateLimitError, AuthenticationError, APITimeoutError } from "@tiny-fish/sdk";
import { requireKey } from "./config.ts";

// Thin wrapper over the three TinyFish endpoints this app uses (Search, Fetch, Browser).
// Every call is recorded so each guide can show exactly how TinyFish produced it.

export type Endpoint = "search" | "fetch" | "browser";

export interface CallRecord {
  endpoint: Endpoint;
  purpose: string;
  detail: string;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface SearchHit {
  position: number;
  title: string;
  url: string;
  snippet: string;
  site: string;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  language: string | null;
  text: string;
  links: string[];
  imageLinks: string[];
}

export interface FetchOutcome {
  pages: FetchedPage[];
  failed: { url: string; error: string }[];
}

export interface BrowserHandle {
  sessionId: string;
  cdpUrl: string;
}

export function describeError(err: unknown): string {
  if (err instanceof RateLimitError) return "TinyFish rate limit hit";
  if (err instanceof AuthenticationError) return "TinyFish rejected the API key";
  if (err instanceof APITimeoutError) return "TinyFish request timed out";
  if (err instanceof APIStatusError) return `TinyFish error ${err.statusCode}${err.code ? ` ${err.code}` : ""}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export class TinyFishClient {
  readonly calls: CallRecord[] = [];
  private client: TinyFish;
  private apiKey: string;

  constructor(apiKey = requireKey()) {
    this.apiKey = apiKey;
    this.client = new TinyFish({ apiKey, timeout: 150_000, maxRetries: 2 });
  }

  private async record<T>(endpoint: Endpoint, purpose: string, detail: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      const out = await fn();
      this.calls.push({ endpoint, purpose, detail, ms: Math.round(performance.now() - t0), ok: true });
      return out;
    } catch (err) {
      const error = describeError(err);
      this.calls.push({ endpoint, purpose, detail, ms: Math.round(performance.now() - t0), ok: false, error });
      throw new Error(error);
    }
  }

  async search(
    query: string,
    purpose: string,
    opts: { includeDomains?: string[]; excludeDomains?: string[] } = {},
  ): Promise<SearchHit[]> {
    return this.record("search", purpose, query, async () => {
      const res = await this.client.search.query({
        query,
        purpose,
        ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains.join(",") } : {}),
        ...(opts.excludeDomains?.length ? { exclude_domains: opts.excludeDomains.join(",") } : {}),
      });
      return res.results.map((r) => ({
        position: r.position,
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        site: r.site_name,
      }));
    });
  }

  async fetch(urls: string[], purpose: string, opts: { links?: boolean; images?: boolean } = {}): Promise<FetchOutcome> {
    if (urls.length === 0) return { pages: [], failed: [] };
    const detail = urls.length === 1 ? urls[0]! : `${urls.length} URLs`;
    return this.record("fetch", purpose, detail, async () => {
      const res = await this.client.fetch.getContents({
        urls: urls.slice(0, 10),
        purpose,
        format: "markdown",
        links: opts.links ?? true,
        image_links: opts.images ?? true,
        per_url_timeout_ms: 60_000,
      });
      return {
        pages: res.results.map((r) => ({
          url: r.url,
          finalUrl: r.final_url ?? r.url,
          title: r.title ?? null,
          description: r.description ?? null,
          language: r.language ?? null,
          text: typeof r.text === "string" ? r.text : "",
          links: r.links ?? [],
          imageLinks: r.image_links ?? [],
        })),
        failed: res.errors.map((e) => ({ url: e.url, error: e.error })),
      };
    });
  }

  // Session creation can hit concurrency limits or transient 409/503s: retry with backoff.
  // Head-only read: Open Graph + JSON-LD identity (official logo, name, social profiles).
  async fetchHead(url: string, purpose: string): Promise<string | null> {
    return this.record("fetch", purpose, `${url} (head metadata)`, async () => {
      const res = await this.client.fetch.getContents({ urls: [url], purpose, format: "html", include_html_head: true, links: false, image_links: false, per_url_timeout_ms: 60_000 });
      const text = res.results[0]?.text;
      return typeof text === "string" ? text : null;
    });
  }

  async openBrowser(purpose: string, country: string, proxy = true): Promise<BrowserHandle> {
    return this.record("browser", purpose, "create session", async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const s = await this.client.browser.sessions.create({
            timeout_seconds: 180,
            proxy_config: proxy ? { country_code: country } : { enabled: false },
          });
          return { sessionId: s.session_id, cdpUrl: s.cdp_url };
        } catch (err) {
          const retryable = err instanceof RateLimitError || err instanceof APITimeoutError || (err instanceof APIStatusError && [409, 429, 503, 504].includes(err.statusCode));
          if (!retryable || attempt >= 4) throw err;
          await Bun.sleep(2500 * attempt);
        }
      }
    });
  }

  // The SDK has no delete helper yet; sessions also expire on inactivity, so this is best-effort.
  async closeBrowser(sessionId: string): Promise<void> {
    await fetch(`https://api.browser.tinyfish.ai/${sessionId}`, {
      method: "DELETE",
      headers: { "X-API-Key": this.apiKey },
    }).catch(() => {});
  }

  noteBrowserWork(detail: string, ms: number, ok = true, error?: string) {
    this.calls.push({ endpoint: "browser", purpose: "Render the live site and measure computed styles", detail, ms, ok, ...(error ? { error } : {}) });
  }
}
