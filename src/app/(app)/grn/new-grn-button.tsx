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
import { createGrn } from "./actions";

export function NewGrnButton({
  vendors,
}: {
  vendors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const vendorItems = React.useMemo(() => vendors.map((v) => ({ value: v.id, label: v.name })), [vendors]);
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const challan = String(fd.get("challan_no") ?? "").trim();
    const invoice = String(fd.get("invoice_no") ?? "").trim();
    if (!challan && !invoice) {
      setError("Enter a challan number or an invoice number — at least one is required.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await createGrn(fd);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    setOpen(false);
    startNavProgress();
    if (res.id) router.push(`/grn/${res.id}`);
    else router.refresh();
  }

  return (
    <>
      <Button onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="size-4" /> New GRN
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New goods receipt"
        description="Every GRN is created open — attach each line to a project or PO as you receive it."
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Vendor (optional)</Label>
            <Combobox items={vendorItems} defaultValue="" name="vendor_id" placeholder="— none —" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Challan No.</Label>
              <Input name="challan_no" placeholder="supplier challan / DC no." />
            </div>
            <div className="space-y-1.5">
              <Label>Invoice No.</Label>
              <Input name="invoice_no" placeholder="supplier tax invoice no." />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            At least one of challan or invoice is required. If the invoice number is left blank, admin/team lead are notified.
          </p>
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
