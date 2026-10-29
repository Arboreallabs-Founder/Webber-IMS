import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/server/read-all";

export type DocumentType = "po" | "grn" | "job_work";

export type SigningState = {
  requiredSlots: number[];
  signed: { slot: number; user_id: string; signed_at: string; signer_name: string | null; image_data_url: string }[];
  fullySigned: boolean;
  canSignNow: boolean;
  nextSlot: number | null;
  /** Name of whoever needs to sign next (the creator for slot 1, the configured approver otherwise) — so admins/creators can see exactly who a document is stuck on, not just that it's stuck. */
  nextSignerName: string | null;
  /** Whether the document can be printed right now — same as fullySigned, except grandfathered pre-launch GRNs stay printable even while unsigned. */
  printable: boolean;
  /** Slot 1 is missing but this document already moved on without it (grandfathered, or a PO/Job-Work already sent/dispatched before this feature existed) — the creator can still add it for the record via backfill_signature, with no status/dispatch effect. */
  isBackfill: boolean;
  /** How many required slots are still unsigned. Not `requiredSlots.length - signed.length`: a slot signed before its approver was removed is still on record but no longer required. */
  remainingCount: number;
  /** Every required slot in order — plus any slot signed before its approver was removed, so a past signature stays visible — whose it is and whether it's done, so a UI can name who a document is waiting on instead of only counting how many are missing. */
  slots: { slot: number; signerName: string | null; signedAt: string | null; isSigned: boolean }[];
};

/**
 * The moment the digital-signature feature went live. GRNs created before
 * this print without requiring a signature — there's no "already sent"
 * status to grandfather against, unlike PO/Job-Work, so printing would
 * otherwise become permanently blocked for old records whose creator may no
 * longer be reachable to sign them. The creator can still add their
 * signature after the fact (backfill_signature) — it just isn't required to
 * print.
 */
const SIGNATURE_FEATURE_LAUNCH = "2026-08-24T13:08:30Z";
const GRANDFATHERED_TYPES: DocumentType[] = ["grn"];

/** Server-side signing-chain state for one document — who's signed, who's next, and whether the current user can sign now. */
export async function getSigningState(
  documentType: DocumentType,
  documentId: string,
  creatorId: string | null,
  actorId: string | null,
  documentCreatedAt?: string | null,
): Promise<SigningState> {
  const grandfathered =
    !!documentCreatedAt &&
    GRANDFATHERED_TYPES.includes(documentType) &&
    new Date(documentCreatedAt) < new Date(SIGNATURE_FEATURE_LAUNCH);
  const supabase = await createClient();
  const [{ data: rights }, { data: sigsRaw }] = await Promise.all([
    supabase.from("approval_rights").select("approver_order, user_id").eq("document_type", documentType),
    supabase
      .from("document_signatures")
      .select("slot, user_id, signed_at, signature_image_data_url")
      .eq("document_type", documentType)
      .eq("document_id", documentId)
      .order("slot"),
  ]);

  const requiredSlots = [...new Set([1, ...(rights ?? []).map((r) => r.approver_order)])].sort((a, b) => a - b);
  const rightsByOrder = new Map((rights ?? []).map((r) => [r.approver_order, r.user_id]));

  const signedSlots = new Set((sigsRaw ?? []).map((s) => s.slot));
  const nextSlot = requiredSlots.find((s) => !signedSlots.has(s)) ?? null;
  const fullySigned = nextSlot === null;
  const nextSignerId = nextSlot === null ? null : nextSlot === 1 ? creatorId : rightsByOrder.get(nextSlot) ?? null;

  // Every slot's owner is resolved, not just the signed ones and the next —
  // a caller showing "who is this waiting on" needs a name for each remaining
  // slot, including ones further down the chain.
  const signerIds = [
    ...new Set(
      [
        ...(sigsRaw ?? []).map((s) => s.user_id),
        ...(nextSignerId ? [nextSignerId] : []),
        ...(creatorId ? [creatorId] : []),
        ...(rights ?? []).map((r) => r.user_id),
      ].filter((v): v is string => !!v),
    ),
  ];
  const { data: profiles } = signerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", signerIds)
    : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const signed = (sigsRaw ?? []).map((s) => ({
    slot: s.slot,
    user_id: s.user_id,
    signed_at: s.signed_at,
    signer_name: nameById.get(s.user_id) ?? null,
    image_data_url: s.signature_image_data_url,
  }));

  let canSignNow = false;
  if (nextSlot !== null && actorId) {
    canSignNow = nextSlot === 1 ? actorId === creatorId : actorId === rightsByOrder.get(nextSlot);
  }

  return {
    requiredSlots,
    signed,
    fullySigned,
    canSignNow,
    nextSlot,
    nextSignerName: nextSignerId ? nameById.get(nextSignerId) ?? null : null,
    printable: fullySigned || grandfathered,
    isBackfill: !fullySigned && grandfathered,
    remainingCount: requiredSlots.filter((s) => !signedSlots.has(s)).length,
    slots: [...new Set([...requiredSlots, ...signedSlots])].sort((a, b) => a - b).map((slot) => {
      const sig = (sigsRaw ?? []).find((s) => s.slot === slot);
      // Slot 1 always belongs to the document's creator; every other slot to
      // whoever is configured at that approver_order.
      const ownerId = slot === 1 ? creatorId : rightsByOrder.get(slot) ?? null;
      return {
        slot,
        signerName: nameById.get(sig?.user_id ?? ownerId ?? "") ?? null,
        signedAt: sig?.signed_at ?? null,
        isSigned: !!sig,
      };
    }),
  };
}

