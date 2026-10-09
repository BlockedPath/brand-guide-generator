import type { PageKind } from "./discover.ts";
import { isCopy, isNoisy, linkTexts, parseMarkdown, properNouns, splitSentences, wordCount, wordsOf, type Block } from "./markdown.ts";
import type { FetchedPage } from "./tinyfish.ts";

// Messaging and official brand rules, extracted verbatim from pages read with TinyFish Fetch.

export interface PageDoc {
  url: string;
  kind: PageKind;
  title: string | null;
  description: string | null;
  blocks: Block[];
  links: string[];
  imageLinks: string[];
  linkTexts: { text: string; href: string }[];
}

export interface Sourced {
  text: string;
  source: string;
}

export interface Messaging {
  tagline: Sourced | null;
  subheadline: Sourced | null;
  positioning: Sourced | null;
  boilerplate: Sourced | null;
  slogans: Sourced[];
  valueProps: { headline: string; support: string | null; source: string }[];
  proofPoints: { stat: string; label: string; source: string }[];
  mission: Sourced[];
  values: { name: string; description: string; source: string }[];
  ctas: { text: string; count: number }[];
  keyTerms: { term: string; count: number }[];
  audiences: { phrase: string; count: number }[];
}

export interface BrandRules {
  rules: { text: string; topic: "logo" | "naming" | "color" | "typography" | "usage"; source: string }[];
  downloads: { url: string; label: string; type: string; source: string }[];
  statedColors: { hex: string; label: string | null; source: string }[];
  logoFiles: string[];
}

export function toDoc(page: FetchedPage, kind: PageKind): PageDoc {
  return {
    url: page.finalUrl,
    kind,
    title: page.title,
    description: page.description,
    blocks: parseMarkdown(page.text),
    links: page.links,
    imageLinks: page.imageLinks,
    linkTexts: linkTexts(page.text),
  };
}

// Paragraphs repeated across pages are site chrome (banners, footers): drop them from analysis.
export function stripChrome(docs: PageDoc[]): PageDoc[] {
  if (docs.length < 2) return docs;
  const seen = new Map<string, Set<string>>();
  for (const d of docs) for (const b of d.blocks) seen.set(b.text, (seen.get(b.text) ?? new Set()).add(d.url));
  return docs.map((d) => ({ ...d, blocks: d.blocks.filter((b) => (seen.get(b.text)?.size ?? 0) < 2 || (d.kind === "home" && b.type === "heading" && b.level === 1)) }));
}

export function copySentences(docs: PageDoc[]): { text: string; source: string }[] {
  const out: { text: string; source: string }[] = [];
  const seen = new Set<string>();
  // Cap each page so one long page (a transcript, a legal page) can't dominate the voice.
  for (const d of docs) {
    let n = 0;
    for (const b of d.blocks) {
      if (b.type === "heading" || n >= 80) continue;
      for (const s of splitSentences(b.text)) {
        if (!isCopy(s) || seen.has(s) || n >= 80) continue;
        seen.add(s);
        out.push({ text: s, source: d.url });
        n++;
      }
    }
  }
  return out;
}

export function headlines(docs: PageDoc[]): { text: string; level: number; source: string }[] {
  const out: { text: string; level: number; source: string }[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    for (const b of d.blocks) {
      if (b.type !== "heading" || seen.has(b.text)) continue;
      const n = wordCount(b.text);
      if (n < 2 || n > 24 || /^\d/.test(b.text)) continue;
      seen.add(b.text);
      out.push({ text: b.text, level: b.level, source: d.url });
    }
  }
  return out;
}

const NAV_WORDS = /^(products?|solutions?|resources?|company|developers?|pricing|customers?|careers|blog|docs|support|contact|legal|press|about( us)?|sign (in|up)|log ?in|menu|search|home|more|latest stories|recently viewed|features?|integrations?|enterprise|partners?|download|changelog|learn more|read more|get started|new arrivals)$/i;

const STAT_ONLY = /^(?:(?:less than|more than|over|up to|nearly|~)\s*)?[$€£¥]?\d[\d,.]*\s?(?:%|\+|[kmbt]\+?|x|×|\s?(?:million|billion|trillion|thousand|months?|years?|days?|hours?|minutes?|seconds?))?\+?$/i;

