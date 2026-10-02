"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unissueLot } from "../actions";

export function UnissueLotButton({ lotId, componentId, qtyOnHand }: { lotId: string; componentId: string; qtyOnHand: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick() {
    // Blank = all. Cancel returns null.
    const answer = prompt(`Unissue how many? (${qtyOnHand} reserved — leave blank for all)`, "");
    if (answer === null) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("lot_id", lotId);
    fd.set("component_id", componentId);
    fd.set("qty", answer.trim());
    const res = await unissueLot(fd);
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    router.refresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        loading={busy}
        onClick={handleClick}
        title="Unissue — return to open stock"
        className="text-amber-600 hover:text-amber-800"
      >
        <LockOpen className="size-4" />
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </>
  );
}
