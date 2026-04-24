import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const idx = t.indexOf("=");
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return out;
}

function decodeRole(token: string): string {
  try {
    const payload = token.split(".")[1] ?? "";
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const obj = JSON.parse(json) as { role?: string };
    return obj.role ?? "unknown";
  } catch {
    return "invalid_or_non_jwt";
  }
}

async function main() {
  const envRaw = await fs.readFile(".env", "utf8");
  const env = parseEnv(envRaw);

  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";

  console.log("NEXT_PUBLIC_SUPABASE_URL", url ? "set" : "missing");
  console.log("SUPABASE_SERVICE_ROLE_KEY", key ? "set" : "missing");
  if (key) console.log("decoded_role", decodeRole(key));

  if (!url || !key) return;

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sel = await supabase
    .from("eventos_processamentos")
    .select("id, competencia")
    .limit(1);

  console.log("select_error", sel.error?.message ?? "none");
  console.log("select_rows", sel.data?.length ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
