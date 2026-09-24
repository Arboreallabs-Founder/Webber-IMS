"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";

export type ActionResult = { ok?: true; error?: string; id?: string };

/** Admin-only, matching the `aright_mod` RLS policy exactly — the real backstop. */
export async function upsert(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (p?.role !== "admin") return { error: "Only Admin can configure approval rights." };

  const id = String(fd.get("id") ?? "") || null;
  const document_type = String(fd.get("document_type") ?? "");
  const approver_order = Number(fd.get("approver_order") ?? 0);
  const user_id = String(fd.get("user_id") ?? "");
  if (!["po", "grn"].includes(document_type)) return { error: "Pick a document type." };
  if (![2, 3].includes(approver_order)) return { error: "Pick a slot." };
  if (!user_id) return { error: "Pick an approver." };

  const supabase = await createClient();
  const payload = { document_type, approver_order, user_id, created_by: p.id };
  const resp = id
    ? await supabase.from("approval_rights").update(payload).eq("id", id).select("id").single()
    : await supabase.from("approval_rights").insert(payload).select("id").single();
  if (resp.error) {
    if (resp.error.code === "23505") return { error: "This document type already has an approver in that slot — edit or delete it instead." };
    return { error: resp.error.message };
  }
  revalidatePath("/masters/approval-rights");
  return { ok: true, id: resp.data?.id };
}

export async function remove(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (p?.role !== "admin") return { error: "Only Admin can configure approval rights." };
  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "Missing id." };
  const supabase = await createClient();
  const { error } = await supabase.from("approval_rights").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/masters/approval-rights");
  return { ok: true };
}
