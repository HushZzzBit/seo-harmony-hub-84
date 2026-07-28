import { createServerFn } from "@tanstack/react-start";
import { API_KEY_NAMES, type ApiKeyName } from "./apiKeys.server";

export type ApiKeyStatus = {
  name: ApiKeyName;
  hasValue: boolean;
  source: "db" | "env" | "none";
  updatedAt: string | null;
  preview: string | null;
};

function mask(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 8) return "•".repeat(Math.max(0, s.length - 2)) + s.slice(-2);
  return s.slice(0, 4) + "…" + s.slice(-4);
}

export const listApiKeys = createServerFn({ method: "GET" }).handler(
  async (): Promise<ApiKeyStatus[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("api_keys").select("name,value,updated_at");
    const byName = new Map<string, { value: string; updated_at: string }>();
    for (const row of data ?? []) byName.set(row.name, { value: row.value, updated_at: row.updated_at });

    return API_KEY_NAMES.map((name) => {
      const row = byName.get(name);
      if (row?.value) {
        return {
          name,
          hasValue: true,
          source: "db" as const,
          updatedAt: row.updated_at,
          preview: mask(row.value),
        };
      }
      const envVal = process.env[name];
      if (envVal) {
        return {
          name,
          hasValue: true,
          source: "env" as const,
          updatedAt: null,
          preview: mask(envVal),
        };
      }
      return { name, hasValue: false, source: "none" as const, updatedAt: null, preview: null };
    });
  },
);

export const setApiKey = createServerFn({ method: "POST" })
  .inputValidator((data: { name: ApiKeyName; value: string }) => {
    if (!API_KEY_NAMES.includes(data.name)) throw new Error("Unknown key");
    if (typeof data.value !== "string" || !data.value.trim()) throw new Error("Empty value");
    return { name: data.name, value: data.value.trim() };
  })
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("api_keys").upsert(
      { name: data.name, value: data.value, updated_at: new Date().toISOString() },
      { onConflict: "name" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteApiKey = createServerFn({ method: "POST" })
  .inputValidator((data: { name: ApiKeyName }) => {
    if (!API_KEY_NAMES.includes(data.name)) throw new Error("Unknown key");
    return { name: data.name };
  })
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("api_keys").delete().eq("name", data.name);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
