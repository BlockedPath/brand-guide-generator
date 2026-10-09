# Brand Guide Generator

Give it a company name or URL. It reads the live site and returns a **usable brand guide**: logo, colour palette, typography, UI components, tone of voice, key messaging and the brand's own published rules. The guide comes as a shareable HTML page plus structured JSON, W3C design tokens, CSS variables, a Tailwind preset and a Markdown brief.

Built on three TinyFish APIs. **Fetch** does the core extraction; **Search** and the **Browser API** support it.

> **How TinyFish is used, in brief:** TinyFish **Fetch** does the core extraction. It reads the homepage and up to 7 brand, about, product and pricing pages as clean Markdown, plus the page head's Open Graph and schema.org data. Every message, tone-of-voice finding, official brand rule, boilerplate line and asset download, and the declared logo, name and social profiles, comes from that text. **Search** turns a company name into its official site and finds the brand's own guideline, press-kit and values pages, which homepages rarely link to. The **Browser API** renders the homepage to measure what Fetch can't see, because Fetch strips styling: computed colours, the fonts Chrome actually drew, button styles and the header logo. It's also the fallback for JavaScript-only pages.

```bash
bun install
bun src/cli.ts stripe.com linear.app "Patagonia"     # → out/<domain>/brand.html + exports
bun src/server.ts                                     # → http://localhost:3000 (UI + API)
```

## Demo

Five brands are generated from scratch with no per-site code. Three are given as company names and resolved with Search; two as URLs. Each output is in [`demo/`](demo/): open `brand.html` in a browser.

| Brand | Input | Primary | Secondary / accents | Typeface | Tagline (verbatim) | Voice | Official brand material found |
| - | - | - | - | - | - | - | - |
| [Stripe](demo/stripe.com/brand.html) | `stripe.com` | `#533AFD` | `#FF6118` · `#B9B9F9`, `#00D66F`, `#7F7DFC` | Söhne (Klim Type Foundry) | Financial infrastructure to grow your revenue. | Action-oriented · Confident & understated · Technical | wordmark colour rule, logo kit + badge downloads, boilerplate |
| [Linear](demo/linear.app/brand.html) | `linear.app` | `#5E6AD2` (declared brand token) | — (monochrome UI) | Inter, Berkeley Mono | The product development system for teams and agents | Concise · Evidence-led | 7 rules, swatches "Mercury White" / "Nordic Gray", brand-asset zip |
| [Patagonia](demo/patagonia.com/brand.html) | `Patagonia` | `#000000` | `#1B2B79` | Ridgeway Sans | Made for the moment. Built for a lifetime. | Purpose-driven · Company-led · Evidence-led | official logo SVG (schema.org), 5 core values, press boilerplate, 7 social profiles |
| [Duolingo](demo/duolingo.com/brand.html) | `Duolingo` | `#58CC02` | `#1CB0F6` · `#042C60` | Duolingo Sans | The most fun way to learn languages, chess, and more! | Energetic · Playful · Company-led | values handbook and operating principles (its homepage is JS-only) |
| [Airbnb](demo/airbnb.com/brand.html) | `Airbnb` | `#FF385C` | — | Airbnb Cereal | Vacation rentals, cabins, beach houses, & more | Evidence-led · Purpose-driven · Company-led | 6 trademark rules (incl. the Rausch colour), boilerplate |

A few checks against what the brands publish:

- Stripe's blurple `#533AFD` is found and matched to its own design token `--hds-color-core-brand-600`.
- Duolingo's Feather Green `#58CC02` and Macaw `#1CB0F6` are both found.
- Airbnb's Rausch `#FF385C` is found, and its trademark page, read with Fetch, names it ("Do not feature Airbnb's distinctive Rausch color prominently…").
- Linear's brand page calls its primary colour "a subtle desaturated blue". The generator finds it as the site's declared `--color-brand-bg: #5E6AD2` and reads the page's Mercury White / Nordic Gray swatches.
- Patagonia's official logo comes from the schema.org Organization data in its page head.

## How TinyFish is used

Every call is logged in the guide's "How this was made" section and in `brand.json → sources.tinyfish`. A typical run makes 3 Fetch calls, 2–3 Search calls and 1 Browser session.

