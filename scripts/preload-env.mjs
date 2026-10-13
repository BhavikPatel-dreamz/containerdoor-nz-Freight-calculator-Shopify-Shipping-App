import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

function applicationUrlFromToml() {
  try {
    const text = readFileSync(resolve(process.cwd(), "shopify.app.toml"), "utf8");
    const match = text.match(/^application_url\s*=\s*"([^"]+)"/m);
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

if (!process.env.SHOPIFY_APP_URL) {
  const fallback =
    process.env.APP_URL ||
    process.env.APPLICATION_URL ||
    process.env.HOST ||
    applicationUrlFromToml();
  if (fallback) {
    process.env.SHOPIFY_APP_URL = fallback.replace(/\/$/, "");
  }
}
