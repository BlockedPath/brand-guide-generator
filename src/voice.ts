import { wordCount, wordsOf } from "./markdown.ts";

// Tone of voice from the site's own copy. Deterministic and explainable: every trait and rule
// is backed by a measured metric and verbatim example sentences, mapped onto the four
// Nielsen Norman Group tone dimensions.

export interface VoiceMetrics {
  sentences: number;
  headlines: number;
  avgSentenceWords: number;
  medianHeadlineWords: number;
  readingEase: number; // Flesch reading ease, 0–100 (higher = easier)
  gradeLevel: number; // Flesch–Kincaid grade
  youRate: number; // share of sentences addressing the reader
  weRate: number;
  contractionRate: number;
  exclamationRate: number;
  questionRate: number;
  imperativeHeadlineRate: number;
  headlinePeriodRate: number;
  headlineCase: "sentence" | "title" | "upper" | "mixed";
  jargonPer100: number;
  superlativePer100: number;
  numberRate: number;
  emojiRate: number;
}

export interface ToneDimension {
  axis: string;
  left: string;
  right: string;
  value: number; // 0 = fully left pole, 100 = fully right pole
  basis: string;
}

export interface VoiceTrait {
  name: string;
  description: string;
  evidence: string[];
  strength: number;
}

export interface Voice {
  summary: string;
  dimensions: ToneDimension[];
  traits: VoiceTrait[];
  dos: string[];
  donts: string[];
  metrics: VoiceMetrics;
  examples: { headlines: string[]; sentences: string[] };
}