| API | Calls | What it extracts |
| - | - | - |
| **Fetch** (core) | **Pages:** homepage + up to 7 subpages as Markdown with links and image links. **Head:** the homepage in `html` + `include_html_head` mode. | **Messaging:** tagline, subheadline, positioning, boilerplate, value propositions, proof points, mission, values, CTA vocabulary, key terms, audiences. **Tone of voice:** every metric, trait and quoted example. **Official brand rules:** naming, logo, colour and usage sentences from the brand's own guideline and trademark pages, plus asset downloads (logo kits, badges) and stated colours. **Declared identity:** official logo (schema.org `logo`), name, social profiles, `og:image`, description. **Discovery:** the links that choose which subpages to read. Every call sets Fetch's `purpose` to the brand-guide goal. |
| **Search** | `"<name> official website"` when a name is given; on-domain queries for brand/press/logo pages and about/mission/values pages. | Turns a name into the official URL, skipping Wikipedia, LinkedIn and aggregators. Finds pages like `linear.app/brand`, `stripe.com/newsroom/information`, `airbnb.com/help/article/3233` (trademark guidelines), `patagonia.com/core-values` and Duolingo's values handbook. |
| **Browser** | 1 remote Chrome session over CDP | Visual measurements Fetch can't provide: colours from computed styles, weighted by painted area, text and CTAs; fonts confirmed by Chrome's `CSS.getPlatformFontsForNode` (which even reveals the foundry, e.g. Klim); the type scale; button styles; and the header logo as SVG/PNG. The same session also reads visual colour swatches on the brand page Search found, downloads the logo Fetch found when its CDN blocks plain requests, and supplies the copy when Fetch returns `empty_content` on a JavaScript-only homepage. |

What each part of the guide is built from:

| Guide section | Fetch | Search | Browser |
| - | :-: | :-: | :-: |
| Key messaging, proof points, mission, values | ● | ○ finds about/values pages | ○ CTA labels |
| Tone of voice | ● | ○ | — |
| Official brand rules, downloads, stated colours | ● | ○ finds brand pages | ○ visual swatches |
| Identity (name, declared logo, social, description) | ● | ○ name → URL | — |
| Logo | ● declared official logo | — | ● rendered header logo |
| Colours, typography, components | — | — | ● |

All three run in parallel. A full guide takes **~25–45 s** and costs about $0.002 in Browser minutes; Fetch and Search are within the free tier.

## Pipeline

```
input ──► Search: resolve name → official URL
            │
            ├─► Fetch homepage (Markdown) ───────────┐  copy, links
            ├─► Fetch homepage head (html+head) ─────┤  schema.org logo, name, social, og:image
            ├─► Search on-domain: brand/press, about ┘
            │            │
            │      pick ≤7 subpages ─► Fetch ─► messaging, voice, rules, downloads
            │
            └─► Browser (remote Chrome, CDP) ─► computed colours, fonts, buttons, header logo
                     └─► same session: brand-page swatches · official logo download · DOM copy fallback
                                   │
                   analyse ─► brand.json + brand.html + tokens.json/.css + tailwind.preset.js + brand.md
```

## What's in a guide

