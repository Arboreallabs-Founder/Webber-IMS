import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { readAll } from "@/lib/server/read-all";
import type { Database } from "@/lib/database.types";

// Backstop only — every write path that changes these tables calls
// revalidateTag() explicitly (see src/lib/server/crud.ts). This just bounds
// how stale things could ever get if an invalidation path is ever missed.
const SAFETY_NET_REVALIDATE_SECONDS = 300;

type Vendor = Database["public"]["Tables"]["vendors"]["Row"];
type Customer = Database["public"]["Tables"]["customers"]["Row"];
type Category = Database["public"]["Tables"]["categories"]["Row"];
type Component = Database["public"]["Tables"]["components"]["Row"];

export const MASTER_TAGS = {
  vendors: "masters:vendors",
  customers: "masters:customers",
  categories: "masters:categories",
  componentsFull: "masters:components:full",
  componentsSafe: "masters:components:safe",
} as const;

const _getVendors = unstable_cache(
  async (): Promise<Vendor[]> => {
    const supabase = createCacheClient();
    const { data } = await supabase.from("vendors").select("*").order("name");
    return data ?? [];
  },
  ["masters-vendors"],
  { tags: [MASTER_TAGS.vendors], revalidate: SAFETY_NET_REVALIDATE_SECONDS },
);
// cache() on top of unstable_cache(): coalesces multiple calls within the
// same render into one in-flight fetch, on top of unstable_cache's
// cross-request persistence.
export const getVendors = cache(_getVendors);

const _getCustomers = unstable_cache(
  async (): Promise<Customer[]> => {
    const supabase = createCacheClient();
    const { data } = await supabase.from("customers").select("*").order("name");
    return data ?? [];
  },
  ["masters-customers"],
  { tags: [MASTER_TAGS.customers], revalidate: SAFETY_NET_REVALIDATE_SECONDS },
);
export const getCustomers = cache(_getCustomers);

const _getCategories = unstable_cache(
  async (): Promise<Category[]> => {
    const supabase = createCacheClient();
    const { data } = await supabase.from("categories").select("*").order("name");
    return data ?? [];
  },
  ["masters-categories"],
  { tags: [MASTER_TAGS.categories], revalidate: SAFETY_NET_REVALIDATE_SECONDS },
);
export const getCategories = cache(_getCategories);

// Two SEPARATE cache entries, separate tags, separate keys — never share an
// entry between the finance and non-finance variants, since `components`
// includes standard_cost/jw_rate and `v_components_safe` masks them.
const _getComponentsFull = unstable_cache(
  async (): Promise<Component[]> => {
    const supabase = createCacheClient();
    return readAll((f, t) => supabase.from("components").select("*").order("component_no").order("id").range(f, t));
  },
  ["masters-components-full"],
  { tags: [MASTER_TAGS.componentsFull], revalidate: SAFETY_NET_REVALIDATE_SECONDS },
);
export const getComponentsFull = cache(_getComponentsFull);

// Typed as Component[] (not the view's Row type) to match the codebase's
// existing convention of treating the safe view as the components table
// shape at the call site — the view is a strict column subset (financial
// columns omitted), so accessing those specific fields off a "safe" row
// would be a bug at the call site, same as before this cache was added.
const _getComponentsSafe = unstable_cache(
  async (): Promise<Component[]> => {
    const supabase = createCacheClient();
    const data = await readAll((f, t) => supabase.from("v_components_safe").select("*").order("component_no").order("id").range(f, t));
    return data as Component[];
  },
  ["masters-components-safe"],
  { tags: [MASTER_TAGS.componentsSafe], revalidate: SAFETY_NET_REVALIDATE_SECONDS },
);
export const getComponentsSafe = cache(_getComponentsSafe);

/** Role-safe entry point — callers pass `finance`, never touch the raw getters directly. */
export function getComponents(finance: boolean) {
  return finance ? getComponentsFull() : getComponentsSafe();
}