const IMPERATIVE = new Set(
  "accept add automate bring build build-in buy choose connect create design discover do drive explore find focus get give go grow help join keep launch let make manage meet move own plan power protect reach reduce run save scale see ship shop simplify start stay stop take track transform try turn unlock use work write sell learn bank pay earn invest spend send streamline accelerate boost deliver empower enable".split(" "),
);
const JARGON = /\b(api|apis|sdk|platform|infrastructure|integrations?|workflows?|scalab\w+|enterprise|automation|analytics|data|cloud|ai|agents?|stack|deploy\w*|optimi[sz]\w+|leverage|synerg\w+|end-to-end|seamless\w*|robust|solutions?|ecosystem|real-time|compliance|orchestrat\w+|pipelines?|llms?|saas|b2b|roi|kpis?)\b/gi;
const SUPERLATIVE = /\b(best|fastest|most|leading|world's|world’s|#1|number one|ultimate|unrivall?ed|revolutionary|incredible|amazing|awesome|unmatched|unparalleled|powerful|effortless\w*|magic\w*|delightful|beautiful|loved?)\b/gi;
const CASUAL = /\b(awesome|cool|stuff|kinda|gonna|wanna|hey|yay|oops|folks|crazy|super|totally|nope|yep|wow|lol)\b/gi;
const CONTRACTION = /\b\w+(?:n['’]t|['’](?:re|ll|ve|m|d))\b|\b(?:it|that|what|here|there|let|who)['’]s\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

function rate(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 1000 : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

function headlineCase(heads: string[]): VoiceMetrics["headlineCase"] {
  let sentence = 0, title = 0, upper = 0;
  for (const h of heads) {
    const words = h.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && w.length > 3);
    if (words.length < 2) continue;
    if (h === h.toUpperCase()) upper++;
    else if (words.slice(1).filter((w) => /^[A-Z]/.test(w)).length / (words.length - 1) > 0.7) title++;
    else sentence++;
  }
  const total = sentence + title + upper;
  if (!total) return "mixed";
  if (sentence / total >= 0.6) return "sentence";
  if (title / total >= 0.6) return "title";
  if (upper / total >= 0.6) return "upper";
  return "mixed";
}

export function analyseVoice(sentences: string[], heads: string[]): Voice {
  if (sentences.length < 5) return insufficient(sentences, heads);
  return analyseVoiceUnchecked(sentences, heads);
}

function analyseVoiceUnchecked(sentences: string[], heads: string[]): Voice {
  const n = sentences.length || 1;
  const allWords = sentences.flatMap((s) => wordsOf(s));
  const wc = allWords.length || 1;
  const syl = allWords.reduce((s, w) => s + syllables(w), 0);
  const avgSentenceWords = Math.round((wc / n) * 10) / 10;
  const readingEase = Math.round(206.835 - 1.015 * (wc / n) - 84.6 * (syl / wc));
  const gradeLevel = Math.max(0, Math.round((0.39 * (wc / n) + 11.8 * (syl / wc) - 15.59) * 10) / 10);

  const count = (re: RegExp) => sentences.filter((s) => re.test(s)).length;
  const youRate = rate(count(/\b(you|your|you're|you’re|yours)\b/i), n);
  const weRate = rate(count(/\b(we|our|us|we're|we’re)\b/i), n);
  const contractionRate = rate(count(CONTRACTION), n);
  const exclamationRate = rate(sentences.filter((s) => s.includes("!")).length + heads.filter((h) => h.includes("!")).length, n + heads.length);
  const questionRate = rate(sentences.filter((s) => s.trim().endsWith("?")).length + heads.filter((h) => h.trim().endsWith("?")).length, n + heads.length);
  const imperativeHeadlineRate = rate(heads.filter((h) => IMPERATIVE.has((h.split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z-]/g, ""))).length, heads.length);
  const headlinePeriodRate = rate(heads.filter((h) => /\.$/.test(h.trim())).length, heads.length);
  const jargonPer100 = Math.round(((sentences.join(" ").match(JARGON)?.length ?? 0) / wc) * 1000) / 10;
  const superlativePer100 = Math.round(((sentences.join(" ").match(SUPERLATIVE)?.length ?? 0) / wc) * 1000) / 10;
  const numberRate = rate(count(/\d/), n);
  const emojiRate = rate(count(EMOJI), n);
  const casualHits = (sentences.join(" ").match(CASUAL)?.length ?? 0) / wc;
  const longWordRate = allWords.filter((w) => syllables(w) >= 3).length / wc;

  const metrics: VoiceMetrics = {
    sentences: sentences.length,
    headlines: heads.length,
    avgSentenceWords,
    medianHeadlineWords: median(heads.map(wordCount)),
    readingEase,
    gradeLevel,
    youRate,
    weRate,
    contractionRate,
    exclamationRate,
    questionRate,
    imperativeHeadlineRate,
    headlinePeriodRate,
    headlineCase: headlineCase(heads),
    jargonPer100,
    superlativePer100,
    numberRate,
    emojiRate,
  };

  const casual = clamp(50 + contractionRate * 160 + youRate * 40 + (readingEase - 50) * 0.5 - longWordRate * 120 + casualHits * 2000 + emojiRate * 150 - 12);
  const funny = clamp(12 + exclamationRate * 250 + emojiRate * 300 + questionRate * 80 + casualHits * 3000);
  const irreverent = clamp(10 + casualHits * 4000 + emojiRate * 300 + exclamationRate * 150 + (metrics.headlineCase === "upper" ? 10 : 0));
  const enthusiastic = clamp(25 + exclamationRate * 300 + superlativePer100 * 18 + emojiRate * 200 - numberRate * 25 - headlinePeriodRate * 10);

  const dimensions: ToneDimension[] = [
    { axis: "Funny ↔ Serious", left: "Funny", right: "Serious", value: 100 - funny, basis: `${pct(exclamationRate)} exclamations, ${pct(questionRate)} questions, ${pct(emojiRate)} with emoji` },
    { axis: "Formal ↔ Casual", left: "Formal", right: "Casual", value: casual, basis: `${pct(contractionRate)} use contractions, reading ease ${readingEase}, ${Math.round(longWordRate * 100)}% long words` },
    { axis: "Respectful ↔ Irreverent", left: "Respectful", right: "Irreverent", value: irreverent, basis: `slang/emoji density, ${metrics.headlineCase} case headlines` },
    { axis: "Enthusiastic ↔ Matter-of-fact", left: "Enthusiastic", right: "Matter-of-fact", value: 100 - enthusiastic, basis: `${superlativePer100} superlatives per 100 words, ${pct(numberRate)} cite numbers` },
  ];

  // Evidence = complete sentences only (ends in punctuation, no UI text glued together).
  const quotable = sentences.filter((s) => /[.!?]["”’)]?$/.test(s) && !/[a-z]{3}[A-Z][a-z]{2}/.test(s));
  const pick = (re: RegExp, k = 2) => quotable.filter((s) => re.test(s) && wordCount(s) <= 30).slice(0, k);
  const shortest = [...quotable].filter((s) => wordCount(s) >= 6).sort((a, b) => a.length - b.length).slice(0, 2);
  const traits: VoiceTrait[] = [];
  const add = (name: string, description: string, strength: number, evidence: string[]) => {
    if (strength > 0) traits.push({ name, description, strength: Math.round(strength * 100) / 100, evidence: evidence.slice(0, 2) });
  };
  if (youRate >= 0.2) add("Customer-centric", `Talks to the reader directly — ${pct(youRate)} of sentences say "you/your".`, youRate * 2, pick(/\byour?\b/i));
  if (weRate >= 0.25 && weRate > youRate) add("Company-led", `Speaks as "we" — ${pct(weRate)} of sentences are about the company.`, weRate * 1.6, pick(/\b(we|our)\b/i));
  if (avgSentenceWords <= 14) add("Concise", `Short sentences averaging ${avgSentenceWords} words.`, (16 - avgSentenceWords) / 8, shortest);
  if (avgSentenceWords >= 22) add("Explanatory", `Long, detailed sentences averaging ${avgSentenceWords} words.`, (avgSentenceWords - 18) / 10, quotable.filter((s) => wordCount(s) > 24 && wordCount(s) <= 40).slice(0, 1));
  if (casual >= 62) add("Conversational", `Friendly, spoken rhythm${contractionRate > 0.05 ? ` with contractions in ${pct(contractionRate)} of sentences` : ""}.`, (casual - 50) / 40, pick(CONTRACTION));
  if (casual <= 38) add("Polished & formal", `Measured, complete sentences at a grade-${gradeLevel} reading level.`, (50 - casual) / 40, quotable.filter((s) => wordCount(s) >= 12 && wordCount(s) <= 26).slice(0, 1));
  if (jargonPer100 >= 2.2) add("Technical", `Comfortable with specialist vocabulary (${jargonPer100} technical terms per 100 words).`, jargonPer100 / 5, pick(JARGON));
  if (numberRate >= 0.12) add("Evidence-led", `Backs claims with specifics — ${pct(numberRate)} of sentences cite a number.`, numberRate * 3, pick(/\d/));
  if (enthusiastic >= 60) add("Energetic", `Upbeat, high-intensity language (${superlativePer100} superlatives per 100 words).`, (enthusiastic - 45) / 40, pick(SUPERLATIVE));
  if (enthusiastic <= 35 && exclamationRate < 0.01) add("Confident & understated", "Makes claims plainly: no exclamation marks, few superlatives.", (45 - enthusiastic) / 30, shortest);
  if (imperativeHeadlineRate >= 0.25) add("Action-oriented", `${pct(imperativeHeadlineRate)} of headlines open with a verb.`, imperativeHeadlineRate * 2, heads.filter((h) => IMPERATIVE.has((h.split(/\s+/)[0] ?? "").toLowerCase())).slice(0, 2));
  if (funny >= 45 || irreverent >= 45) add("Playful", "Uses humour, exclamations or emoji to keep things light.", Math.max(funny, irreverent) / 60, pick(/!|\p{Extended_Pictographic}/u));
  const PURPOSE = /\b(planet|earth|climate|environment\w*|communit(y|ies)|society|humanity|activis\w+|nonprofit|sustainab\w+|our mission)\b/i;
  const purposeHits = sentences.filter((s) => PURPOSE.test(s)).length;
  if (purposeHits >= 3 && purposeHits / n >= 0.03) add("Purpose-driven", "Frames the brand around a bigger cause or community.", 0.4 + (purposeHits / n) * 4, pick(PURPOSE));
  traits.sort((a, b) => b.strength - a.strength);
  const top = traits.slice(0, 5);

  const dos: string[] = [];
  const donts: string[] = [];
  if (heads.length >= 3) {
    dos.push(`Keep headlines to about ${Math.max(3, Math.round(metrics.medianHeadlineWords))} words (site median).`);
    if (metrics.headlineCase === "sentence") dos.push("Write headlines in sentence case.");
    if (metrics.headlineCase === "title") dos.push("Write headlines in Title Case.");
    if (metrics.headlineCase === "upper") dos.push("Set short headlines in ALL CAPS.");
    if (headlinePeriodRate >= 0.4) dos.push(`End headlines with a full stop — ${pct(headlinePeriodRate)} of headlines do.`);
    else if (headlinePeriodRate <= 0.1) donts.push("Don't end headlines with a full stop.");
    if (imperativeHeadlineRate >= 0.25) dos.push("Lead headlines with a strong verb (Build, Get, Start…).");
  }
  if (youRate >= 0.2) dos.push(`Address the reader as "you" (${pct(youRate)} of sentences do).`);
  else if (weRate > youRate) dos.push('Speak as "we" when describing what the company does.');
  if (contractionRate >= 0.12) dos.push("Use contractions (you're, it's) to sound human.");
  else if (contractionRate < 0.03 && sentences.length >= 10) donts.push("Avoid contractions; keep sentences complete and polished.");
  if (exclamationRate < 0.01 && sentences.length >= 10) donts.push(`Avoid exclamation marks (${Math.round(exclamationRate * (n + heads.length))} found in ${n + heads.length} lines).`);
  if (numberRate >= 0.12) dos.push("Back claims with concrete numbers and outcomes.");
  if (superlativePer100 < 0.6 && sentences.length >= 10) donts.push("Don't oversell — superlatives (best, amazing) are rare in this voice.");
  if (jargonPer100 >= 2.2) dos.push("Use precise technical terms; the audience expects them.");
  else if (sentences.length >= 10) donts.push("Avoid technical jargon; keep language plain.");
  if (emojiRate === 0 && sentences.length >= 10) donts.push("Don't use emoji in brand copy.");
  dos.push(`Aim for a grade ${Math.max(5, Math.round(gradeLevel))} reading level (Flesch ${readingEase}).`);

  const poles = dimensions.map((d) => (d.value >= 60 ? d.right : d.value <= 40 ? d.left : null)).filter(Boolean).map((x) => x!.toLowerCase());
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
  const summary = top.length
    ? `${list(top.slice(0, 3).map((t, i) => (i ? t.name.toLowerCase() : t.name)))}${poles.length ? ` — ${list(poles)} in tone` : ""}.`
    : "Not enough copy on the site to characterise the voice.";

  return {
    summary,
    dimensions,
    traits: top,
    dos,
    donts,
    metrics,
    examples: {
      headlines: heads.slice(0, 6),
      sentences: quotable.filter((s) => wordCount(s) >= 6 && wordCount(s) <= 28).slice(0, 6),
    },
  };
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

function insufficient(sentences: string[], heads: string[]): Voice {
  const v = analyseVoiceUnchecked(sentences, heads);
  return { ...v, summary: "Not enough copy on the site to characterise the voice reliably.", traits: [], dos: [], donts: [] };
}
