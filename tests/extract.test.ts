import { describe, expect, test } from "bun:test";
import { chroma, colorName, contrastRatio, deltaE, wcagLevel } from "../src/color.ts";
import { cleanUrl, kindOf, pickSubpages } from "../src/discover.ts";
import { brandGuidelinesPage, sanitizeSvg } from "../src/guide.ts";
import { isCopy, parseMarkdown, splitSentences } from "../src/markdown.ts";
import { bestStat, clauseAround, extractBrandRules, extractMessaging, stripChrome, toDoc } from "../src/messaging.ts";
import { buildPalette } from "../src/palette.ts";
import { brandName, looksLikeUrl, scoreCandidate } from "../src/resolve.ts";
import { analyseVoice } from "../src/voice.ts";
import type { ColorStat, PageVisual } from "../src/visual-page.ts";

describe("color", () => {
  test("contrast and WCAG levels", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(wcagLevel(contrastRatio("#533afd", "#ffffff"))).toBe("AA");
    expect(wcagLevel(contrastRatio("#e5e5e6", "#ffffff"))).toBe("Fail");
  });
  test("chroma separates greys from brand colours", () => {
    expect(chroma("#64748d")).toBeLessThan(18);
    expect(chroma("#533afd")).toBeGreaterThan(60);
    expect(deltaE("#08090a", "#090a0b")).toBeLessThan(1);
  });
  test("descriptive names", () => {
    expect(colorName("#ffffff")).toBe("White");
    expect(colorName("#061b31")).toBe("Deep Navy");
    expect(colorName("#58cc02")).toBe("Vivid Lime");
  });
});

describe("markdown", () => {
  const md = "# *Financial infrastructure to grow your revenue.* Accept payments,1 and more.\n\nGet startedSign up\n\n## The backbone of global commerce\n\n135+\n\ncurrencies and payment methods supported\n\n- [Read the story](https://x.com/a)\n";
  test("parses headings, paragraphs and list items with markup stripped", () => {
    const blocks = parseMarkdown(md);
    expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "Financial infrastructure to grow your revenue. Accept payments, and more." });
    expect(blocks.find((b) => b.type === "item")?.text).toBe("Read the story");
  });
  test("splits glued sentences and filters UI noise", () => {
    expect(splitSentences("Benchmark report.Learn what drives growth.")).toEqual(["Benchmark report.", "Learn what drives growth."]);
    expect(isCopy("Render UI before vehicle_state sync when minimum state is present.")).toBe(false);
    expect(isCopy("ENG-2647 Let guests access multiple teams at once")).toBe(false);
    expect(isCopy("Run your business on a reliable platform that adapts to your needs.")).toBe(true);
  });
});

describe("messaging", () => {
  test("picks the most impressive figure in a sentence", () => {
    expect(bestStat("As a founding member of 1% for the Planet, it has given more than $240 million to groups.")).toBe("more than $240 million");
    expect(bestStat("Founded in 2019, Linear powers over 40,000 product teams.")).toBe("over 40,000");
    expect(bestStat("Nothing measurable here.")).toBeNull();
    expect(clauseAround("Linear powers over 40,000 product teams.", "over 40,000")).toBe("Linear powers over 40,000 product teams.");
  });

  const home = toDoc(
    {
      url: "https://acme.test/",
      finalUrl: "https://acme.test/",
      title: "Acme | Rockets for everyone",
      description: "Acme builds reusable rockets for small teams.",
      language: "en",
      text: [
        "# Rockets for everyone. Launch in days, not years.",
        "## Built for small teams",
        "Ship payloads without a launch department and keep your team focused on the mission.",
        "99.9%",
        "successful launches since 2020",
        "[Get started](https://acme.test/signup) [Book a demo](https://acme.test/demo)",
        "Free shipping on all orders over $99 worldwide today",
      ].join("\n\n"),
      links: [],
      imageLinks: [],
    },
    "home",
  );
  const about = toDoc(
    {
      url: "https://acme.test/about",
      finalUrl: "https://acme.test/about",
      title: "About",
      description: null,
      language: "en",
      text: [
        "Acme is a space company that builds reusable rockets for small teams.",
        "Our mission is to make orbit as accessible as a delivery van.",
        "### Craft",
        "We sweat every weld because quality keeps people safe.",
        "Free shipping on all orders over $99 worldwide today",
      ].join("\n\n"),
      links: [],
      imageLinks: [],
    },
    "about",
  );

  test("extracts tagline, value props, proof points, mission, values and CTAs verbatim", () => {
    const m = extractMessaging(stripChrome([home, about]), "Acme", ["Get started"]);
    expect(m.tagline?.text).toBe("Rockets for everyone.");
    expect(m.subheadline?.text).toBe("Launch in days, not years.");
    expect(m.positioning?.text).toBe("Acme builds reusable rockets for small teams.");
    expect(m.valueProps[0]).toMatchObject({ headline: "Built for small teams" });
    expect(m.proofPoints[0]).toMatchObject({ stat: "99.9%", label: "successful launches since 2020" });
    expect(m.mission[0]?.text).toContain("Our mission is");
    expect(m.boilerplate?.text).toBe("Acme is a space company that builds reusable rockets for small teams.");
    expect(m.values[0]).toMatchObject({ name: "Craft" });
    expect(m.ctas.map((c) => c.text)).toContain("Get started");
    expect(m.ctas[0]).toEqual({ text: "Get started", count: 2 });
  });

  test("site chrome repeated across pages is removed", () => {
    const cleaned = stripChrome([home, about]);
    expect(cleaned.flatMap((d) => d.blocks).some((b) => b.text.startsWith("Free shipping"))).toBe(false);
  });

  test("brand rules come only from guideline sentences on brand pages", () => {
    const brand = toDoc(
      {
        url: "https://acme.test/brand",
        finalUrl: "https://acme.test/brand",
        title: "Brand",
        description: null,
        language: "en",
        text: "“Acme” is a single word, always spelled with a capital “A”.\n\nDo not alter the logo in any way.\n\nWe should stop shipping trucks that are 53 foot long.\n\n[Logo kit](https://cdn.acme.test/Acme_logo_kit.zip) [Team photo](https://cdn.acme.test/ceo_photo.png)",
        links: ["https://cdn.acme.test/Acme_logo_kit.zip"],
        imageLinks: ["https://cdn.acme.test/ceo_photo.png"],
      },
      "brand",
    );
    const r = extractBrandRules([brand], "Acme");
    expect(r.rules.map((x) => x.topic)).toEqual(["naming", "logo"]);
    expect(r.downloads.map((d) => d.label)).toEqual(["Acme logo kit"]);
  });
});

