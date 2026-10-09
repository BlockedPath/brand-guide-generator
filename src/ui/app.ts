/// <reference lib="dom" />

interface Progress {
  step: string;
  status: "start" | "done" | "error";
  message: string;
}

interface Summary {
  slug: string;
  name: string;
  domain: string;
  generatedAt: string;
  primary: string | null;
  palette: string[];
  mode: "light" | "dark" | null;
  font: string | null;
  tagline: string | null;
  voice: string[];
  logo: string | null;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], "style">> & { style?: string };
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  const { style, ...rest } = props;
  Object.assign(el, rest);
  if (style) el.setAttribute("style", style);
  el.append(...kids);
  return el;
};

const form = $<HTMLFormElement>("form");
const input = $<HTMLInputElement>("q");
const go = $<HTMLButtonElement>("go");
const refresh = $<HTMLInputElement>("refresh");
const run = $("run");
const runTitle = $("run-title");
const runStatus = $("run-status");
const timerEl = $("timer");
const meter = $("meter");
const result = $("result");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Theming: the page accent glides to the generated brand's colours ─────────────
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
const vivid = (hex: string) => {
  const l = luminance(hex);
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return l > 0.03 && l < 0.8 && Math.max(r, g, b) - Math.min(r, g, b) > 40;
};
function theme(palette: string[]) {
  const usable = palette.filter(vivid);
  if (!usable.length) return;
  document.documentElement.style.setProperty("--accent", usable[0]!);
  document.documentElement.style.setProperty("--accent-2", usable[1] ?? usable[0]!);
}

// ── Scroll reveal & card tilt ────────────────────────────────────────────────────
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }
  },
  { threshold: 0.12 },
);
const observe = (root: ParentNode = document) => root.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));

function tilt(card: HTMLElement) {
  if (reduceMotion) return;
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty("--ry", `${x * 8}deg`);
    card.style.setProperty("--rx", `${-y * 8}deg`);
  });
  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--rx", "0deg");
  });
}

const logoBox = (s: Summary, cls: string) => {
  if (!s.logo) return null;
  const box = h("div", { className: `${cls}${s.mode === "dark" ? " dark" : ""}` });
  box.append(h("img", { src: s.logo, alt: `${s.name} logo`, loading: "lazy" }));
  return box;
};

// ── Gallery + marquee ────────────────────────────────────────────────────────────
async function loadGallery() {
  let items: Summary[] = [];
  try {
    items = await (await fetch("/api/guides")).json();
  } catch {
    return;
  }
  if (!items.length) return;

  const grid = $("gallery-grid");
  grid.replaceChildren(
    ...items.map((s, i) => {
      const card = h("a", { className: "card reveal", href: `/g/${s.slug}/`, target: "_blank", rel: "noopener", style: `--d:${i % 4};--glow:${s.primary ?? "transparent"}` });
      const strip = h("div", { className: "strip" }, ...s.palette.map((c) => h("i", { style: `background:${c}` })));
      const body = h(
        "div",
        { className: "body" },
        h("strong", { textContent: s.name }),
        h("p", { className: "tl", textContent: s.tagline ?? s.domain, style: "margin:0" }),
        h("div", { className: "meta" }, h("span", { textContent: s.font ?? "—" }), h("span", { textContent: s.domain })),
      );
      card.append(strip, ...[logoBox(s, "logo")].filter((x): x is HTMLDivElement => !!x), body);
      tilt(card);
      return card;
    }),
  );
  observe(grid);

  // Repeat items so the marquee loop is always wider than the screen, then duplicate for a seamless loop.
  const track = $("marquee");
  const base: Summary[] = [];
  while (base.length < 10) base.push(...items);
  const mini = (s: Summary) =>
    h(
      "a",
      { className: "mini", href: `/g/${s.slug}/`, target: "_blank", rel: "noopener" },
      h("span", { className: "stack" }, ...s.palette.slice(0, 4).map((c) => h("i", { style: `background:${c}` }))),
      h("span", { style: "display:grid" }, h("strong", { textContent: s.name }), h("span", { textContent: s.domain })),
    );
  track.replaceChildren(...[...base, ...base].map(mini));
}

// ── Live run ─────────────────────────────────────────────────────────────────────
const LANE: Record<string, string> = { resolve: "search", search: "search", fetch: "fetch", render: "browser", analyse: "build", write: "build", error: "build" };
const SVG_NS = "http://www.w3.org/2000/svg";
function stateIcon(kind: "spin" | "done" | "err"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", `state ${kind}`);
  if (kind === "spin") {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", "8");
    c.setAttribute("cy", "8");
    c.setAttribute("r", "6");
    svg.append(c);
  } else {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", kind === "done" ? "M3.5 8.5l3 3 6-7" : "M4 4l8 8M12 4l-8 8");
    svg.append(p);
  }
  return svg;
}

let timerHandle = 0;
let doneCount = 0;
let source: EventSource | null = null;

