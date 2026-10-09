import { generateGuide } from "./guide.ts";
import { writeGuide } from "./store.ts";

// Usage: bun src/cli.ts stripe.com linear.app "Patagonia"
const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('Usage: bun src/cli.ts <url-or-company> [...more]');
  process.exit(1);
}

for (const input of inputs) {
  const t0 = performance.now();
  try {
    const { guide, assets } = await generateGuide(input, (e) => {
      const mark = e.status === "done" ? "✓" : e.status === "error" ? "✗" : "…";
      console.log(`  ${mark} [${e.step}] ${e.message}`);
    });
    const dir = await writeGuide(guide, assets);
    console.log(`${guide.company.name}: ${dir}/brand.html (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    for (const w of guide.warnings) console.log(`  ! ${w}`);
  } catch (err) {
    console.error(`${input}: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
