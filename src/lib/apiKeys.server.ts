// Server-only helpers for reading/writing API keys.
// Never import this from client code or *.functions.ts module scope.

export const API_KEY_NAMES = [
  "OPENAI_API_KEY",
  "TEXT_RU_USERKEY",
  "ZEROGPT_API_KEY",
  "TURGENEV_API_KEY",
  "TOPVISOR_API_KEY",
  "TOPVISOR_USER_ID",
  "MIRATEXT_API_KEY",
  "XMLRIVER_USER",
  "XMLRIVER_KEY",
] as const;

export type ApiKeyName = (typeof API_KEY_NAMES)[number];

/** DB override → env var. Returns undefined if neither is set. */
export async function getApiKey(name: ApiKeyName): Promise<string | undefined> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("api_keys")
      .select("value")
      .eq("name", name)
      .maybeSingle();
    if (data?.value) return data.value;
  } catch {
    // fall through to env
  }
  return process.env[name] ?? undefined;
}