function resetRun(q: string) {
  run.hidden = false;
  run.classList.remove("done", "failed");
  result.hidden = true;
  runStatus.textContent = "Generating";
  runTitle.textContent = `Building a brand guide for ${q}`;
  doneCount = 0;
  meter.style.width = "4%";
  document.querySelectorAll<HTMLElement>(".lane").forEach((l) => {
    l.classList.remove("active", "complete", "errored");
    l.querySelector("ol")!.replaceChildren();
  });
  const t0 = performance.now();
  clearInterval(timerHandle);
  timerHandle = window.setInterval(() => (timerEl.textContent = ((performance.now() - t0) / 1000).toFixed(1)), 100);
  run.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

function onProgress(p: Progress) {
  const lane = document.querySelector<HTMLElement>(`.lane[data-lane="${LANE[p.step] ?? "build"}"]`)!;
  const list = lane.querySelector("ol")!;
  if (p.status === "start") {
    lane.classList.add("active");
    lane.classList.remove("complete");
    list.append(h("li", {}, stateIcon("spin"), h("span", { textContent: p.message })));
    return;
  }
  doneCount++;
  meter.style.width = `${Math.min(92, 6 + doneCount * 12)}%`;
  const spinning = [...list.querySelectorAll("li")].filter((li) => li.querySelector(".spin"));
  const last = spinning.pop();
  for (const li of spinning) {
    li.className = "done";
    li.querySelector(".state")!.replaceWith(stateIcon("done"));
  }
  const item = last ?? list.appendChild(h("li", {}, stateIcon("spin"), h("span")));
  item.className = p.status === "error" ? "error" : "done";
  item.querySelector(".state")!.replaceWith(stateIcon(p.status === "error" ? "err" : "done"));
  item.querySelector("span")!.textContent = p.message;
  if (!list.querySelector(".spin")) {
    lane.classList.remove("active");
    lane.classList.add(p.status === "error" ? "errored" : "complete");
  }
}

function finish(ok: boolean) {
  clearInterval(timerHandle);
  go.disabled = false;
  go.classList.remove("busy");
  run.classList.add(ok ? "done" : "failed");
  meter.style.width = ok ? "100%" : meter.style.width;
  document.querySelectorAll(".lane.active").forEach((l) => l.classList.remove("active"));
  document.querySelectorAll(".lane li .spin").forEach((s) => s.replaceWith(stateIcon(ok ? "done" : "err")));
}

function showResult(d: { name: string; links: Record<string, string>; warnings: string[]; summary?: Summary }) {
  const s = d.summary;
  runStatus.textContent = "Done";
  runTitle.textContent = `${d.name} brand guide`;
  if (s) theme(s.palette);

  const logo = $("r-logo");
  logo.className = `result-logo${s?.mode === "dark" ? " dark" : ""}`;
  logo.replaceChildren(...(s?.logo ? [h("img", { src: s.logo, alt: `${d.name} logo` })] : []));
  $("r-name").textContent = d.name;
  $("r-tagline").textContent = s?.tagline ? `“${s.tagline}”` : "";

  $("r-swatches").replaceChildren(
    ...(s?.palette ?? []).map((c, i) => {
      const b = h("button", { className: "r-swatch", type: "button", title: `Copy ${c}`, style: `--i:${i}` }, h("i", { style: `background:${c}` }), h("span", { textContent: c }));
      b.addEventListener("click", () => {
        navigator.clipboard?.writeText(c).catch(() => {});
        const label = b.querySelector("span")!;
        label.textContent = "copied";
        setTimeout(() => (label.textContent = c), 900);
      });
      return b;
    }),
  );
  const pill = (k: string, v: string) => h("span", { className: "pill" }, `${k} `, h("b", { textContent: v }));
  $("r-meta").replaceChildren(
    ...[s?.font ? pill("Type", s.font) : null, s?.mode ? pill("Theme", s.mode) : null, ...(s?.voice ?? []).map((v) => pill("Voice", v))].filter((x): x is HTMLSpanElement => !!x),
  );

  const open = $<HTMLAnchorElement>("r-open");
  open.href = d.links.html!;
  const files: [string, string][] = [
    ["brand.json", d.links.json!],
    ["tokens.json", d.links.tokens!],
    ["tokens.css", d.links.css!],
    ["tailwind.preset.js", d.links.tailwind!],
    ["brand.md", d.links.markdown!],
  ];
  $("r-links").replaceChildren(...files.map(([label, href]) => h("a", { href, target: "_blank", rel: "noopener", textContent: label })));
  $("r-warnings").replaceChildren(...d.warnings.map((w) => h("p", { className: "warn", textContent: w })));

  $("r-url").textContent = `${location.host}${d.links.html}`;
  $<HTMLIFrameElement>("frame").src = d.links.html!;
  result.hidden = false;
}

function start(q: string) {
  source?.close();
  go.disabled = true;
  go.classList.add("busy");
  resetRun(q);
  const params = new URLSearchParams({ q });
  if (refresh.checked) params.set("refresh", "1");
  history.replaceState(null, "", `?${new URLSearchParams({ q })}`);

  const es = new EventSource(`/api/guide/stream?${params}`);
  source = es;
  es.addEventListener("progress", (e) => onProgress(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("done", (e) => {
    es.close();
    finish(true);
    showResult(JSON.parse((e as MessageEvent).data));
    loadGallery();
  });
  es.addEventListener("error", (e) => {
    const data = (e as MessageEvent).data;
    es.close();
    finish(false);
    runStatus.textContent = "Failed";
    runTitle.textContent = "Something went wrong";
    onProgress({ step: "error", status: "error", message: data ? JSON.parse(data).message : "Connection lost" });
    form.classList.remove("shake");
    void form.offsetWidth;
    form.classList.add("shake");
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) start(q);
});
document.querySelectorAll<HTMLButtonElement>("[data-q]").forEach((b) =>
  b.addEventListener("click", () => {
    input.value = b.dataset.q!;
    start(b.dataset.q!);
  }),
);

observe();
loadGallery();
const initial = new URLSearchParams(location.search).get("q");
if (initial) {
  input.value = initial;
  start(initial);
}
