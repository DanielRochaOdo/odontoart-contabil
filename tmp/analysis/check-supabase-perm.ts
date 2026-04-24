import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

function decodeJwtRole(token: string): string {
  try {
    const payload = token.split(".")[1] ?? "";
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const obj = JSON.parse(json) as { role?: string };
    return obj.role ?? "unknown";
  } catch {
    return "invalid";
  }
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

async function main() {
  const envRaw = await fs.readFile(".env", "utf8");
  const env = parseEnv(envRaw);

  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("Supabase config missing in .env");
    return;
  }

  console.log("JWT role in configured key:", decodeJwtRole(key));

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sel = await supabase
    .from("eventos_processamentos")
    .select("id, competencia, criado_em")
    .order("criado_em", { ascending: false })
    .limit(1);

  console.log("select_error:", sel.error ? sel.error.message : "none");
  console.log("select_rows:", sel.data?.length ?? 0);

  const ins = await supabase.from("eventos_processamentos").insert({
    competencia: "2099-12",
    entrada_conhecidos: 0,
    entrada_liquidados: 0,
    conhecidos_classificados: 0,
    liquidados_classificados: 0,
    excluidos_kits: 0,
    excluidos_valor_zero: 0,
    lotes_adicionados_liquidado: 0,
    avisos: [],
    detalhes: {},
    criado_em: new Date().toISOString(),
  });

  console.log("insert_error:", ins.error ? ins.error.message : "none");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
