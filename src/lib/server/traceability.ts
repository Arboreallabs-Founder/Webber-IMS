import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials } from "@/lib/auth";
import type { Traceability } from "@/lib/traceability";

export type { Traceability } from "@/lib/traceability";

/**
 * Full history of one lot — lineage, PO, GRN, job work, inspection, movements.
 *
 * Returns `null` when the lot genuinely doesn't exist, and *throws* when the
 * query itself fails. Callers rely on that split: the route turns `null` into
 * `notFound()` and lets a throw reach `error.tsx`. Collapsing the two would tell
 * someone their lot doesn't exist because the database hiccupped.
 *
 * Financial fields are stripped here rather than hidden at render time, so the
 * numbers never leave the server for a role that may not see them. Hiding them
 * in the UI alone would still ship them inside the scanner action's JSON.
 */
export async function getLotTraceability(lotCode: string): Promise<Traceability | null> {
  const profile = await getProfile();
  if (!profile) return null;

  const code = lotCode.trim();
  if (!code) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_lot_traceability", { p_lot_code: code });
  if (error) throw new Error(`get_lot_traceability(${code}): ${error.message}`);

  const res = data as unknown as (Traceability & { error?: string }) | null;
  if (!res || res.error) return null;

  // The RPC returns only `component_id`; the screen shows the number and name.
  if (res.lot?.component_id) {
    const { data: comp } = await supabase
      .from("components")
      .select("component_no, name")
      .eq("id", res.lot.component_id)
      .maybeSingle();
    if (comp) {
      res.lot.component_no = comp.component_no;
      res.lot.component_name = comp.name;
    }
  }

  if (!canSeeFinancials(profile.role)) {
    res.lot.unit_cost = null;
    if (res.purchase_order) res.purchase_order.rate = null;
  } else if (res.lot?.id) {
    // Unit cost is the PO rate; the GRN-typed rate is discontinued.
    const { data: r } = await supabase.from("v_lot_rates").select("rate").eq("lot_id", res.lot.id).maybeSingle();
    res.lot.unit_cost = r?.rate ?? null;
  }

  return res;
}
