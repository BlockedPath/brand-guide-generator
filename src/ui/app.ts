/// <reference lib="dom" />

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("form");
const input = $<HTMLInputElement>("q");
const go = $<HTMLButtonElement>("go");
const refresh = $<HTMLInputElement>("refresh");
const runSection = $("run");
const runTitle = $("run-title");
const log = $<HTMLOListElement>("log");
const result = $("result");
const linksEl = $("links");
const frame = $<HTMLIFrameElement>("frame");
const gallery = $("gallery");

interface Progress {
  step: string;
  status: "start" | "done" | "error";
  message: string;
}

const STEP_LABEL: Record<string, string> = { resolve: "search", render: "browser", fetch: "fetch", search: "search", analyse: "analyse", write: "write" };

function addLog(p: Progress) {
  const li = document.createElement("li");
  li.className = p.status;
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = STEP_LABEL[p.step] ?? p.step;
  li.append(tag, p.message);
  // A "done" for a step replaces that step's spinner line.
  if (p.status !== "start") {
    const pending = [...log.querySelectorAll<HTMLLIElement>("li.start")].find((x) => x.dataset.step === p.step);
    pending?.remove();
  }
  li.dataset.step = p.step;
  log.append(li);
}

function link(href: string, label: string, primary = false) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = label;
  a.target = "_blank";
  a.rel = "noopener";
  if (primary) a.className = "primary";
  return a;
}

async function loadGallery() {
  const res = await fetch("/api/guides");
  const items: { slug: string; name: string; domain: string; primary: string | null; tagline: string | null }[] = await res.json();
  if (!items.length) return;
  gallery.replaceChildren(
    ...items.map((g) => {
      const a = document.createElement("a");
      a.className = "card";
      a.href = `/g/${g.slug}/`;
      a.target = "_blank";
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.background = g.primary ?? "#e5e7eb";
      const body = document.createElement("div");
      body.className = "body";
      const s = document.createElement("strong");
      s.textContent = g.name;
      const t = document.createElement("span");
      t.textContent = g.tagline ?? g.domain;
      body.append(s, t);
      a.append(bar, body);
      return a;
    }),
  );
}

function start(q: string) {
  go.disabled = true;
  runSection.hidden = false;
  result.hidden = true;
  log.replaceChildren();
  runTitle.textContent = `Building a brand guide for ${q}…`;
  const params = new URLSearchParams({ q });
  if (refresh.checked) params.set("refresh", "1");
  const es = new EventSource(`/api/guide/stream?${params}`);
  es.addEventListener("progress", (e) => addLog(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("done", (e) => {
    es.close();
    const d = JSON.parse((e as MessageEvent).data) as { name: string; links: Record<string, string>; warnings: string[] };
    runTitle.textContent = `${d.name} brand guide`;
    linksEl.replaceChildren(
      link(d.links.html!, "Open guide ↗", true),
      link(d.links.json!, "brand.json"),
      link(d.links.tokens!, "tokens.json"),
      link(d.links.css!, "tokens.css"),
      link(d.links.tailwind!, "tailwind.preset.js"),
      link(d.links.markdown!, "brand.md"),
    );
    for (const w of d.warnings) {
      const p = document.createElement("p");
      p.className = "warn";
      p.textContent = w;
      linksEl.after(p);
    }
    frame.src = d.links.html!;
    result.hidden = false;
    go.disabled = false;
    loadGallery();
  });
  es.addEventListener("error", (e) => {
    const data = (e as MessageEvent).data;
    es.close();
    go.disabled = false;
    addLog({ step: "error", status: "error", message: data ? JSON.parse(data).message : "Connection lost" });
    runTitle.textContent = "Something went wrong";
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
loadGallery();