export type BatchSigningState = { fullySigned: boolean; canSignNow: boolean; nextSlot: number | null };

/**
 * The signing-chain arithmetic, over rows already in hand. Pure, so a caller
 * that has already fetched `approval_rights` and `document_signatures` in its
 * own first wave can reuse them instead of paying for another round trip —
 * which is how the Purchase Orders page builds its "needs my signature" tab
 * for free.
 *
 * `canSignNow` is deliberately chain-aware: only the *next* unsigned slot
 * counts, so a later approver doesn't see a document until the one before them
 * has signed. Slot 1 belongs to the document's creator, every other slot to the
 * user configured at that approver_order.
 */
export function computeSigningStates(
  docs: { id: string; created_by: string | null }[],
  rights: { approver_order: number; user_id: string }[],
  sigs: { document_id: string; slot: number }[],
  actorId: string | null,
): Map<string, BatchSigningState> {
  const result = new Map<string, BatchSigningState>();
  if (!actorId || docs.length === 0) return result;

  const requiredSlots = [...new Set([1, ...rights.map((r) => r.approver_order)])].sort((a, b) => a - b);
  const rightsByOrder = new Map(rights.map((r) => [r.approver_order, r.user_id]));

  const signedSlotsByDoc = new Map<string, Set<number>>();
  for (const s of sigs) {
    const set = signedSlotsByDoc.get(s.document_id) ?? new Set<number>();
    set.add(s.slot);
    signedSlotsByDoc.set(s.document_id, set);
  }

  for (const doc of docs) {
    const signedSlots = signedSlotsByDoc.get(doc.id) ?? new Set<number>();
    const nextSlot = requiredSlots.find((s) => !signedSlots.has(s)) ?? null;
    result.set(doc.id, {
      fullySigned: nextSlot === null,
      nextSlot,
      canSignNow:
        nextSlot !== null &&
        (nextSlot === 1 ? actorId === doc.created_by : actorId === rightsByOrder.get(nextSlot)),
    });
  }

  return result;
}

/**
 * Batched sibling of `getSigningState` for list views (e.g. a "pending
 * approval" tab) — one query on `approval_rights` + one on
 * `document_signatures` for the whole set, instead of a round trip per
 * document.
 */
export async function getSigningStatesBatch(
  documentType: DocumentType,
  docs: { id: string; created_by: string | null }[],
  actorId: string | null,
): Promise<Map<string, BatchSigningState>> {
  if (!actorId || docs.length === 0) return new Map();

  const supabase = await createClient();
  // All signatures of this type, paged, then narrowed in memory: listing every
  // document id in the URL fails past a few hundred ids, silently.
  const [{ data: rights }, allSigs] = await Promise.all([
    supabase.from("approval_rights").select("approver_order, user_id").eq("document_type", documentType),
    readAll((f, t) =>
      supabase.from("document_signatures").select("document_id, slot").eq("document_type", documentType).order("document_id").order("slot").range(f, t)),
  ]);
  const docIds = new Set(docs.map((d) => d.id));
  const sigsRaw = allSigs.filter((s) => docIds.has(s.document_id));

  return computeSigningStates(docs, rights ?? [], sigsRaw ?? [], actorId);
}
