import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getD1() {
  const { env } = getCloudflareContext();
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure it in wrangler.jsonc before using workspace persistence.",
    );
  }
  return env.DB;
}

export async function getDb() {
  return drizzle(await getD1(), { schema });
}
