// Parse TinyFish Fetch markdown into typed blocks and pull out "real copy" sentences.

export interface Block {
  type: "heading" | "para" | "item";
  level: number; // heading level; 0 for paragraphs and list items
  text: string; // plain text: links, emphasis and images stripped
}

export interface LinkText {
  text: string;
  href: string;
}

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

export function plain(md: string): string {
  return md
    .replace(ZERO_WIDTH, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,:;!?]|$)/g, "$1$2")
    .replace(/\*{2,}|_{2,}/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .replace(/([a-z]),\d\s/g, "$1, ")
    .replace(/\b(item|slide) \d+ of \d+:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function linkTexts(md: string): LinkText[] {
  const out: LinkText[] = [];
  for (const m of md.matchAll(/(?<!!)\[([^\]]{1,80})\]\(([^)\s]+)[^)]*\)/g)) {
    out.push({ text: plain(m[1]!), href: m[2]! });
  }
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      const text = plain(para.join(" "));
      if (text) blocks.push({ type: "para", level: 0, text });
      para = [];
    }
  };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const text = plain(h[2]!.replace(/#+\s*$/, ""));
      if (text) blocks.push({ type: "heading", level: h[1]!.length, text });
      continue;
    }
    const li = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const text = plain(li[1]!);
      if (text) blocks.push({ type: "item", level: 0, text });
      continue;
    }
    if (/^\s*\|/.test(line) || /^\s*[-=]{3,}\s*$/.test(line)) {
      flush();
      continue;
    }
    para.push(line.replace(/^\s*>\s?/, ""));
  }
  flush();
  return blocks;
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/([a-z]{2}[.!?])([A-Z][a-z])/g, "$1 $2")
    .split(/(?<=[.!?…])\s+(?=["“'(\[]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/\p{L}[\p{L}'’-]*\p{L}|\p{L}/gu) ?? [];
}

// Words that are almost always capitalised mid-sentence are proper nouns (people, places, partners).
export function properNouns(texts: string[]): Set<string> {
  const upper = new Map<string, number>();
  const total = new Map<string, number>();
  for (const t of texts) {
    const tokens = t.match(/\p{L}[\p{L}'’-]*/gu) ?? [];
    tokens.forEach((w, i) => {
      if (i === 0) return;
      const k = w.toLowerCase();
      total.set(k, (total.get(k) ?? 0) + 1);
      if (/^\p{Lu}/u.test(w)) upper.set(k, (upper.get(k) ?? 0) + 1);
    });
  }
  const out = new Set<string>();
  for (const [k, n] of total) if (n >= 1 && (upper.get(k) ?? 0) / n >= 0.8) out.add(k);
  return out;
}

const UI_NOISE = /\b[A-Z]{2,5}-\d{2,}|\d+\s?(min|mins|m|h|hr|hrs|d)\s?ago|just now|[·⋅…]|\.\.\.|©|all rights reserved|cookie|privacy policy|terms of (service|use)|javascript|sign in to|log in to|\bhttps?:\/\/|\b[a-z]+_[a-z_]+\b|[a-z]\d+\.\d/i;

// Marketing copy, not UI chrome: enough words, mostly letters, reads like a sentence.
export function isNoisy(text: string): boolean {
  return UI_NOISE.test(text);
}

export function isCopy(text: string): boolean {
  if (UI_NOISE.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 5 || words.length > 80) return false;
  const letters = (text.match(/[a-z]/gi) ?? []).length;
  if (letters / text.replace(/\s/g, "").length < 0.72) return false;
  const lower = words.filter((w) => /^[a-z]/.test(w)).length;
  return lower / words.length >= 0.35;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
