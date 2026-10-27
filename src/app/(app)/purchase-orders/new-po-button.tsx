"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/navigation-progress";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { createPO } from "./actions";

export function NewPoButton({
  vendors,
  defaultPoNo,
  consumables = false,
}: {
  vendors: { id: string; name: string }[];
  defaultPoNo: string;
  /** Raised from the Consumables module: marked Consumables, vendor required. */
  consumables?: boolean;
}) {
  const router = useRouter();
  const vendorItems = React.useMemo(() => vendors.map((v) => ({ value: v.id, label: v.name })), [vendors]);
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await createPO(new FormData(e.currentTarget));
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    setOpen(false);
    startNavProgress();
    if (res.id) router.push(`${consumables ? "/consumables" : "/purchase-orders"}/${res.id}`);
    else router.refresh();
  }

  return (
    <>
      <Button onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="size-4" /> New PO
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={consumables ? "New consumables PO" : "New purchase order"}>
        <form onSubmit={onSubmit} className="space-y-4">
          {consumables && <input type="hidden" name="is_consumables" value="1" />}
          <div className="space-y-1.5">
            <Label>PO No.</Label>
            <Input name="po_no" defaultValue={defaultPoNo} />
            <input type="hidden" name="suggested_po_no" value={defaultPoNo} />
            <p className="text-xs text-muted-foreground">
              Format YWSPL/YY-YY/NNNN (exactly 4 digits). Only an Admin can change the year.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>{consumables ? "Vendor" : "Vendor (optional)"}</Label>
            <Combobox items={vendorItems} defaultValue="" name="vendor_id" placeholder={consumables ? "— consumables vendor —" : "— decide later —"} required={consumables} />
          </div>
          <div className="space-y-1.5">
            <Label>PO date</Label>
            <Input name="po_date" type="date" />
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Create</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
