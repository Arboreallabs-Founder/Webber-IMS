"use server";

import type { ActionResult } from "@/lib/server/crud";
import { upsert as projectsUpsert, remove as projectsRemove } from "../projects/actions";

/**
 * Internal consumption records are project rows (`is_internal = true`) —
 * same BOM/shortfall/requisition machinery, just no customer. Force the
 * flag server-side so this form can never create (or edit into) a regular
 * customer project regardless of what the client sends.
 */
export async function upsert(fd: FormData): Promise<ActionResult> {
  fd.set("is_internal", "true");
  return projectsUpsert(fd);
}

export async function remove(fd: FormData): Promise<ActionResult> {
  return projectsRemove(fd);
}