const COUNT_NOUN = /^\s*(?:[a-z-]+\s)?(customers|users|countries|cities|companies|businesses|teams|employees|people|partners|stores|locations|members|hosts|guests|developers|languages|learners|products|integrations|reviews|downloads|organizations|brands|creators|merchants|students|volunteers)\b/i;

// The most impressive figure in a sentence: money/scale beats multipliers beats percentages beats counts.
export function bestStat(text: string): string | null {
  const re = /(?:(?:more than|over|nearly|almost|up to)\s+)?[$€£¥]?\d[\d,.]*\s?(?:%|\+|[KMBT]\b\+?|x\b|×|million\b|billion\b|trillion\b)?\+?/gi;
  let best: { t: string; score: number } | null = null;
  for (const m of text.matchAll(re)) {
    const t = m[0].trim().replace(/[.,]$/, "");
    const num = parseFloat(t.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(num)) continue;
    if (/^(19|20)\d{2}$/.test(t)) continue; // a year, not a stat
    let score = 0;
    if (/[$€£¥]|million|billion|trillion|\d\s?[KMBT]\b/i.test(t)) score = 4;
    else if (/x\b|×/i.test(t)) score = 3;
    else if (/\+/.test(t) || num >= 1000) score = 2.5;
    else if (/%/.test(t) && num > 1) score = 2;
    else if (num >= 100 && COUNT_NOUN.test(text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40))) score = 1;
    if (score > 0 && (!best || score > best.score)) best = { t, score };
  }
  return best?.t ?? null;
}

// The clause of a sentence that carries the stat, so proof-point labels stay short.
export function clauseAround(sentence: string, stat: string): string {
  if (wordCount(sentence) <= 18) return sentence;
  const parts = sentence.split(/\s*(?:[;—–:]|,\s(?=(?:and|but|which|while|as|with|including)\b)|\s-\s)\s*/);
  const i = parts.findIndex((p) => p.includes(stat));
  if (i < 0) return sentence;
  let clause = parts[i]!;
  if (wordCount(clause) < 5 && parts[i + 1]) clause = `${clause}, ${parts[i + 1]}`;
  if (wordCount(clause) > 22) {
    // Still long: keep a window of words around the figure.
    const words = clause.split(/\s+/);
    const at = words.findIndex((w) => w.includes(stat.split(" ")[0]!));
    const start = Math.max(0, at - 6);
    clause = `${start > 0 ? "…" : ""}${words.slice(start, at + 10).join(" ")}`;
  }
  return clause.replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/[,\s]+$/, "") + (/[.!?]$/.test(clause) ? "" : "…");
}