describe("voice", () => {
  test("scores a plain, you-focused voice and backs traits with quotes", () => {
    const sentences = [
      "Grow your business with tools that work together.",
      "You can accept payments in minutes.",
      "Your team gets one dashboard for everything.",
      "We built it to stay out of your way.",
      "Start with a single integration and scale when you need to.",
      "Payments arrive in your account the next day.",
    ];
    const v = analyseVoice(sentences, ["Get to market faster.", "Grow new lines of revenue.", "Built for every business."]);
    expect(v.traits.map((t) => t.name)).toContain("Customer-centric");
    expect(v.traits.find((t) => t.name === "Customer-centric")!.evidence.length).toBeGreaterThan(0);
    expect(v.metrics.headlinePeriodRate).toBe(1);
    expect(v.dos.some((d) => d.includes("full stop"))).toBe(true);
  });
  test("declines to characterise a voice from too little copy", () => {
    expect(analyseVoice(["One sentence only here."], []).traits).toEqual([]);
  });
});

describe("discovery & resolution", () => {
  test("unwraps Google redirect links and strips tracking", () => {
    expect(cleanUrl("/url?opi=1&q=https://linear.app/brand&sa=U")).toBe("https://linear.app/brand");
    expect(cleanUrl("https://www.patagonia.com/core-values/?srsltid=abc")).toBe("https://www.patagonia.com/core-values/");
  });
  test("classifies pages and picks the best one per kind", () => {
    expect(kindOf("https://linear.app/brand")).toBe("brand");
    expect(kindOf("https://press.stripe.com/")).toBeNull();
    const picks = pickSubpages(
      "https://acme.test/",
      ["https://acme.test/about", "https://acme.test/about/team/alice", "https://acme.test/pricing", "https://other.test/about"],
      {
        about: [
          { position: 1, title: "Our values: a letter from the CEO", url: "https://blog.acme.test/letter-from-ceo", snippet: "", site: "acme.test" },
          { position: 2, title: "How to write a mission statement for your startup | Acme", url: "https://acme.test/resources/mission-statement", snippet: "", site: "acme.test" },
        ],
      },
      7,
      "Acme",
    );
    expect(picks.map((p) => p.url)).toEqual(["https://blog.acme.test/letter-from-ceo", "https://acme.test/about", "https://acme.test/pricing"]);
    expect(brandGuidelinesPage(["https://acme.test/brand-assets"], [], "acme.test")).toBe("https://acme.test/brand-assets");
    const brandPicks = pickSubpages(
      "https://acme.test/",
      [],
      {
        brand: [
          { position: 1, title: "Trademark Guidelines - Acme Help Center", url: "https://acme.test/help/article/3233", snippet: "", site: "" },
          { position: 2, title: "How to start a brand | Acme", url: "https://acme.test/resources/start-a-brand", snippet: "", site: "" },
        ],
      },
      7,
      "Acme",
    );
    expect(brandPicks.map((p) => p.url)).toEqual(["https://acme.test/help/article/3233"]);
  });
  test("resolves names to official sites, not aggregators", () => {
    expect(looksLikeUrl("stripe.com")).toBe(true);
    expect(looksLikeUrl("Patagonia")).toBe(false);
    const hit = (position: number, url: string, title: string) => ({ position, url, title, snippet: "", site: "" });
    expect(scoreCandidate("Patagonia", hit(1, "https://en.wikipedia.org/wiki/Patagonia", "Patagonia - Wikipedia"))).toBe(-Infinity);
    expect(scoreCandidate("Patagonia", hit(2, "https://www.patagonia.com/", "Patagonia"))).toBeGreaterThan(10);
    expect(brandName("stripe.com", "Stripe", null, ["Stripe | Financial Infrastructure"], false)).toBe("Stripe");
  });
});

