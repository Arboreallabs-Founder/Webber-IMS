"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoveRight, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { transferLot, adjustLot, type ActionResult } from "../../actions";

export function LotActions({
  lotId,
  qtyOnHand,
  canManage,
  onDone,
}: {
  lotId: string;
  qtyOnHand: number;
  canManage: boolean;
  /** Called after a successful action (e.g. scan screen re-resolves the lot). */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(action: (fd: FormData) => Promise<ActionResult>, fd: FormData, key: string, onOk?: () => void) {
    setBusy(key); setError(null);
    fd.set("lot_id", lotId);
    const res = await action(fd);
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    onOk?.();
    if (onDone) onDone();
    else router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Stock-take */}
      <form onSubmit={(e) => { e.preventDefault(); run(adjustLot, new FormData(e.currentTarget), "adjust"); }}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
        <div className="w-32">
          <Label className="mb-1 block text-xs">Stock-take: actual qty</Label>
          <Input name="actual_qty" type="number" step="any" min="0" placeholder={String(qtyOnHand)} />
        </div>
        <Button type="submit" variant="secondary" loading={busy === "adjust"}><ClipboardCheck className="size-4" /> Adjust</Button>
        <span className="text-xs text-muted-foreground">Count the whole box, reserved parts included. Writes an adjustment movement for the difference.</span>
      </form>

      {/* Transfer */}
      {canManage && (
        <form onSubmit={(e) => { e.preventDefault(); run(transferLot, new FormData(e.currentTarget), "transfer"); }}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <div className="flex-1 min-w-[160px]">
            <Label className="mb-1 block text-xs">Transfer to location</Label>
            <Input name="location" placeholder="e.g. Store-A / Rack-3" />
          </div>
          <Button type="submit" variant="outline" loading={busy === "transfer"}><MoveRight className="size-4" /> Transfer</Button>
        </form>
      )}
    </div>
  );
}
