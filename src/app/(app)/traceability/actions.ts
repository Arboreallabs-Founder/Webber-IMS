"use server";

import { createClient } from "@/lib/supabase/server";
import { getLotTraceability } from "@/lib/server/traceability";

export type ActionResult = { ok?: true; error?: string; data?: unknown; redirect?: string };

/**
 * Scanner entry point. The fetch itself lives in `@/lib/server/traceability` so
 * the `[lotCode]` route can share it without going through a server action.
 *
 * The try/catch belongs here rather than in the helper: the scanner shows errors
 * as inline text beside the camera, whereas the route wants a thrown error to
 * reach `error.tsx`.
 */
export async function lookupTraceability(lotCode: string): Promise<ActionResult> {
  if (!lotCode.trim()) return { error: "Enter or scan a lot code." };
  // A finished good's QR carries its serial (FG/26-27/0003) — open its page instead.
  if (/^FG\//i.test(lotCode.trim())) {
    const supabase = await createClient();
    const { data: fg } = await supabase.from("finished_goods").select("id").eq("serial_no", lotCode.trim().toUpperCase()).maybeSingle();
    return fg ? { ok: true, redirect: `/finished-goods/${fg.id}` } : { error: "Finished good not found" };
  }
  try {
    const data = await getLotTraceability(lotCode);
    return data ? { ok: true, data } : { error: "Lot not found" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Lookup failed." };
  }
}
