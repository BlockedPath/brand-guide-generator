// Env-driven config. Bun loads .env automatically.
import { homedir } from "node:os";
import { join } from "node:path";

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

// TINYFISH_API_KEY wins; otherwise reuse the key saved by `tinyfish auth login`.
async function tinyfishKey(): Promise<string | undefined> {
  const fromEnv = env("TINYFISH_API_KEY");
  if (fromEnv) return fromEnv;
  try {
    const cfg = await Bun.file(join(homedir(), ".tinyfish", "config.json")).json();
    return typeof cfg?.api_key === "string" ? cfg.api_key : undefined;
  } catch {
    return undefined;
  }
}

export const config = {
  tinyfishApiKey: await tinyfishKey(),
  port: Number(env("PORT", "3000")),
  outDir: env("OUT_DIR", "out")!,
  // Reuse a generated guide for this long before regenerating it.
  cacheHours: Number(env("CACHE_HOURS", "24")),
  // Max subpages (about, brand, pricing…) to read with Fetch in addition to the homepage.
  maxSubpages: Number(env("MAX_SUBPAGES", "7")),
  browserCountry: env("BROWSER_COUNTRY", "US")!,
};

export function requireKey(): string {
  if (!config.tinyfishApiKey) {
    throw new Error("No TinyFish API key. Set TINYFISH_API_KEY or run `tinyfish auth login`.");
  }
  return config.tinyfishApiKey;
}