describe("palette", () => {
  const stat = (hex: string, s: Partial<ColorStat>): ColorStat => ({ hex, bgArea: 0, text: 0, border: 0, svg: 0, gradient: 0, button: 0, link: 0, heading: 0, ...s });
  const page = (colors: ColorStat[], buttons: PageVisual["buttons"], cssVars = [{ name: "--brand-primary", value: "#533afd", hex: "#533afd" }]): PageVisual =>
    ({
      url: "https://acme.test/",
      title: "Acme",
      viewport: { width: 1440, height: 900 },
      scannedHeight: 3600,
      elementsScanned: 500,
      pageBg: "#ffffff",
      colors,
      cssVars,
      buttons,
      type: [],
      families: [],
      textSizes: [],
      loadedFonts: [],
      fontResources: [],
      logo: null,
      meta: { themeColor: null, themeColorHex: null, ogImage: null, siteName: null, twitter: null, description: null, manifest: null, icons: [] },
    }) as PageVisual;
  const btn = (bg: string, y = 400) => ({ text: "Get started", kind: "filled" as const, y, bg, color: "#ffffff", borderColor: null, borderWidth: 0, radius: "4px", paddingX: 16, paddingY: 10, height: 40, fontFamily: "Inter", fontSize: 14, fontWeight: 600, textTransform: "none", letterSpacing: "normal", fixed: false });

  test("the CTA colour wins primary; greys become neutrals", () => {
    const p = buildPalette(
      page([stat("#ffffff", { bgArea: 5_000_000 }), stat("#061b31", { text: 4000, heading: 300 }), stat("#64748d", { text: 1500 }), stat("#533afd", { bgArea: 6000, button: 2, link: 40 }), stat("#00d66f", { bgArea: 500 })], [btn("#533afd")]),
      [],
    );
    expect(p.primary.hex).toBe("#533AFD");
    expect(p.primary.tokens).toContain("--brand-primary");
    expect(p.text.hex).toBe("#061B31");
    expect(p.background.hex).toBe("#FFFFFF");
    expect(p.isMonochrome).toBe(false);
  });
  test("monochrome brands take the CTA or logo colour as primary", () => {
    const p = buildPalette(page([stat("#ffffff", { bgArea: 5_000_000 }), stat("#000000", { text: 4000, bgArea: 20000 }), stat("#1b2b79", { bgArea: 400_000 })], [], []), ["#000000"]);
    expect(p.primary.hex).toBe("#000000");
    expect(p.isMonochrome).toBe(true);
    expect(p.accents.map((a) => a.hex)).toContain("#1B2B79");
  });
  test("a monochrome UI with a declared brand token uses the token as primary", () => {
    const vars = [
      { name: "--color-accent-hover", value: "#828fff", hex: "#828fff" },
      { name: "--color-brand-bg", value: "#5e6ad2", hex: "#5e6ad2" },
    ];
    const dark = { ...page([stat("#08090a", { bgArea: 5_000_000 }), stat("#f7f8f8", { text: 4000 }), stat("#e5e5e6", { bgArea: 4000, button: 1 })], [btn("#e5e5e6")], vars), pageBg: "#08090a" };
    const p = buildPalette(dark, []);
    expect(p.primary.hex).toBe("#5E6AD2");
    expect(p.primary.tokens).toContain("--color-brand-bg");
    expect(p.mode).toBe("dark");
    expect(p.neutrals.map((n) => n.hex)).toContain("#E5E5E6");
  });
});

test("third-party SVG logos are stripped of script", () => {
  const dirty = `<svg onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><path d="M0 0"/></a><foreignObject><div/></foreignObject></svg>`;
  const clean = sanitizeSvg(dirty);
  expect(clean).not.toMatch(/onload|<script|javascript:|foreignObject/i);
  expect(clean).toContain("<path");
});
