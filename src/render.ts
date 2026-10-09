import { contrastRatio, onColor, wcagLevel } from "./color.ts";
import type { BrandGuide, ButtonStyle } from "./guide.ts";
import type { PaletteColor } from "./palette.ts";

// Self-contained HTML brand guide. Everything from the target site is escaped; images are
// passed in as data URIs so the file can be shared on its own.

export interface RenderImages {
  officialLogo: string | null;
  logoSvg: string | null;
  logoPng: string | null;
  hero: string | null;
  display: string | null;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const safeUrl = (u: string | null | undefined) => (u && /^(https?:|data:image\/)/i.test(u) ? esc(u) : "#");

const hostOf = (u: string) => {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, "") + (x.pathname === "/" ? "" : x.pathname.replace(/\/$/, ""));
  } catch {
    return u;
  }
};

const fmtStack = (s: string) => esc(s.replace(/"/g, "'"));

function swatch(c: PaletteColor, label: string, big = false): string {
  return `<figure class="sw${big ? " big" : ""}">
  <button class="chip" style="background:${esc(c.hex)};color:${esc(c.onColor)}" data-copy="${esc(c.hex)}" title="Copy ${esc(c.hex)}">
    <span class="role">${esc(label)}</span><span class="hex">${esc(c.hex)}</span>
  </button>
  <figcaption>
    <strong>${esc(c.name)}</strong>
    <code>${esc(c.rgb)}</code><code>${esc(c.hsl)}</code>
    ${c.tokens.length ? `<span class="tok">${c.tokens.map((t) => `<code>${esc(t)}</code>`).join(" ")}</span>` : ""}
    ${c.evidence.length ? `<span class="ev">${esc(c.evidence.slice(0, 3).join(" · "))}</span>` : ""}
    <span class="badges"><b class="${wcagLevel(c.contrast.white) === "Fail" ? "fail" : ""}">White ${c.contrast.white}:1</b><b class="${wcagLevel(c.contrast.black) === "Fail" ? "fail" : ""}">Black ${c.contrast.black}:1</b></span>
  </figcaption>
</figure>`;
}

function buttonHtml(b: ButtonStyle, fallbackFont: string): string {
  const style = [
    `background:${b.background ?? "transparent"}`,
    `color:${b.color}`,
    b.borderColor && b.borderWidth ? `border:${b.borderWidth}px solid ${b.borderColor}` : "border:0",
    `border-radius:${b.radius}`,
    `padding:${b.paddingY}px ${b.paddingX}px`,
    `min-height:${b.height}px`,
    `font-family:'${b.fontFamily.replace(/'/g, "")}',${fallbackFont}`,
    `font-size:${b.fontSize}px`,
    `font-weight:${b.fontWeight}`,
    b.textTransform ? `text-transform:${b.textTransform}` : "",
    b.letterSpacing ? `letter-spacing:${b.letterSpacing}` : "",
  ]
    .filter(Boolean)
    .join(";");
  return `<span class="btn-demo" style="${esc(style)}">${esc(b.label)}</span>`;
}

function section(id: string, num: string, title: string, body: string, lede = ""): string {
  return `<section id="${id}"><header class="sh"><span class="num">${num}</span><h2>${esc(title)}</h2>${lede ? `<p class="lede">${lede}</p>` : ""}</header>${body}</section>`;
}

export function renderGuide(g: BrandGuide, img: RenderImages): string {
  const p = g.colors;
  const t = g.typography;
  const m = g.messaging;
  const v = g.voice;
  // The guide's own accent: the brand primary, unless it's too pale to read on white (e.g. off-white CTAs).
  const readable = p ? [p.primary, p.secondary, ...p.accents, p.mode === "dark" ? p.background : p.text].find((c) => c && contrastRatio(c.hex, "#ffffff") >= 3) : null;
  const accent = readable?.hex ?? "#4f46e5";
  const accentOn = onColor(accent);
  const headerLogo = img.logoSvg ?? img.logoPng ?? (g.logo.sourceUrl && /^https?:/.test(g.logo.sourceUrl) ? g.logo.sourceUrl : null);
  const officialSrc = img.officialLogo ?? g.logo.official?.url ?? null;
  const logoSrc = officialSrc ?? headerLogo;
  const logoBg = p ? (p.mode === "dark" ? p.background.hex : p.background.hex) : "#ffffff";
  const darkTile = p?.mode === "dark" ? p.background.hex : "#111111";
  const lightTile = p?.mode === "light" ? p.background.hex : "#ffffff";
  const fontLinks = [...new Set((t?.families ?? []).flatMap((f) => [f.googleFontsUrl, f.substitute ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.substitute).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap` : null]).filter(Boolean))] as string[];
  const famCss = (family: string) => {
    const f = t?.families.find((x) => x.family === family);
    if (!f) return `'${family.replace(/'/g, "")}', system-ui, sans-serif`;
    const real = f.googleFontsUrl ? `'${(f.googleFontsUrl.match(/family=([^:&]+)/)?.[1] ?? f.family).replace(/\+/g, " ")}', ` : "";
    return `${real}${f.stack.replace(/"/g, "'")}${f.substitute ? `, '${f.substitute}'` : ""}`;
  };
  const headingFam = t?.families.find((f) => f.roles.includes("heading"));
  const nav = [
    ["logo", "Logo"],
    ["colour", "Colour"],
    ["type", "Typography"],
    ["ui", "Components"],
    ["voice", "Voice"],
    ["messaging", "Messaging"],
    ["rules", "Brand rules"],
    ["export", "Export"],
    ["method", "Method"],
  ];

  // 01 Logo
  const tile = (src: string, bg: string, caption: string, cls = "", imgCls = "") =>
    `<figure class="tile-wrap"><div class="tile ${cls}" style="${bg ? `background:${esc(bg)}` : ""}"><img src="${safeUrl(src)}" alt="${esc(g.company.name)} logo" class="${imgCls}"></div><figcaption>${caption}</figcaption></figure>`;
  const logoTiles = logoSrc
    ? `<div class="logo-tiles">
        ${officialSrc ? tile(officialSrc, "#ffffff", "Official logo declared in the site's schema.org data · <b>Fetch</b>", "checker") : ""}
        ${headerLogo ? tile(headerLogo, logoBg, "As rendered in the site header · <b>Browser</b>") : ""}
        ${img.logoPng && img.logoSvg ? tile(img.logoSvg, p?.mode === "dark" ? lightTile : darkTile, "Reversed for the opposite background", "", p?.mode === "dark" ? "invert-dark" : "invert-light") : ""}
      </div>`
    : `<p class="muted">No logo was detected in the site header or declared in its metadata.</p>`;
  const logoMeta = `<div class="kv">
      ${g.logo.official?.file ? `<a class="pill" href="${esc(g.logo.official.file)}" download>Official logo (${esc(g.logo.official.file.split(".").pop()!.toUpperCase())})</a>` : g.logo.official ? `<a class="pill" href="${safeUrl(g.logo.official.url)}" target="_blank" rel="noopener">Official logo file</a>` : ""}
      ${g.logo.svgFile ? `<a class="pill${g.logo.official ? " ghost" : ""}" href="logo.svg" download>Header logo SVG</a>` : ""}
      ${g.logo.pngFile ? `<a class="pill ghost" href="logo.png" download>Header logo PNG</a>` : ""}
      ${g.logo.sourceUrl && g.logo.sourceUrl !== g.logo.official?.url ? `<a class="pill ghost" href="${safeUrl(g.logo.sourceUrl)}" target="_blank" rel="noopener">Source file</a>` : ""}
      ${g.logo.favicon ? `<span class="iconprev"><img src="${safeUrl(g.logo.favicon)}" alt="">favicon</span>` : ""}
      ${g.logo.appleTouchIcon ? `<span class="iconprev"><img src="${safeUrl(g.logo.appleTouchIcon)}" alt="">app icon</span>` : ""}
    </div>
    ${g.logo.colors.length ? `<p class="small">Logo colours: ${g.logo.colors.map((c) => `<span class="dot" style="background:${esc(c)}"></span><code>${esc(c)}</code>`).join(" ")}</p>` : ""}
    ${g.logo.width ? `<p class="small muted">Rendered at ${g.logo.width}×${g.logo.height}px in the site header${g.logo.alt ? ` · labelled “${esc(g.logo.alt)}”` : ""}.</p>` : ""}
    ${g.logo.officialFiles.length ? `<p class="small">Logo files published on the brand's own pages (Fetch): ${g.logo.officialFiles.map((u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${esc(decodeURIComponent(u.split("?")[0]!.split("/").pop() ?? u))}</a>`).join(" · ")}</p>` : ""}
    ${g.brandRules.rules.filter((r) => r.topic === "logo").length ? `<div class="callout"><strong>Official logo guidance</strong><ul>${g.brandRules.rules.filter((r) => r.topic === "logo").map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul></div>` : ""}`;

  // 02 Colour
  const colourBody = p
    ? `<div class="sw-row">${swatch(p.primary, "Primary", true)}${p.secondary ? swatch(p.secondary, "Secondary", true) : ""}${p.accents.map((a, i) => swatch(a, `Accent ${i + 1}`)).join("")}</div>
      ${p.isMonochrome ? `<p class="note">The site's interface is largely monochrome. ${esc((p.primary.evidence[0] ?? "").replace(/^./, (c) => c.toUpperCase()))}.</p>` : ""}
      <h3>Neutrals & UI</h3>
      <div class="neutrals">${p.neutrals
        .map((c) => {
          const role = c.hex === p.background.hex ? "Background" : c.hex === p.text.hex ? "Text" : c.hex === p.muted?.hex ? "Muted" : c.hex === p.surface?.hex ? "Surface" : c.hex === p.border?.hex ? "Border" : "";
          return `<button class="nchip" style="background:${esc(c.hex)};color:${esc(c.onColor)}" data-copy="${esc(c.hex)}"><span>${esc(role || c.name)}</span><code>${esc(c.hex)}</code></button>`;
        })
        .join("")}</div>
      <h3>Accessible pairings</h3>
      <table class="pairs"><thead><tr><th>Pairing</th><th>Sample</th><th>Contrast</th><th>WCAG</th></tr></thead><tbody>
      ${p.pairings.map((x) => `<tr><td>${esc(x.label)}</td><td><span class="pair" style="color:${esc(x.foreground)};background:${esc(x.background)}">Aa ${esc(x.foreground)}</span></td><td>${x.ratio}:1</td><td><b class="lvl ${x.level === "Fail" ? "fail" : ""}">${esc(x.level)}</b></td></tr>`).join("")}
      </tbody></table>
      ${g.brandRules.statedColors.length ? `<h3>Colours stated on the brand's own pages</h3><div class="stated">${g.brandRules.statedColors.map((c, i) => `<span><span class="dot" style="background:${esc(c.hex)}"></span><code>${esc(c.hex)}</code> ${esc(c.label ?? "")} ${g.brandRules.statedColorMatches[i]?.deltaE != null ? `<em>${(g.brandRules.statedColorMatches[i]!.deltaE ?? 99) < 5 ? "✓ matches extracted palette" : `nearest extracted ${esc(g.brandRules.statedColorMatches[i]!.nearest)} (ΔE ${g.brandRules.statedColorMatches[i]!.deltaE})`}</em>` : ""}</span>`).join("")}</div>` : ""}
      ${g.brandRules.rules.filter((r) => r.topic === "color").length ? `<div class="callout"><strong>Official colour guidance</strong><ul>${g.brandRules.rules.filter((r) => r.topic === "color").map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul></div>` : ""}`
    : `<p class="muted">Colours could not be measured because the browser render failed.</p>`;

  // 03 Typography
  const typeBody = t
    ? `<div class="fonts">${t.families
        .map(
          (f) => `<article class="font">
          <div class="spec" style="font-family:${fmtStack(famCss(f.family))}">Aa</div>
          <div>
            <p class="eyebrow">${esc(f.roles.join(" · "))}</p>
            <h3 style="font-family:${fmtStack(famCss(f.family))}">${esc(f.displayName)}</h3>
            <p class="small">${esc(f.source)}${f.foundry ? ` · ${esc(f.foundry)}` : ""}${f.isCustom ? " · custom web font" : ""}</p>
            <p class="small">Weights in use: ${esc(f.weights.join(", ") || "—")}</p>
            <p class="small"><code>font-family: ${esc(f.stack)}</code></p>
            ${f.substitute ? `<p class="small">Proprietary face — free stand-in for decks: <strong style="font-family:'${esc(f.substitute)}'">${esc(f.substitute)}</strong></p>` : ""}
            ${f.googleFontsUrl ? `<p class="small"><a href="${safeUrl(f.googleFontsUrl)}" target="_blank" rel="noopener">Available on Google Fonts ↗</a></p>` : ""}
          </div>
        </article>`,
        )
        .join("")}</div>
      ${img.display ? `<figure class="rendered"><img src="${safeUrl(img.display)}" alt="Hero headline as rendered on the live site"><figcaption>Hero headline as rendered on the live site${headingFam ? ` in ${esc(headingFam.displayName)}` : ""}.</figcaption></figure>` : ""}
      <h3>Type scale</h3>
      <table class="scale"><thead><tr><th>Style</th><th>Sample</th><th>Size</th><th>Weight</th><th>Line height</th><th>Tracking</th></tr></thead><tbody>
      ${t.scale
        .map(
          (s) => `<tr><td><strong>${esc(s.label)}</strong><br><span class="muted small">${esc(s.family)}</span></td>
          <td><span class="sample" style="font-family:${fmtStack(famCss(s.family))};font-size:${Math.min(s.sizePx, 56)}px;font-weight:${s.weight};${s.lineHeight ? `line-height:${s.lineHeight};` : ""}${s.letterSpacingEm ? `letter-spacing:${s.letterSpacingEm}em;` : ""}${s.transform ? `text-transform:${esc(s.transform)};` : ""}">${esc((s.sample || "The quick brown fox").slice(0, 48))}</span></td>
          <td>${s.sizePx}px<br><span class="muted small">${s.sizeRem}rem</span></td><td>${s.weight}</td><td>${s.lineHeight ?? "normal"}</td><td>${s.letterSpacingEm != null ? `${s.letterSpacingEm}em` : "—"}</td></tr>`,
        )
        .join("")}
      </tbody></table>`
    : `<p class="muted">Typography could not be measured because the browser render failed.</p>`;

  // 04 Components
  const c = g.components;
  const uiBody = c && (c.primaryButton || c.secondaryButton)
    ? `<div class="btn-row" style="background:${esc(p?.background.hex ?? "#fff")}">
        ${c.primaryButton ? `<div>${buttonHtml(c.primaryButton, famCss(c.primaryButton.fontFamily))}<p class="small" style="color:${esc(p?.text.hex ?? "#111")}">Primary</p></div>` : ""}
        ${c.secondaryButton ? `<div>${buttonHtml(c.secondaryButton, famCss(c.secondaryButton.fontFamily))}<p class="small" style="color:${esc(p?.text.hex ?? "#111")}">Secondary</p></div>` : ""}
      </div>
      <table class="spec-table"><tbody>
        ${[c.primaryButton, c.secondaryButton]
          .filter(Boolean)
          .map((b, i) => `<tr><th>${i === 0 && c.primaryButton ? "Primary" : "Secondary"}</th><td>bg <code>${esc(b!.background ?? "transparent")}</code> · text <code>${esc(b!.color)}</code>${b!.borderColor && b!.borderWidth ? ` · border ${b!.borderWidth}px <code>${esc(b!.borderColor)}</code>` : ""} · radius <code>${esc(b!.radius)}</code> · padding <code>${b!.paddingY}px ${b!.paddingX}px</code> · ${b!.fontSize}px/${b!.fontWeight}${b!.textTransform ? ` · ${esc(b!.textTransform)}` : ""}</td></tr>`)
          .join("")}
        ${c.radii.length ? `<tr><th>Radii in use</th><td>${c.radii.map((r) => `<code>${esc(r)}</code>`).join(" ")}</td></tr>` : ""}
      </tbody></table>`
    : `<p class="muted">No styled buttons were found above the fold.</p>`;

  // 05 Voice
  const voiceBody = `<p class="big-quote">${esc(v.summary)}</p>
    <div class="dims">${v.dimensions
      .map(
        (d) => `<div class="dim"><div class="dim-labels"><span>${esc(d.left)}</span><span>${esc(d.right)}</span></div><div class="track"><i style="left:${d.value}%"></i></div><p class="small muted">${esc(d.basis)}</p></div>`,
      )
      .join("")}</div>
    <div class="traits">${v.traits
      .map((tr) => `<article><h3>${esc(tr.name)}</h3><p>${esc(tr.description)}</p>${tr.evidence.map((e) => `<blockquote>“${esc(e)}”</blockquote>`).join("")}</article>`)
      .join("")}</div>
    <div class="dodont">
      <div><h3>Do</h3><ul>${v.dos.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div>
      <div><h3>Don't</h3><ul>${v.donts.map((d) => `<li>${esc(d)}</li>`).join("") || "<li class='muted'>No strong prohibitions detected.</li>"}</ul></div>
    </div>
    <details><summary>Voice metrics</summary><table class="spec-table"><tbody>
      <tr><th>Copy analysed</th><td>${v.metrics.sentences} sentences, ${v.metrics.headlines} headlines</td></tr>
      <tr><th>Avg sentence</th><td>${v.metrics.avgSentenceWords} words · median headline ${v.metrics.medianHeadlineWords} words</td></tr>
      <tr><th>Readability</th><td>Flesch ${v.metrics.readingEase} · grade ${v.metrics.gradeLevel}</td></tr>
      <tr><th>Address</th><td>“you” ${Math.round(v.metrics.youRate * 100)}% · “we” ${Math.round(v.metrics.weRate * 100)}% · contractions ${Math.round(v.metrics.contractionRate * 100)}%</td></tr>
      <tr><th>Headlines</th><td>${esc(v.metrics.headlineCase)} case · ${Math.round(v.metrics.headlinePeriodRate * 100)}% end with a full stop · ${Math.round(v.metrics.imperativeHeadlineRate * 100)}% start with a verb</td></tr>
      <tr><th>Intensity</th><td>${Math.round(v.metrics.exclamationRate * 100)}% exclamations · ${v.metrics.superlativePer100} superlatives/100 words · ${v.metrics.jargonPer100} technical terms/100 words</td></tr>
    </tbody></table></details>`;

  // 06 Messaging
  const msgBody = `<div class="tagline-card" style="background:${esc(accent)};color:${esc(accentOn)}">
      <p class="eyebrow">Tagline</p>
      <p class="tagline" style="font-family:${fmtStack(headingFam ? famCss(headingFam.family) : "inherit")}">${esc(m.tagline?.text ?? g.company.name)}</p>
      ${m.subheadline ? `<p class="sub">${esc(m.subheadline.text)}</p>` : ""}
    </div>
    ${m.slogans.length ? `<p class="small">Campaign lines: ${m.slogans.map((s) => `<strong>${esc(s.text)}</strong>`).join(" · ")}</p>` : ""}
    <div class="two">
      ${m.positioning ? `<div><h3>Positioning statement</h3><p>${esc(m.positioning.text)}</p></div>` : ""}
      ${m.boilerplate ? `<div><h3>Boilerplate</h3><p>${esc(m.boilerplate.text)}</p><p class="src">${esc(hostOf(m.boilerplate.source))}</p></div>` : ""}
    </div>
    ${m.valueProps.length ? `<h3>Value propositions</h3><div class="vps">${m.valueProps.map((x) => `<article><h4>${esc(x.headline)}</h4>${x.support ? `<p>${esc(x.support)}</p>` : ""}</article>`).join("")}</div>` : ""}
    ${m.proofPoints.length ? `<h3>Proof points</h3><div class="proof">${m.proofPoints.map((x) => `<article><b style="color:${esc(accent)}">${esc(x.stat)}</b><span>${esc(x.label === x.stat ? "" : x.label)}</span></article>`).join("")}</div>` : ""}
    ${m.mission.length ? `<h3>Mission & beliefs</h3>${m.mission.map((x) => `<blockquote>“${esc(x.text)}”<cite>${esc(hostOf(x.source))}</cite></blockquote>`).join("")}` : ""}
    ${m.values.length ? `<h3>Values</h3><div class="vps">${m.values.map((x) => `<article><h4>${esc(x.name)}</h4><p>${esc(x.description)}</p></article>`).join("")}</div>` : ""}
    <div class="three">
      ${m.ctas.length ? `<div><h3>Calls to action</h3><p>${m.ctas.map((x) => `<span class="tag">${esc(x.text)}</span>`).join("")}</p></div>` : ""}
      ${m.keyTerms.length ? `<div><h3>Key vocabulary</h3><p>${m.keyTerms.map((x) => `<span class="tag" title="${x.count} uses">${esc(x.term)}</span>`).join("")}</p></div>` : ""}
      ${m.audiences.length ? `<div><h3>Audience</h3><p>${m.audiences.map((x) => `<span class="tag">for ${esc(x.phrase)}</span>`).join("")}</p></div>` : ""}
    </div>`;

  // 07 Brand rules
  const r = g.brandRules;
  const rulesBody =
    r.rules.length || r.downloads.length
      ? `${r.rules.length ? `<ul class="rules">${r.rules.map((x) => `<li><span class="tag">${esc(x.topic)}</span>${esc(x.text)}<span class="src">${esc(hostOf(x.source))}</span></li>`).join("")}</ul>` : ""}
         ${r.downloads.length ? `<h3>Official downloads</h3><ul class="dl">${r.downloads.map((d) => `<li><a href="${safeUrl(d.url)}" target="_blank" rel="noopener">${esc(d.label)}</a> <span class="tag">${esc(d.type)}</span></li>`).join("")}</ul>` : ""}`
      : `<p class="muted">No public brand-guidelines or press-kit page was found on ${esc(g.company.domain)}.</p>`;

  // 08 Export
  const exportBody = `<div class="exports">
      <a href="brand.json" download><strong>brand.json</strong><span>Full structured guide (schema brand-guide/v1)</span></a>
      <a href="tokens.json" download><strong>tokens.json</strong><span>W3C design tokens — import into Figma Tokens Studio / Style Dictionary</span></a>
      <a href="tokens.css" download><strong>tokens.css</strong><span>CSS custom properties</span></a>
      <a href="tailwind.preset.js" download><strong>tailwind.preset.js</strong><span>Tailwind theme preset</span></a>
      <a href="brand.md" download><strong>brand.md</strong><span>Markdown brief for docs, decks and LLM prompts</span></a>
    </div>`;

  // 09 Method
  const callRows = g.sources.tinyfish
    .map((x) => `<tr><td><span class="ep ep-${esc(x.endpoint)}">${esc(x.endpoint)}</span></td><td>${esc(x.purpose)}</td><td class="small">${esc(x.detail)}</td><td>${x.ms.toLocaleString()} ms</td><td>${x.ok ? "✓" : `✗ ${esc(x.error ?? "")}`}</td></tr>`)
    .join("");
  const methodBody = `<p>Generated from the live site with three TinyFish APIs. <strong>Fetch</strong> does the core extraction: it read ${g.sources.pages.length} pages as clean Markdown, producing the messaging, tone of voice, official brand rules and downloads, plus the page head's Open Graph and schema.org identity (declared logo, name, social profiles). <strong>Search</strong> resolved the company and found its brand, press and about pages. The <strong>Browser API</strong> rendered the homepage in a remote Chrome to measure what Fetch can't see: computed colours, the fonts actually drawn, button styles and the header logo.</p>
    <table class="calls"><thead><tr><th>API</th><th>Purpose</th><th>Detail</th><th>Time</th><th></th></tr></thead><tbody>${callRows}</tbody></table>
    <h3>Pages read</h3><ul class="pages">${g.sources.pages.map((x) => `<li><span class="tag">${esc(x.kind)}</span><a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${esc(hostOf(x.url))}</a> <span class="muted small">${x.chars.toLocaleString()} chars · via ${esc(x.via)}</span></li>`).join("")}</ul>
    ${g.sources.failed.length ? `<p class="small muted">Could not read: ${g.sources.failed.map((f) => `${esc(hostOf(f.url))} (${esc(f.error)})`).join(", ")}</p>` : ""}
    ${g.sources.browser ? `<p class="small muted">Browser scan: ${g.sources.browser.elementsScanned.toLocaleString()} visible elements over the first ${g.sources.browser.scannedHeight.toLocaleString()}px at ${g.sources.browser.viewport.width}×${g.sources.browser.viewport.height}.</p>` : ""}
    ${g.warnings.length ? `<div class="callout warn"><strong>Notes</strong><ul>${g.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    ${img.hero ? `<figure class="hero-shot"><img src="${safeUrl(img.hero)}" alt="Homepage as rendered by the TinyFish browser"><figcaption>Homepage as rendered by the TinyFish browser.</figcaption></figure>` : ""}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(g.company.name)} Brand Guide</title>
<meta name="description" content="${esc(`Brand guide for ${g.company.name}, extracted from ${g.company.url}`)}">
${fontLinks.map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join("\n")}
<style>
:root{--accent:${esc(accent)};--on-accent:${esc(accentOn)};--ink:#14161a;--muted:#5d6470;--line:#e6e8ec;--soft:#f6f7f9;--bg:#ffffff}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.wrap{max-width:1120px;margin:0 auto;padding:0 28px}
.top{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;gap:18px;align-items:center;height:52px;overflow-x:auto;white-space:nowrap}
.top strong{margin-right:auto}
.top a{text-decoration:none;color:var(--muted);font-size:13px}
.top a:hover{color:var(--ink)}
.cover{padding:64px 0 40px;border-bottom:1px solid var(--line)}
.cover-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center}
.cover .logo-box{display:inline-flex;padding:18px 22px;border-radius:14px;background:${esc(logoBg)};border:1px solid var(--line);margin-bottom:22px}
.cover .logo-box img{height:40px;width:auto;max-width:220px;object-fit:contain}
.cover h1{font-size:44px;line-height:1.08;margin:0 0 12px;letter-spacing:-.02em}
.cover .tl{font-size:20px;color:var(--muted);margin:0 0 18px;max-width:34em}
.cover .meta{font-size:13px;color:var(--muted)}
.cover .shot{border-radius:12px;overflow:hidden;border:1px solid var(--line);box-shadow:0 20px 50px -20px rgba(0,0,0,.25)}
.cover .shot img{display:block;width:100%}
.strip{display:flex;height:10px;border-radius:6px;overflow:hidden;margin-top:22px}
.strip i{flex:1}
section{padding:56px 0;border-bottom:1px solid var(--line);break-inside:avoid-page}
.sh{margin-bottom:26px}
.num{font:600 12px/1 ui-monospace,Menlo,monospace;color:var(--accent);letter-spacing:.08em}
h2{font-size:30px;margin:6px 0 6px;letter-spacing:-.015em}
h3{font-size:15px;margin:30px 0 12px}
h4{margin:0 0 6px;font-size:15px}
.lede{color:var(--muted);margin:0;max-width:46em}
.muted{color:var(--muted)}
.small{font-size:13px}
.eyebrow{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;opacity:.75;margin:0 0 8px}
.logo-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:16px}
.tile-wrap{margin:0}.tile-wrap figcaption{font-size:12px;color:var(--muted);margin-top:6px}
.tile{height:170px;border-radius:12px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;padding:24px}
.tile img{max-width:80%;height:56px;width:auto;object-fit:contain}
.checker{background:repeating-conic-gradient(#f1f2f4 0 25%,#fff 0 50%) 0 0/16px 16px}
.invert-light{filter:brightness(0) invert(1)}
.invert-dark{filter:brightness(0)}
.kv{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0}
.pill{display:inline-block;padding:8px 14px;border-radius:999px;background:var(--accent);color:var(--on-accent);text-decoration:none;font-size:13px;font-weight:600}
.pill.ghost{background:var(--soft);color:var(--ink);border:1px solid var(--line)}
.iconprev{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.iconprev img{width:24px;height:24px;border-radius:6px;border:1px solid var(--line)}
.dot{display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:-2px;margin:0 4px 0 8px;border:1px solid rgba(0,0,0,.1)}
.callout{background:var(--soft);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:14px 18px;margin-top:18px;font-size:14px}
.callout ul{margin:8px 0 0;padding-left:18px}
.callout.warn{border-left-color:#d97706}
.note{font-size:13px;color:var(--muted);background:var(--soft);padding:10px 14px;border-radius:8px}
.sw-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px}
.sw{margin:0}
.chip{all:unset;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;height:120px;width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid rgba(0,0,0,.08)}
.sw.big .chip{height:170px}
.chip .role{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
.chip .hex{font:600 20px/1 ui-monospace,Menlo,monospace}
.sw figcaption{display:flex;flex-direction:column;gap:4px;padding-top:10px;font-size:13px}
.sw figcaption code{align-self:flex-start}
.tok code{font-size:11px}
.ev{color:var(--muted);font-size:12px}
.badges{display:flex;gap:6px}
.badges b,.lvl{font:600 11px/1 ui-monospace,Menlo,monospace;padding:4px 6px;border-radius:4px;background:#e8f6ee;color:#13653a}
.badges b.fail,.lvl.fail{background:#fdeceb;color:#a1261b}
.neutrals{display:flex;flex-wrap:wrap;border-radius:12px;overflow:hidden;border:1px solid var(--line)}
.nchip{all:unset;cursor:pointer;flex:1 1 120px;min-height:90px;padding:12px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;font-size:12px}
.nchip code{background:none;border:0;padding:0;color:inherit}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;color:var(--muted);font-weight:600}
.pair{display:inline-block;padding:6px 12px;border-radius:6px;font-weight:600;border:1px solid var(--line)}
.stated{display:flex;flex-wrap:wrap;gap:14px;font-size:13px}
.stated em{color:var(--muted)}
.fonts{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}
.font{display:grid;grid-template-columns:120px 1fr;gap:18px;border:1px solid var(--line);border-radius:12px;padding:18px}
.font .spec{font-size:84px;line-height:1;display:flex;align-items:center;justify-content:center;background:var(--soft);border-radius:10px}
.font h3{font-size:24px;margin:0 0 6px}
.font p{margin:2px 0}
.rendered{margin:22px 0 0;border:1px solid var(--line);border-radius:12px;padding:18px;background:${esc(p?.background.hex ?? "#fff")}}
.rendered img{max-width:100%;display:block}
.rendered figcaption{font-size:12px;color:${esc(p?.muted?.hex ?? "#5d6470")};margin-top:10px}
.scale .sample{display:block;max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn-row{display:flex;gap:28px;flex-wrap:wrap;padding:34px;border-radius:12px;border:1px solid var(--line);margin-bottom:16px}
.btn-demo{display:inline-flex;align-items:center;justify-content:center;line-height:1.2;box-sizing:border-box}
.spec-table th{width:170px}
.big-quote{font-size:22px;line-height:1.35;margin:0 0 26px;max-width:40em}
.dims{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px 32px;margin-bottom:10px}
.dim-labels{display:flex;justify-content:space-between;font-size:13px;font-weight:600}
.track{position:relative;height:6px;border-radius:3px;background:var(--line);margin:8px 0}
.track i{position:absolute;top:-5px;width:16px;height:16px;border-radius:50%;background:var(--accent);transform:translateX(-50%);border:2px solid #fff;box-shadow:0 0 0 1px var(--line)}
.traits{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-top:20px}
.traits article,.vps article{border:1px solid var(--line);border-radius:12px;padding:16px}
.traits h3{margin:0 0 6px}
.traits p,.vps p{margin:0;font-size:14px;color:var(--muted)}
blockquote{margin:10px 0 0;padding:8px 12px;border-left:3px solid var(--accent);background:var(--soft);border-radius:0 6px 6px 0;font-size:13px}
blockquote cite{display:block;font-style:normal;font-size:11px;color:var(--muted);margin-top:4px}
.dodont{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}
.dodont>div{border-radius:12px;padding:6px 18px 12px;background:#eef8f1}
.dodont>div+div{background:#fdf0ef}
.dodont ul{padding-left:18px;margin:0}
.dodont li{margin:6px 0;font-size:14px}
details{margin-top:18px}
summary{cursor:pointer;font-weight:600;font-size:14px}
.tagline-card{border-radius:16px;padding:34px 36px;margin-bottom:18px}
.tagline{font-size:34px;line-height:1.15;margin:0;letter-spacing:-.01em}
.tagline-card .sub{margin:12px 0 0;opacity:.9;font-size:16px;max-width:44em}
.two,.three{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px 28px}
.vps{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.proof{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.proof article{border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:6px}
.proof b{font-size:26px;letter-spacing:-.01em}
.proof span{font-size:13px;color:var(--muted)}
.tag{display:inline-block;font-size:12px;padding:3px 9px;border-radius:999px;background:var(--soft);border:1px solid var(--line);margin:0 6px 6px 0}
.src{display:block;font-size:11px;color:var(--muted)}
.rules{list-style:none;padding:0;margin:0}
.rules li{padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}
.dl{padding-left:18px}
.exports{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.exports a{display:flex;flex-direction:column;gap:4px;text-decoration:none;border:1px solid var(--line);border-radius:12px;padding:16px}
.exports a:hover{border-color:var(--accent)}
.exports span{font-size:13px;color:var(--muted)}
.calls td{font-size:13px}
.ep{font:600 11px/1 ui-monospace,Menlo,monospace;padding:4px 7px;border-radius:4px;text-transform:uppercase}
.ep-search{background:#e8f0fe;color:#1a56c4}.ep-fetch{background:#e8f6ee;color:#13653a}.ep-browser{background:#f3e8fd;color:#6b21a8}
.pages{list-style:none;padding:0}
.pages li{padding:6px 0}
.hero-shot{margin:24px 0 0}
.hero-shot img{width:100%;border-radius:12px;border:1px solid var(--line)}
.hero-shot figcaption{font-size:12px;color:var(--muted);margin-top:6px}
footer{padding:30px 0 60px;font-size:12px;color:var(--muted)}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.on{opacity:1}
@media (max-width:760px){.wrap{padding:0 16px}.cover-grid,.dodont{grid-template-columns:1fr}.cover h1{font-size:34px}.font{grid-template-columns:80px 1fr}.font .spec{font-size:56px}.scale .sample{max-width:180px}}
/* Motion: progressive enhancement (only when JS runs), disabled for reduced motion and print */
.cover-grid>*{animation:rise .9s cubic-bezier(.22,1,.36,1) both}.cover-grid>*:nth-child(2){animation-delay:.15s}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
.strip i{transform-origin:left;animation:grow .8s cubic-bezier(.22,1,.36,1) both;animation-delay:calc(var(--i,0)*60ms + .3s)}
@keyframes grow{from{transform:scaleX(0)}}
.js main section>*{opacity:0;transform:translateY(18px);transition:opacity .8s cubic-bezier(.22,1,.36,1),transform .8s cubic-bezier(.22,1,.36,1)}
.js main section>*.in{opacity:1;transform:none}
.js .track i{transition:left 1.2s cubic-bezier(.22,1,.36,1) .25s}
.chip,.nchip,.traits article,.vps article,.proof article,.font,.exports a,.tile{transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s,border-color .3s}
.chip:hover{transform:translateY(-4px);box-shadow:0 18px 32px -18px rgba(0,0,0,.45)}
.nchip:hover{transform:translateY(-3px)}
.traits article:hover,.vps article:hover,.proof article:hover,.font:hover,.tile:hover{transform:translateY(-3px);box-shadow:0 16px 34px -22px rgba(0,0,0,.35)}
.pill{transition:transform .25s,filter .25s}.pill:hover{transform:translateY(-1px);filter:brightness(1.08)}
.top a{position:relative;transition:color .2s}.top a::after{content:"";position:absolute;left:0;right:0;bottom:-6px;height:2px;border-radius:2px;background:var(--accent);transform:scaleX(0);transition:transform .3s}
.top a.active{color:var(--ink)}.top a.active::after{transform:scaleX(1)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.js main section>*{opacity:1;transform:none}}
@media print{.top{display:none}section{padding:28px 0;page-break-after:always}.cover{page-break-after:always}.js main section>*{opacity:1!important;transform:none!important}}
</style>
</head>
<body>
<nav class="top"><div class="wrap"><strong>${esc(g.company.name)}</strong>${nav.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("")}</div></nav>
<header class="cover"><div class="wrap cover-grid">
  <div>
    ${logoSrc ? `<div class="logo-box"><img src="${safeUrl(logoSrc)}" alt="${esc(g.company.name)}"></div>` : ""}
    <h1>${esc(g.company.name)} brand guide</h1>
    ${m.tagline ? `<p class="tl">${esc(m.tagline.text)}</p>` : ""}
    <p class="meta">Extracted from <a href="${safeUrl(g.company.url)}" target="_blank" rel="noopener">${esc(hostOf(g.company.url))}</a> · ${esc(new Date(g.generatedAt).toUTCString().slice(5, 16))} · ${g.sources.pages.length} pages read · powered by TinyFish</p>
    ${g.company.social.length ? `<p class="meta">${g.company.social.slice(0, 6).map((u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${esc(hostOf(u))}</a>`).join(" · ")}</p>` : ""}
    ${p ? `<div class="strip">${[p.primary, p.secondary, ...p.accents, ...p.neutrals].filter(Boolean).map((x, i) => `<i style="background:${esc(x!.hex)};--i:${i}" title="${esc(x!.hex)}"></i>`).join("")}</div>` : ""}
  </div>
  ${img.hero ? `<div class="shot"><img src="${safeUrl(img.hero)}" alt="${esc(g.company.name)} homepage"></div>` : ""}
</div></header>
<main class="wrap">
${section("logo", "01", "Logo", logoTiles + logoMeta, "The primary mark as it appears in the site header, captured as vector where available.")}
${section("colour", "02", "Colour", colourBody, "Measured from computed styles across the rendered homepage, weighted by painted area, text and calls to action. Click any swatch to copy.")}
${section("type", "03", "Typography", typeBody, "Typefaces confirmed by Chrome's own font report, with the live type scale.")}
${section("ui", "04", "Components", uiBody, "Call-to-action buttons reproduced from their computed styles.")}
${section("voice", "05", "Voice & tone", voiceBody, "Scored on the Nielsen Norman Group tone dimensions from the site's own copy, with verbatim evidence.")}
${section("messaging", "06", "Key messaging", msgBody, "Quoted verbatim from the live site.")}
${section("rules", "07", "Official brand rules", rulesBody, "Guidance the brand publishes about itself, found with TinyFish Search and read with Fetch.")}
${section("export", "08", "Export", exportBody, "Reusable files for design tools, codebases and AI workflows.")}
${section("method", "09", "How this was made", methodBody)}
</main>
<footer class="wrap">Generated ${esc(g.generatedAt)} by Brand Guide Generator using TinyFish Search, Fetch and Browser APIs. Brand assets belong to their owners.</footer>
<div class="toast" id="toast">Copied</div>
<script>
(function(){if(!("IntersectionObserver" in window))return;document.documentElement.classList.add("js");
var tracks=[].slice.call(document.querySelectorAll(".track i"));tracks.forEach(function(t){t.dataset.left=t.style.left;t.style.left="50%"});
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;e.target.classList.add("in");io.unobserve(e.target);[].forEach.call(e.target.querySelectorAll(".track i"),function(t){t.style.left=t.dataset.left})})},{threshold:.08});
[].forEach.call(document.querySelectorAll("main section>*"),function(el){io.observe(el)});
var links={};[].forEach.call(document.querySelectorAll(".top a[href^='#']"),function(a){links[a.getAttribute("href").slice(1)]=a});
var spy=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){for(var k in links)links[k].classList.remove("active");if(links[e.target.id])links[e.target.id].classList.add("active")}})},{rootMargin:"-45% 0px -50% 0px"});
[].forEach.call(document.querySelectorAll("main section[id]"),function(s){spy.observe(s)})})();
document.addEventListener("click",function(e){var b=e.target.closest("[data-copy]");if(!b)return;var v=b.getAttribute("data-copy");(navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).catch(function(){}).finally(function(){var t=document.getElementById("toast");t.textContent="Copied "+v;t.classList.add("on");setTimeout(function(){t.classList.remove("on")},1200)})});
</script>
</body>
</html>`;
}

