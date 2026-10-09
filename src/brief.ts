import type { BrandGuide } from "./guide.ts";

// A compact Markdown brief: paste into a doc, a deck's speaker notes, or an LLM prompt as brand context.

export function markdownBrief(g: BrandGuide): string {
  const m = g.messaging;
  const out: string[] = [`# ${g.company.name} brand guide`, "", `Source: ${g.company.url} · generated ${g.generatedAt.slice(0, 10)}`, ""];
  if (m.tagline) out.push(`> ${m.tagline.text}`, "");
  if (m.boilerplate) out.push(m.boilerplate.text, "");
  else if (m.positioning) out.push(m.positioning.text, "");

  if (g.colors) {
    const p = g.colors;
    out.push("## Colours", "", "| Role | Hex | Name |", "| - | - | - |");
    const rows: [string, typeof p.primary | null][] = [["Primary", p.primary], ["Secondary", p.secondary], ...p.accents.map((a, i) => [`Accent ${i + 1}`, a] as [string, typeof a]), ["Background", p.background], ["Text", p.text], ["Muted text", p.muted]];
    for (const [role, c] of rows) if (c) out.push(`| ${role} | \`${c.hex}\` | ${c.name} |`);
    out.push("");
  }
  if (g.typography?.families.length) {
    out.push("## Typography", "");
    for (const f of g.typography.families) {
      out.push(`- **${f.displayName}** (${f.roles.join(", ")}) — ${f.source}${f.foundry ? `, ${f.foundry}` : ""}; weights ${f.weights.join(", ") || "n/a"}${f.substitute ? `; free substitute: ${f.substitute}` : ""}`);
    }
    out.push("");
  }
  out.push("## Voice", "", g.voice.summary, "");
  for (const t of g.voice.traits) out.push(`- **${t.name}:** ${t.description}${t.evidence[0] ? ` _e.g. “${t.evidence[0]}”_` : ""}`);
  if (g.voice.dos.length) out.push("", "**Do**", ...g.voice.dos.map((d) => `- ${d}`));
  if (g.voice.donts.length) out.push("", "**Don't**", ...g.voice.donts.map((d) => `- ${d}`));
  out.push("");

  out.push("## Messaging", "");
  if (m.valueProps.length) out.push("**Value propositions**", ...m.valueProps.map((v) => `- ${v.headline}${v.support ? ` — ${v.support}` : ""}`), "");
  if (m.proofPoints.length) out.push("**Proof points**", ...m.proofPoints.map((p) => `- **${p.stat}** ${p.label === p.stat ? "" : p.label}`.trimEnd()), "");
  if (m.mission.length) out.push("**Mission & beliefs**", ...m.mission.map((s) => `- ${s.text}`), "");
  if (m.values.length) out.push("**Values**", ...m.values.map((v) => `- **${v.name}:** ${v.description}`), "");
  if (m.ctas.length) out.push(`**Calls to action:** ${m.ctas.map((c) => c.text).join(" · ")}`, "");
  if (m.keyTerms.length) out.push(`**Key terms:** ${m.keyTerms.map((k) => k.term).join(", ")}`, "");

  if (g.brandRules.rules.length || g.brandRules.downloads.length) {
    out.push("## Official brand rules", "");
    for (const r of g.brandRules.rules) out.push(`- (${r.topic}) ${r.text}`);
    for (const d of g.brandRules.downloads) out.push(`- Download: [${d.label}](${d.url}) (${d.type})`);
    out.push("");
  }
  return out.join("\n");
}
