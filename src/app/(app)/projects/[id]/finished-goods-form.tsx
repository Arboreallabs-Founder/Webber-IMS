"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import type { ActionResult } from "../../finished-goods/actions";

type LineItem = { id: string; product_label: string; variant_text: string; quantity: number };
type Product = { id: string; label: string };

export function FinishedGoodsForm({
  projectId,
  bomApproved,
  hasConsumption,
  lineItems,
  products,
  action,
}: {
  projectId: string;
  bomApproved: boolean;
  hasConsumption: boolean;
  lineItems: LineItem[];
  products: Product[];
  action: (fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [source, setSource] = React.useState<"product" | "custom">("product");

  const hasLineItems = lineItems.length > 0;
  const lineItemItems = React.useMemo(
    () => lineItems.map((li) => ({ value: li.id, label: `${li.product_label}${li.variant_text ? ` (${li.variant_text})` : ""} — ${li.quantity} ordered` })),
    [lineItems]
  );
  const productItems = React.useMemo(() => products.map((p) => ({ value: p.id, label: p.label })), [products]);

  if (!bomApproved) {
    return <p className="text-sm text-muted-foreground">Approve the BOM first — finished goods are logged against an approved BOM.</p>;
  }
  if (!hasConsumption) {
    return <p className="text-sm text-muted-foreground">Nothing has been issued/consumed on this project yet — there&apos;s nothing to complete into a finished good.</p>;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    setMessage(null);
    const fd = new FormData(form);
    fd.set("project_id", projectId);
    if (!hasLineItems) fd.set("source", source);
    const res = await action(fd);
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    setMessage(res.message ?? "Logged.");
    form.reset();
    setSource("product");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="size-4 shrink-0" /> {message}
        </div>
      )}

      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {hasLineItems ? (
          <div className="space-y-1.5 lg:col-span-3">
            <Label>Line item</Label>
            <Combobox items={lineItemItems} defaultValue="" name="project_line_item_id" placeholder="— which line item —" required />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Product</Label>
              <Select value={source} onChange={(e) => setSource(e.target.value as "product" | "custom")}>
                <option value="product">Existing product</option>
                <option value="custom">Custom name</option>
              </Select>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label>&nbsp;</Label>
              {source === "product" ? (
                <Combobox items={productItems} defaultValue="" name="product_id" placeholder="— product —" required />
              ) : (
                <Input name="custom_name" placeholder="e.g. Custom bracket assembly" required />
              )}
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label>Quantity</Label>
          <Input name="quantity" type="number" step="1" min="1" required defaultValue="1" />
        </div>
        <div className="flex items-end lg:col-span-4">
          <Button type="submit" loading={busy}>
            <PackageCheck className="size-4" /> Log finished good
          </Button>
        </div>
      </form>
    </div>
  );
}