const MISSION = /\b(our mission|mission is|on a mission|we believe|we exist|our purpose|our vision|we('re| are) (building|shaping|on a mission|here to)|we (aim|strive|set out) to|exists? to|in business to)\b/i;

const CTA_VERB = /^(get|start|try|sign|book|request|contact|join|shop|buy|explore|learn|see|watch|download|read|discover|talk|create|build|open|claim|schedule|subscribe|apply|view|meet|find)\b/i;

const STOP = new Set(
  "because know think kind right thing things going lot actually maybe sure something someone anything everything people's a an the and or but if then than so of to in on at by for with from into onto over under about across after before between through during without within up down out off again further once here there when where why how all any both each few more most other some such no nor not only own same too very can will just don should now is are was were be been being have has had having do does did doing it its it's they them their theirs we us our ours you your yours he she his her i me my mine this that these those which who whom what as also get got make makes made new use using used one two every like way ways need needs help helps want across while well even much many may might must could would shall let lets per via etc yet still really able includes including include whether into onto upon".split(
    " ",
  ),
);
const WEB_WORDS = new Set("learn read story stories click privacy cookie cookies policy terms sign login log menu home page site website watch view see now today free trial demo contact sales started start explore".split(" "));

function firstSentence(text: string): [string, string | null] {
  const parts = splitSentences(text);
  if (parts.length <= 1) return [text, null];
  return [parts[0]!, parts.slice(1).join(" ")];
}

export function extractMessaging(docs: PageDoc[], brand: string, ctaTexts: string[]): Messaging {
  const home = docs.find((d) => d.kind === "home") ?? docs[0]!;
  const brandRe = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

  // Tagline: the homepage's lead headline (first sentence), else a short H2, else the title.
  let tagline: Sourced | null = null;
  let subheadline: Sourced | null = null;
  const homeHeads = home.blocks.filter((b) => b.type === "heading");
  const lead =
    homeHeads.find((b) => b.level === 1 && wordCount(b.text) >= 3 && !/^\d/.test(b.text)) ??
    homeHeads.find((b) => b.level <= 2 && wordCount(b.text) >= 4 && !NAV_WORDS.test(b.text) && !/^\d/.test(b.text));
  if (lead) {
    const [first, rest] = firstSentence(lead.text);
    tagline = { text: first, source: home.url };
    if (rest) subheadline = { text: rest, source: home.url };
    else {
      const idx = home.blocks.indexOf(lead);
      const next = home.blocks.slice(idx + 1, idx + 3).find((b) => b.type === "para" && isCopy(b.text));
      if (next) subheadline = { text: next.text, source: home.url };
    }
  }

  // Campaign-style slogans: short all-caps lines on the homepage ("MADE FOR THE MOMENT. BUILT FOR A LIFETIME.").
  const slogans = home.blocks
    .filter((b) => b.type === "para" && b.text === b.text.toUpperCase() && /[A-Z]/.test(b.text) && wordCount(b.text) >= 4 && wordCount(b.text) <= 12)
    .map((b) => ({ text: b.text, source: home.url }))
    .slice(0, 3);
  if (!tagline && slogans[0]) {
    tagline = { text: slogans[0].text.toLowerCase().replace(/(^|[.!?]\s+)(\p{L})/gu, (_, p, c) => p + c.toUpperCase()), source: home.url };
  } else if (!tagline && home.title) {
    const part = home.title.split(/\s+[|–—·-]\s+/).find((p) => !brandRe.test(p) || wordCount(p) > 2);
    if (part) tagline = { text: part.replace(brandRe, "").trim() || part, source: home.url };
  }

  const positioning = home.description ? { text: home.description, source: home.url } : null;

  // Value propositions: homepage section headlines + the line that supports them.
  const valueProps: Messaging["valueProps"] = [];
  const seenVp = new Set<string>([tagline?.text ?? ""]);
  const pushVp = (rawHeadline: string, support: string | null, source: string) => {
    const headline = rawHeadline.replace(/\s*[→›»↗]+\s*$/, "").trim();
    if (NAV_WORDS.test(headline) || CTA_VERB.test(headline) && wordCount(headline) <= 3) return;
    const key = headline.toLowerCase();
    if (seenVp.has(key) || valueProps.length >= 8 || isNoisy(headline) || /\d\.\d{3,}|[a-z]\d/i.test(headline)) return;
    seenVp.add(key);
    valueProps.push({ headline, support, source });
  };
  for (const d of [home, ...docs.filter((x) => x.kind === "product")]) {
    d.blocks.forEach((b, i) => {
      if (b.type !== "heading" || b.level < 2 || b === lead) return;
      const n = wordCount(b.text);
      if (n < 2 || n > 18 || NAV_WORDS.test(b.text) || /^\d/.test(b.text)) return;
      const after = d.blocks.slice(i + 1, i + 3);
      const support = after[0]?.type === "para" && STAT_ONLY.test(after[0].text) ? undefined : after.find((x) => x.type === "para" && isCopy(x.text));
      if ((n < 3 || b.level >= 3) && !support) return;
      if (/[·⋅…]|\.\.\.|\d\.\d{3,}/.test(b.text)) return;
      pushVp(b.text, support ? firstSentence(support.text)[0] : null, d.url);
    });
  }
  // Feature pairs rendered as plain text ("Purpose-built" → "Linear is shaped by…").
  home.blocks.forEach((b, i) => {
    const next = home.blocks[i + 1];
    if (b.type !== "para" || !next || next.type !== "para") return;
    const n = wordCount(b.text);
    if (n < 1 || n > 4 || /[.!?:]$/.test(b.text) || NAV_WORDS.test(b.text) || STAT_ONLY.test(b.text) || !/^[A-Z]/.test(b.text)) return;
    if (!isCopy(next.text) || /^(fig|figure)\b/i.test(b.text)) return;
    pushVp(b.text, firstSentence(next.text)[0], home.url);
  });

  // Proof points: stat blocks ("135+" / "currencies supported") and stat-bearing sentences.
  const proofPoints: Messaging["proofPoints"] = [];
  const seenProof = new Set<string>();
  const pushProof = (stat: string, label: string, source: string) => {
    const key = stat.toLowerCase().replace(/^(more than|over|nearly|almost|up to)\s+/, "");
    if (seenProof.has(key) || proofPoints.length >= 6 || isNoisy(label)) return;
    seenProof.add(key);
    proofPoints.push({ stat, label, source });
  };
  for (const d of docs.filter((x) => ["home", "about", "customers", "product"].includes(x.kind))) {
    d.blocks.forEach((b, i) => {
      const next = d.blocks[i + 1];
      // Stats inside customer-story cards describe the customer, not the brand: check this section only.
      let start = i;
      while (start > 0 && d.blocks[start - 1]!.type !== "heading") start--;
      let end = i + 1;
      while (end < d.blocks.length && d.blocks[end]!.type !== "heading") end++;
      if (d.blocks.slice(start, end).some((x) => /read (the )?(full )?(customer )?story|case study|customer story|products used/i.test(x.text))) return;
      if (b.type === "para" && STAT_ONLY.test(b.text) && next && next.type === "para" && wordCount(next.text) >= 2 && wordCount(next.text) <= 14 && !STAT_ONLY.test(next.text) && /\b[a-z]{3,}\b/.test(next.text)) {
        pushProof(b.text, next.text, d.url);
      }
    });
  }
  // Sentence stats only count when they're about the brand itself (not advocacy or industry figures).
  const aboutUs = new RegExp(`\\b(we|our|us)\\b|${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  for (const s of copySentences(docs.filter((x) => ["home", "about"].includes(x.kind)))) {
    if (proofPoints.length >= 6) break;
    if (wordCount(s.text) > 40 || !aboutUs.test(s.text)) continue;
    const stat = bestStat(s.text);
    if (stat) pushProof(stat, clauseAround(s.text, stat), s.source);
  }

  // Mission, vision and the "About <brand>" boilerplate sentence.
  const sentences = copySentences(docs);
  const coreUrls = new Set(docs.filter((d) => ["home", "about", "brand"].includes(d.kind)).map((d) => d.url));
  const mission: Sourced[] = [];
  for (const s of sentences) {
    if (mission.length >= 4) break;
    if (coreUrls.has(s.source) && MISSION.test(s.text) && wordCount(s.text) >= 6 && wordCount(s.text) <= 45) {
      mission.push({ ...s, text: s.text.replace(new RegExp(`^about ${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "") });
    }
  }
  const boilerRe = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(is|was|builds|makes|helps|has been|designs|creates|offers|provides|develops)\\b`, "i");
  const boilerScore = (s: Sourced) =>
    (/\b(is|was) (a|an|the)\b/i.test(s.text) ? 3 : 0) +
    (/\b(company|platform|technology|maker|provider|brand|business|service|software|tool|designer|manufacturer|retailer|system|app)\b/i.test(s.text) ? 2 : 0) +
    (coreUrls.has(s.source) ? 1 : 0) -
    (/\bnot\b/i.test(s.text) ? 3 : 0);
  const boilerplate =
    sentences
      .filter((s) => boilerRe.test(s.text) && wordCount(s.text) >= 8 && wordCount(s.text) <= 45)
      .sort((a, b) => boilerScore(b) - boilerScore(a))[0] ??
    sentences
      .filter((s) => coreUrls.has(s.source) && brandRe.test(s.text) && /\b(is|are|helps|makes|builds|designs|creates|offers|provides|exists|believes)\b/i.test(s.text) && wordCount(s.text) >= 8 && wordCount(s.text) <= 40)
      .sort((a, b) => boilerScore(b) - boilerScore(a))[0] ??
    null;

  // Values: short headings on about/values pages, each followed by an explanation.
  const values: Messaging["values"] = [];
  for (const d of docs.filter((x) => x.kind === "about")) {
    d.blocks.forEach((b, i) => {
      if (values.length >= 6 || b.type !== "heading" || b.level < 2) return;
      const n = wordCount(b.text);
      if (n > 4 || NAV_WORDS.test(b.text) || /[\d$€£]/.test(b.text) || /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(b.text) || /\?$/.test(b.text) || /^(what|why|how|who|want|where|when)\b/i.test(b.text) || /meet|team|join|hiring|investors|press/i.test(b.text)) return;
      const desc = d.blocks.slice(i + 1, i + 3).find((x) => x.type === "para" && isCopy(x.text));
      if (desc) values.push({ name: b.text, description: firstSentence(desc.text)[0], source: d.url });
    });
  }

  // Calls to action: rendered buttons (Browser) + CTA-shaped link texts (Fetch).
  const ctaCount = new Map<string, number>();
  const addCta = (t: string) => {
    const text = t.replace(/[→›>»↗]+/g, "").replace(/\s+/g, " ").trim().replace(/^(.+?)\s+\1$/i, "$1");
    if (text.length < 2 || text.length > 32 || !CTA_VERB.test(text)) return;
    const key = text.charAt(0).toUpperCase() + text.slice(1);
    ctaCount.set(key, (ctaCount.get(key) ?? 0) + 1);
  };
  ctaTexts.forEach(addCta);
  for (const d of docs) for (const l of d.linkTexts) addCta(l.text);
  const ctas = [...ctaCount.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 10);

  // Key terms: distinctive words/phrases weighted toward headlines.
  const brandWords = new Set(wordsOf(brand));
  const uni = new Map<string, number>();
  const bi = new Map<string, number>();
  const tally = (text: string, w: number) => {
    const ws = wordsOf(text).map((x) => x.replace(/['’]s$/, ""));
    ws.forEach((x, i) => {
      if (x.length > 2 && !STOP.has(x) && !WEB_WORDS.has(x) && !brandWords.has(x)) uni.set(x, (uni.get(x) ?? 0) + w);
      const y = ws[i + 1];
      if (y && x.length > 2 && y.length > 2 && !STOP.has(x) && !STOP.has(y) && !WEB_WORDS.has(x) && !WEB_WORDS.has(y) && !brandWords.has(x) && !brandWords.has(y)) {
        bi.set(`${x} ${y}`, (bi.get(`${x} ${y}`) ?? 0) + w);
      }
    });
  };
  const marketing = docs.filter((d) => d.kind !== "brand");
  const marketingSentences = copySentences(marketing);
  const proper = properNouns(marketingSentences.map((s) => s.text));
  const tallyText = (text: string, w: number) => tally(text.replace(/\p{L}[\p{L}'’-]*/gu, (word) => (proper.has(word.toLowerCase()) ? "." : word)), w);
  for (const h of headlines(marketing)) tallyText(h.text, 2);
  for (const s of marketingSentences) tallyText(s.text, 1);
  const bigrams = [...bi.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const covered = new Set(bigrams.flatMap(([t]) => t.split(" ")));
  const unigrams = [...uni.entries()].filter(([t, c]) => c >= 3 && !covered.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 14 - bigrams.length);
  const keyTerms = [...bigrams, ...unigrams].map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count);

  // Audiences: who the copy says it's for.
  const aud = new Map<string, number>();
  const AUD = /\bfor (?:(?:every|all|modern|growing|ambitious|small|large|high-growth|fast-moving|the world's|today's)\s+)?((?:[a-z-]+\s){0,2}(?:teams|businesses|business|companies|developers|engineers|designers|marketers|founders|startups|enterprises|creators|people|everyone|brands|retailers|platforms|builders|makers|families|kids|athletes|climbers|surfers|customers|users|organizations|nonprofits|agencies|professionals|students|leaders))\b/gi;
  for (const s of [...sentences.map((x) => x.text), ...headlines(docs).map((h) => h.text)]) {
    for (const m of s.matchAll(AUD)) {
      const phrase = m[1]!.toLowerCase().trim();
      if (phrase.split(" ").some((w) => STOP.has(w) && w !== "every" && w !== "all")) continue;
      aud.set(phrase, (aud.get(phrase) ?? 0) + 1);
    }
  }
  const audiences = [...aud.entries()].map(([phrase, count]) => ({ phrase, count })).sort((a, b) => b.count - a.count).slice(0, 6);

  return { tagline, subheadline, positioning, boilerplate, slogans, valueProps, proofPoints, mission, values, ctas, keyTerms, audiences };
}

const RULE = /\b(should|must|always|never|do not|don['’]t|please|avoid|preferred|acceptable|only use|use (the|our|it|them)|is (a single word|always|never)|refrain|make sure|give (it|them) room)\b/i;
const ASSET_CONTEXT = /\b(logos?|logomark|wordmark|icons?|marks?|badges?|brand(ing)?|trademarks?|assets?|graphics?|colou?rs?|palette|fonts?|typefaces?|name|spell(ed)?|capitali[sz]ed?|lockup)\b/i;
const TOPIC: [BrandRules["rules"][number]["topic"], RegExp][] = [
  ["logo", /\b(logo|logomark|wordmark|icon|mark|badge|symbol|lockup)\b/i],
  ["color", /\b(colou?rs?|palette|hex|pantone)\b/i],
  ["typography", /\b(font|typeface|type family|typography)\b/i],
  ["naming", /\b(name|spell|spelled|capitali[sz]e|capital|trademark|written as)\b/i],
  ["usage", /\b(space|background|asset|graphic|alter|modify|distort|endorse|affiliat|clear ?space|proportion)\b/i],
];

export function extractBrandRules(docs: PageDoc[], brand: string): BrandRules {
  const brandSlug = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const rules: BrandRules["rules"] = [];
  const seen = new Set<string>();
  const brandDocs = docs.filter((d) => d.kind === "brand");
  for (const d of brandDocs) {
    for (const b of d.blocks) {
      if (b.type === "heading") continue;
      for (const s of splitSentences(b.text)) {
        if (rules.length >= 12 || seen.has(s) || wordCount(s) < 5 || wordCount(s) > 40 || !RULE.test(s) || !ASSET_CONTEXT.test(s)) continue;
        const topic = TOPIC.find(([, re]) => re.test(s))?.[0];
        if (!topic) continue;
        seen.add(s);
        rules.push({ text: s, topic, source: d.url });
      }
    }
  }

  const downloads: BrandRules["downloads"] = [];
  const seenDl = new Set<string>();
  for (const d of brandDocs) {
    for (const url of [...d.links, ...d.imageLinks]) {
      const path = url.split("?")[0]!;
      const ext = path.match(/\.(zip|svg|eps|ai|pdf|png)$/i)?.[1]?.toLowerCase();
      if (!ext) continue;
      const file0 = decodeURIComponent(path.split("/").pop() ?? "").toLowerCase();
      if ((ext === "svg" || ext === "png") && !/logo|wordmark|badge|lockup|brandmark|icon/.test(file0)) continue;
      if (ext === "pdf" && !/brand|guide|logo|kit|media/.test(file0)) continue;
      const file = decodeURIComponent(path.split("/").pop() ?? "");
      if (seenDl.has(file) || downloads.length >= 10) continue;
      seenDl.add(file);
      const label = file.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
      downloads.push({ url, label, type: ext.toUpperCase(), source: d.url });
    }
  }
  downloads.sort((a, b) => ["ZIP", "SVG", "EPS", "AI", "PDF", "PNG"].indexOf(a.type) - ["ZIP", "SVG", "EPS", "AI", "PDF", "PNG"].indexOf(b.type));

  const statedColors: BrandRules["statedColors"] = [];
  for (const d of brandDocs) {
    for (const b of d.blocks) {
      for (const m of b.text.matchAll(/#[0-9a-f]{6}\b/gi)) {
        if (statedColors.some((c) => c.hex.toLowerCase() === m[0].toLowerCase())) continue;
        const before = b.text.slice(Math.max(0, m.index! - 40), m.index).split(/[.:;,\n]/).pop()?.trim() || null;
        statedColors.push({ hex: m[0].toUpperCase(), label: before && before.length <= 30 ? before : null, source: d.url });
      }
    }
  }

  // Only logo files named after the brand itself (homepages are full of customer logos).
  const logoFiles = [
    ...new Set(
      docs
        .flatMap((d) => d.imageLinks)
        .filter((u) => {
          const file = decodeURIComponent(u.split("?")[0]!.split("/").pop() ?? "").toLowerCase();
          return /logo|wordmark/.test(file) && !!brandSlug && file.replace(/[^a-z0-9]/g, "").includes(brandSlug);
        }),
    ),
  ].slice(0, 6);
  return { rules, downloads, statedColors: statedColors.slice(0, 12), logoFiles };
}
