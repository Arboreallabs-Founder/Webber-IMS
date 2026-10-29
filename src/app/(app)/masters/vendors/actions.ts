"use server";

import { upsertRecord, deleteRecord, type ActionResult } from "@/lib/server/crud";
import { getProfile, canManageUsers } from "@/lib/auth";

const VENDOR_FIELDS = {
  name: "string",
  gst_no: "string",
  pan: "string",
  contact: "string",
  email: "string",
  website: "string",
  address: "string",
  avg_lead_time_days: "number",
  rating: "number",
  is_active: "boolean",
} as const;

export async function upsert(fd: FormData): Promise<ActionResult> {
  // "Consumables vendor" is a full-Admin decision — only read it from their form.
  const fields = canManageUsers(await getProfile())
    ? { ...VENDOR_FIELDS, is_consumables_vendor: "boolean" as const }
    : VENDOR_FIELDS;
  return upsertRecord("vendors", fields, fd);
}
export async function remove(fd: FormData): Promise<ActionResult> {
  return deleteRecord("vendors", fd);
}

// ---- vendor_components (who supplies what) ----
const VC_FIELDS = {
  vendor_id: "string",
  component_id: "string",
  vendor_part_code: "string",
  price: "number",
  lead_time_days: "number",
} as const;

export async function upsertVendorComponent(fd: FormData): Promise<ActionResult> {
  return upsertRecord("vendor_components", VC_FIELDS, fd);
}
export async function removeVendorComponent(fd: FormData): Promise<ActionResult> {
  return deleteRecord("vendor_components", fd);
}
