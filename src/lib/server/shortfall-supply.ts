import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { readAllIn } from "./read-all";

/** Per short component: default supplier, vendors linked in Master Data, and rates to pre-fill. */
export type ShortfallSupply = {
  defaultVendorId: string | null;
  linkedVendorIds: string[];
  lastRateByVendor: Record<string, number>;
  priceByVendor: Record<string, number>;
  /** Newest approved PO rate from any vendor. */
  latestRate: number | null;
};

/**
 * What the Raise PO popup needs for each short component: its default supplier
 * (Master Data raw supplier), the vendors linked to it, their Master Data
 * price, and the newest approved PO rate per vendor. Rates only when the role
 * may see prices.
 */
export async function loadShortfallSupply(
  supabase: Awaited<ReturnType<typeof createClient>>,
  defaultVendorByComponent: Map<string, string | null>,
  canPrice: boolean,
): Promise<Record<string, ShortfallSupply>> {
  const ids = [...defaultVendorByComponent.keys()];
  const supply: Record<string, ShortfallSupply> = {};
  if (ids.length === 0) return supply;
  for (const cid of ids) {
    supply[cid] = { defaultVendorId: defaultVendorByComponent.get(cid) ?? null, linkedVendorIds: [], lastRateByVendor: {}, priceByVendor: {}, latestRate: null };
  }
  const [links, rates] = await Promise.all([
    readAllIn(ids, (chunk, f, t) =>
      supabase.from("vendor_components").select("component_id, vendor_id, price").in("component_id", chunk).order("id").range(f, t)),
    canPrice
      ? readAllIn(ids, (chunk, f, t) =>
          supabase.from("po_lines")
            .select("component_id, rate, approved_at, created_at, purchase_orders(vendor_id)")
            .in("component_id", chunk)
            .eq("approval_status", "approved")
            .not("rate", "is", null)
            .order("id")
            .range(f, t))
      : Promise.resolve([]),
  ]);
  for (const l of links) {
    const s = supply[l.component_id];
    if (!s) continue;
    s.linkedVendorIds.push(l.vendor_id);
    if (canPrice && l.price != null) s.priceByVendor[l.vendor_id] = Number(l.price);
  }
  // Newest approved rate per component + vendor.
  const rateTime = (r: { approved_at: string | null; created_at: string }) => r.approved_at ?? r.created_at;
  for (const r of [...rates].sort((a, b) => rateTime(b).localeCompare(rateTime(a)))) {
    const po = r.purchase_orders as unknown as { vendor_id: string | null } | { vendor_id: string | null }[] | null;
    const vendorId = Array.isArray(po) ? po[0]?.vendor_id : po?.vendor_id;
    const s = r.component_id ? supply[r.component_id] : undefined;
    if (!s) continue;
    if (s.latestRate === null) s.latestRate = Number(r.rate);
    if (!vendorId || s.lastRateByVendor[vendorId] !== undefined) continue;
    s.lastRateByVendor[vendorId] = Number(r.rate);
  }
  return supply;
}
