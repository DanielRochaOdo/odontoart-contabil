import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "VITE_SUPABASE_URL",
] as const;

const SUPABASE_SERVICE_ROLE_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_SERVICE_ROLE_KEY",
] as const;

function parseJwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const json = JSON.parse(decoded) as { role?: string };
    return json.role ?? null;
  } catch {
    return null;
  }
}

function isServerPrivilegedKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const role = parseJwtRole(key);
  return role === "service_role";
}

function readFirstNonEmptyEnv(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function getSupabaseServerClient(): SupabaseClient | null {
  const url = readFirstNonEmptyEnv(SUPABASE_URL_KEYS);
  const serviceRole = readFirstNonEmptyEnv(SUPABASE_SERVICE_ROLE_KEYS);

  if (!url || !serviceRole || !isServerPrivilegedKey(serviceRole)) {
    return null;
  }

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