| Section | Source | Notes |
| - | - | - |
| **Logo** | Fetch + Browser | The official logo declared in the site's schema.org data (Fetch), when it publishes one, plus the header logo as rendered: scored by position, home-link and `alt`/`aria-label`/class, and saved as **SVG** (computed fills inlined, scripts stripped) and **PNG**. Also the favicon, app icon, social profiles and the logo kits on the brand's own pages. |
| **Colour** | Browser (+ Fetch/Browser on brand page) | Roles (primary, secondary, accents, background, surface, text, muted, border, neutrals). Each comes with its evidence ("fills 2 hero buttons", "logo colour", "47% of links"), the matching CSS tokens the site declares, and WCAG contrast pairings. When a site's interface is monochrome but it declares a brand token (Linear's `--color-brand-bg`), the token becomes the primary. Stated colours from brand pages are cross-checked against the palette. |
| **Typography** | Browser | Families by role, weights in use, source (Google, Adobe, self-hosted, system), foundry (read from the font's own metadata, e.g. *Klim Type Foundry*), a free Google Fonts stand-in for proprietary faces, and the full type scale (size, weight, line height, tracking). |
| **Components** | Browser | Primary and secondary CTAs reproduced from computed styles: fill, border, radius, padding, font and case. |
| **Voice & tone** | Fetch | Scored on the four [Nielsen Norman Group tone dimensions](https://www.nngroup.com/articles/tone-of-voice-dimensions/), with traits backed by verbatim example sentences and data-backed do/don't rules ("End headlines with a full stop: 43% of headlines do"). Deterministic and explainable: no LLM guessing. |
| **Messaging** | Fetch (+ Browser CTAs) | Tagline, subheadline, positioning statement, boilerplate ("Stripe is a technology company that…"), value propositions, proof points, mission, values, CTA vocabulary, key terms and audiences. All are quoted verbatim, with sources. |
| **Brand rules** | Search + Fetch | Guideline sentences from the brand's own brand/press pages (naming, logo, colour and usage rules), stated colours cross-checked against the extracted palette, and official asset downloads. |

## Outputs (reusable by other tools)

Every guide is written to `out/<domain>/`:

| File | For |
| - | - |
| `brand.html` | A self-contained page to share, present or print to PDF. Click a swatch to copy its hex. |
| `brand.json` | The full structured guide (`schema: "brand-guide/v1"`), including evidence and sources. |
| `tokens.json` | [W3C Design Tokens (DTCG)](https://tr.designtokens.org/format/): import into Figma via Tokens Studio, or use with Style Dictionary. |
| `tokens.css` | CSS custom properties (`--brand-primary`, `--font-heading`, `--text-h1-size`…). |
| `tailwind.preset.js` | Tailwind theme preset (`colors.brand.*`, `fontFamily.*`, `borderRadius.brand`). |
| `brand.md` | A compact brief for docs, slide notes or as LLM context ("write in this brand's voice"). |
| `logo.svg`, `logo.png`, `hero.jpg`, `display.png` | Captured assets. |

## API

```
GET /api/guide?q=linear.app[&refresh=1]    → brand guide JSON (+ links to every export)
GET /api/guide/stream?q=Patagonia          → Server-Sent Events: live progress, then links
GET /api/guides                            → previously generated guides
GET /g/<domain>/                           → HTML guide; /g/<domain>/tokens.json etc.
```

Guides are cached for 24h (`CACHE_HOURS`). Identical concurrent requests share one run, and at most 2 run at once.

## Setup

Needs [Bun](https://bun.sh) and a TinyFish API key from [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys):

```bash
bun install
export TINYFISH_API_KEY=...        # or run `tinyfish auth login`; its saved key is picked up automatically
bun src/cli.ts "Notion"            # CLI
bun src/server.ts                  # UI + API on :3000
bun test                           # unit tests for the extraction logic
```

Optional env vars: `PORT`, `OUT_DIR`, `CACHE_HOURS`, `MAX_SUBPAGES` (default 7), `BROWSER_COUNTRY` (default `US`).

## Accuracy and robustness

- **Measured, not guessed.** Colours come from computed styles of visible elements, so they're what users actually see. Fonts are confirmed by the renderer, not taken from CSS declarations. Copy is quoted verbatim.
- **Site chrome and other people's numbers are ignored.** Paragraphs repeated across pages (banners, footers) are dropped. Fixed overlays below the header (cookie, language and chat pop-ups) are excluded from colour measurement. Consent buttons are never treated as CTAs. Stats inside customer-story cards, and figures in sentences that aren't about the brand, aren't reported as its proof points. Content-marketing articles ("How to write a mission statement") aren't mistaken for the brand's own about page.
- **Works for any site.** There is no per-site code. The pipeline handles:
  - light and dark themes;
  - monochrome brands: a declared brand token, else the CTA or logo colour;
  - pseudo-element buttons;
  - JS-only sites, via the Browser-DOM fallback when Fetch is empty;
  - bot-protected logo CDNs, by downloading through the browser and checking the bytes are really an image.

  It also survives infrastructure hiccups: browser-session backoff, a DNS-cache workaround for brand-new session hosts, and a retry on a direct session if the proxy tunnel fails.
- **Safe output.** Everything taken from a site is HTML-escaped. Captured SVGs are stripped of scripts and event handlers and served with a restrictive CSP. File serving is allow-listed.

Known limits:

- Colour roles describe how the live site uses colour. A monochrome site with no declared brand token gets a neutral primary (Patagonia: black). Its accents, official swatches and guidance still appear alongside.
- Voice scoring needs a reasonable amount of copy. Sites with very little text get a low-confidence warning.
- Sites that block automated browsers may limit the visual tokens. The guide says so in its notes.

## Project layout

```
src/
  guide.ts        orchestration (Search ∥ Fetch ∥ Browser) → BrandGuide
  identity.ts     Open Graph + schema.org identity from the Fetch'd page head
  tinyfish.ts     TinyFish client wrapper; records every call
  resolve.ts      company name → official site (Search)
  discover.ts     subpage + brand-page selection
  visual.ts       Browser API session (CDP via playwright-core)
  visual-page.ts  in-page measurement: colours, fonts, buttons, logo, swatches, DOM copy
  palette.ts      colour roles, evidence, contrast
  typography.ts   families, sources, foundry, type scale
  messaging.ts    tagline, value props, proof points, mission, values, rules, downloads
  voice.ts        NN/g tone dimensions, traits, do/don't
  tokens.ts       DTCG / CSS / Tailwind exports
  render.ts       HTML guide
  server.ts, cli.ts, ui/
tests/            bun test
demo/             generated guides for five brands
```
