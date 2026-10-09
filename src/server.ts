import { join } from "node:path";
import { config } from "./config.ts";
import { generateGuide, type BrandGuide, type ProgressEvent } from "./guide.ts";
import { looksLikeUrl, normaliseUrl } from "./resolve.ts";
import { siteDomain } from "./discover.ts";
import { GUIDE_FILES, guideDir, isFresh, listGuides, readGuide, slugFor, writeGuide } from "./store.ts";
import index from "./ui/index.html";

// HTTP API + web UI.
//   GET /api/guide?q=<url|company>[&refresh=1]   → brand guide JSON
//   GET /api/guide/stream?q=<url|company>        → Server-Sent Events: progress…, then done/error
//   GET /api/guides                              → previously generated guides
//   GET /g/<domain>/[file]                       → the HTML guide and its exports

const MAX_CONCURRENT = 2;
let running = 0;
const queue: (() => void)[] = [];
const inflight = new Map<string, Promise<BrandGuide>>();
const listeners = new Map<string, Set<(e: ProgressEvent) => void>>();

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

function keyFor(q: string): string {
  return looksLikeUrl(q) ? slugFor(siteDomain(normaliseUrl(q))) : `name:${q.trim().toLowerCase()}`;
}

async function cached(q: string): Promise<BrandGuide | null> {
  if (!looksLikeUrl(q)) return null;
  const g = await readGuide(slugFor(siteDomain(normaliseUrl(q))));
  return g && isFresh(g) ? g : null;
}

function run(q: string, onProgress?: (e: ProgressEvent) => void): Promise<BrandGuide> {
  const key = keyFor(q);
  if (onProgress) listeners.set(key, (listeners.get(key) ?? new Set()).add(onProgress));
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = slot(async () => {
    const { guide, assets } = await generateGuide(q, (e) => listeners.get(key)?.forEach((l) => l(e)));
    listeners.get(key)?.forEach((l) => l({ step: "write", status: "start", message: "Writing guide, tokens and exports" }));
    await writeGuide(guide, assets);
    listeners.get(key)?.forEach((l) => l({ step: "write", status: "done", message: "Guide, tokens and exports written" }));
    return guide;
  }).finally(() => {
    inflight.delete(key);
    listeners.delete(key);
  });
  inflight.set(key, p);
  return p;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Access-Control-Allow-Origin": "*" } });
}

function links(g: BrandGuide) {
  const base = `/g/${slugFor(g.company.domain)}/`;
  return { html: base, json: `${base}brand.json`, tokens: `${base}tokens.json`, css: `${base}tokens.css`, tailwind: `${base}tailwind.preset.js`, markdown: `${base}brand.md` };
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const server = Bun.serve({
  port: config.port,
  idleTimeout: 255, // a full guide takes ~30–60s
  routes: {
    "/": index,
    "/api/guides": async () => json(await listGuides()),
    "/api/guide": async (req) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q")?.trim();
      if (!q) return json({ error: "Pass ?q=<website URL or company name>" }, 400);
      try {
        const fresh = url.searchParams.get("refresh") ? null : await cached(q);
        const guide = fresh ?? (await run(q));
        return json({ ...guide, links: links(guide), cached: !!fresh });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 502);
      }
    },
    "/api/guide/stream": (req) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q")?.trim();
      if (!q) return json({ error: "Pass ?q=<website URL or company name>" }, 400);
      const refresh = !!url.searchParams.get("refresh");
      const enc = new TextEncoder();
      let closed = false;
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          const beat = setInterval(() => !closed && controller.enqueue(enc.encode(": keep-alive\n\n")), 10_000);
          try {
            const fresh = refresh ? null : await cached(q);
            if (fresh) send("progress", { step: "write", status: "done", message: "Loaded a guide generated in the last day (add refresh to regenerate)" });
            const guide = fresh ?? (await run(q, (e) => send("progress", e)));
            send("done", { name: guide.company.name, domain: guide.company.domain, links: links(guide), warnings: guide.warnings });
          } catch (err) {
            send("error", { message: err instanceof Error ? err.message : String(err) });
          } finally {
            clearInterval(beat);
            closed = true;
            controller.close();
          }
        },
        cancel() {
          closed = true;
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
    },
  },
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const m = pathname.match(/^\/g\/([a-z0-9.-]+)(\/([a-z0-9.-]*))?$/i);
    if (!m) return new Response("Not found", { status: 404 });
    const slug = m[1]!;
    if (m[2] === undefined) return Response.redirect(`/g/${slug}/`, 301);
    const file = m[3] || "brand.html";
    if (!(GUIDE_FILES as readonly string[]).includes(file)) return new Response("Not found", { status: 404 });
    const f = Bun.file(join(guideDir(slug), file));
    if (!(await f.exists())) return new Response("Not found", { status: 404 });
    const ext = file.split(".").pop()!;
    const headers: Record<string, string> = { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream" };
    // Logos come from third-party sites: never let a served SVG run script on this origin.
    if (ext === "svg") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    return new Response(f, { headers });
  },
  development: process.env.NODE_ENV !== "production" ? { hmr: false, console: true } : false,
});

console.log(`Brand Guide Generator on http://localhost:${server.port}`);
