"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/navigation-progress";
import { Plus, Pencil, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatINR, formatNumber, formatDate } from "@/lib/utils";
import { updatePO, addPoLine, updatePoLine, removePoLine, type ActionResult } from "../actions";
import { Combobox } from "@/components/ui/combobox";

type Line = {
  id: string;
  component_id: string | null;
  component_label: string;
  project_id: string | null;
  qty_ordered: number;
  qty_received: number;
  rate: number | null;
  amount: number | null;
  expected_date: string | null;
  line_status: string;
  approval_status: string;
  rejection_reason: string | null;
};
type Opt = { id: string; label: string };
type Suggestion = { vendor: string; price: number | null };
type ComponentOpt = { id: string; component_no: string; name: string; quantity_type?: string | null; uom?: string | null };

const DRAFT_STATUS_CHOICES = ["draft", "cancelled"];

function unitSuffix(qt: string | null | undefined, uom: string | null | undefined) {
  if (qt === "length") return "m";
  if (qt === "weight") return "kg";
  return uom || "";
}

export function PoEditor({
  poId,
  header,
  lines,
  components,
  vendors,
  projects,
  suggestions,
  lastRateByComponent,
  vendorComponentIds,
  vendorName,
  canWrite,
  canSeeFinancials,
}: {
  poId: string;
  header: {
    po_no: string; vendor_id: string | null; po_date: string | null; status: string;
    delivery_terms: string; payment_terms: string; freight_terms: string; gst_percent: number;
    delivery_address: string | null;
  };
  lines: Line[];
  components: ComponentOpt[];
  vendors: { id: string; name: string }[];
  projects: Opt[];
  suggestions: Record<string, Suggestion[]>;
  lastRateByComponent: Record<string, number>;
  /** Components tagged to this PO's vendor (via vendor_components) — narrows the manual picker. */
  vendorComponentIds: string[];
  vendorName: string | null;
  canWrite: boolean;
  canSeeFinancials: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Line | null>(null);
  const [addComp, setAddComp] = React.useState("");
  const [pieceCount, setPieceCount] = React.useState("");
  const [totalLength, setTotalLength] = React.useState("");
  const [totalWeight, setTotalWeight] = React.useState("");
  const [rateInput, setRateInput] = React.useState("");
  const [showAllComponents, setShowAllComponents] = React.useState(false);
  const projLabel = new Map(projects.map((p) => [p.id, p.label]));
  const compMap = React.useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const vendorItems = React.useMemo(() => vendors.map((v) => ({ value: v.id, label: v.name })), [vendors]);
  const projectItems = React.useMemo(() => projects.map((p) => ({ value: p.id, label: p.label })), [projects]);

  const hasVendorFilter = vendorComponentIds.length > 0;
  const vendorCompSet = React.useMemo(() => new Set(vendorComponentIds), [vendorComponentIds]);
  const pickerComponents = React.useMemo(
    () => (hasVendorFilter && !showAllComponents ? components.filter((c) => vendorCompSet.has(c.id)) : components),
    [components, hasVendorFilter, showAllComponents, vendorCompSet],
  );
  const pickerComponentItems = React.useMemo(
    () => pickerComponents.map((c) => ({ value: c.id, label: `${c.component_no} — ${c.name}` })),
    [pickerComponents],
  );

  const addSelectedComp = addComp ? compMap.get(addComp) : undefined;
  const addQt = addSelectedComp?.quantity_type ?? "nos";

  const derivedQty = React.useMemo(() => {
    const pc = Number(pieceCount) || 0;
    const tl = Number(totalLength) || 0;
    const tw = Number(totalWeight) || 0;
    if (addQt === "length" && pc > 0 && tl > 0) return tl;
    if (addQt === "weight" && pc > 0 && tw > 0) return tw;
    return null;
  }, [addQt, pieceCount, totalLength, totalWeight]);

  const derivedPieceLength = React.useMemo(() => {
    const pc = Number(pieceCount) || 0;
    const tl = Number(totalLength) || 0;
    return addQt === "length" && pc > 0 && tl > 0 ? tl / pc : null;
  }, [addQt, pieceCount, totalLength]);

  const derivedPieceWeight = React.useMemo(() => {
    const pc = Number(pieceCount) || 0;
    const tw = Number(totalWeight) || 0;
    return addQt === "weight" && pc > 0 && tw > 0 ? tw / pc : null;
  }, [addQt, pieceCount, totalWeight]);

  React.useEffect(() => {
    setPieceCount(""); setTotalLength(""); setTotalWeight("");
    const last = addComp ? lastRateByComponent[addComp] : undefined;
    setRateInput(last != null ? String(last) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addComp]);

  async function run(action: (fd: FormData) => Promise<ActionResult>, fd: FormData, onOk?: () => void) {
    setBusy(true); setError(null);
    fd.set("po_id", poId);
    const res = await action(fd);
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    startNavProgress();
    if (res?.revisedPoId) { router.push(`/purchase-orders/${res.revisedPoId}`); return; }
    onOk?.(); router.refresh();
  }

  const total = lines.reduce((s, l) => s + Number(l.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      {canWrite ? (
        <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("id", poId); run(updatePO, fd); }}
          className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>PO No.</Label>
            <Input name="po_no" defaultValue={header.po_no} required />
          </div>
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Combobox items={vendorItems} defaultValue={header.vendor_id ?? ""} name="vendor_id" placeholder="— none —" />
          </div>
          <div className="space-y-1.5">
            <Label>PO date</Label>
            <Input name="po_date" type="date" defaultValue={header.po_date ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            {header.status === "draft" ? (
              <Select name="status" defaultValue={header.status}>
                {DRAFT_STATUS_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            ) : (
              <p className="flex h-9 items-center text-sm text-muted-foreground">
                {header.status} <span className="ml-1.5 text-xs">(automatic — set via signing/receiving/revisions)</span>
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Delivery</Label>
            <Input name="delivery_terms" defaultValue={header.delivery_terms} placeholder="Urgent" />
          </div>
          <div className="space-y-1.5">
            <Label>Payment</Label>
            <Input name="payment_terms" defaultValue={header.payment_terms} placeholder="30 Days" />
          </div>
          <div className="space-y-1.5">
            <Label>Freight</Label>
            <Input name="freight_terms" defaultValue={header.freight_terms} placeholder="At Actual" />
          </div>
          {canSeeFinancials && (
            <div className="space-y-1.5">
              <Label>GST %</Label>
              <Input name="gst_percent" type="number" step="any" defaultValue={header.gst_percent} />
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-3">
            <Label>Delivery address</Label>
            <Textarea
              name="delivery_address"
              rows={3}
              defaultValue={header.delivery_address ?? ""}
              placeholder="Leave blank to use the default factory address on the printed PO"
            />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary" loading={busy}><Save className="size-4" /> Save header</Button>
          </div>
        </form>
      ) : (
        <div className="text-sm text-muted-foreground">Status: {header.status}</div>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Lines */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lines</h3>
          {canSeeFinancials && <span className="text-sm text-muted-foreground">Total: {formatINR(total)}</span>}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Component</TableHead>
              <TableHead>Project (tag)</TableHead>
              <TableHead>Qty</TableHead>
              {canSeeFinancials && <TableHead>Rate</TableHead>}
              {canSeeFinancials && <TableHead>Amount</TableHead>}
              <TableHead>Expected</TableHead>
              <TableHead>Line</TableHead>
              {canWrite && <TableHead className="w-20 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No lines yet.</TableCell></TableRow>
            ) : (
              lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.component_label}</TableCell>
                  <TableCell>{l.project_id ? projLabel.get(l.project_id) ?? "—" : <Badge variant="secondary">Stock</Badge>}</TableCell>
                  <TableCell>
                    {formatNumber(l.qty_ordered)}
                    {(() => {
                      const c = l.component_id ? compMap.get(l.component_id) : undefined;
                      const suffix = unitSuffix(c?.quantity_type, c?.uom);
                      return suffix ? <span className="ml-1 text-muted-foreground">{suffix}</span> : null;
                    })()}
                  </TableCell>
                  {canSeeFinancials && <TableCell>{formatINR(l.rate)}</TableCell>}
                  {canSeeFinancials && <TableCell>{formatINR(l.amount)}</TableCell>}
                  <TableCell className="text-muted-foreground">{formatDate(l.expected_date)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={l.line_status === "received" ? "success" : "secondary"}>{l.line_status}</Badge>
                      {l.qty_received > l.qty_ordered + 1e-6 && (
                        <Badge variant="destructive">
                          Over-received ({formatNumber(l.qty_received)}/{formatNumber(l.qty_ordered)})
                        </Badge>
                      )}
                      {l.approval_status === "pending_approval" && <Badge variant="warning">Pending approval</Badge>}
                      {l.approval_status === "rejected" && (
                        <Badge variant="destructive">Rejected{l.rejection_reason ? ` — ${l.rejection_reason}` : ""}</Badge>
                      )}
                    </div>
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setError(null); setEditing(l); }} aria-label="Edit"><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive" aria-label="Remove"
                          onClick={() => { const fd = new FormData(); fd.set("id", l.id); run(removePoLine, fd); }}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add line */}
      {canWrite && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            if (derivedQty !== null) fd.set("qty_ordered", String(derivedQty));
            run(addPoLine, fd, () => { form.reset(); setAddComp(""); setPieceCount(""); setTotalLength(""); setTotalWeight(""); setRateInput(""); });
          }}
          className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <h3 className="text-sm font-semibold">Add line</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 lg:col-span-2">
              <Label>Component</Label>
              <Combobox items={pickerComponentItems} value={addComp} onChange={setAddComp} name="component_id" placeholder="Search component no. or name…" required />
              {hasVendorFilter && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={showAllComponents}
                    onChange={(e) => setShowAllComponents(e.target.checked)}
                    className="size-3.5 rounded border-input"
                  />
                  {showAllComponents
                    ? "Showing all components"
                    : `Showing only ${vendorName ?? "this vendor"}'s components (${pickerComponents.length}) — check to show all`}
                </label>
              )}
              {addComp && suggestions[addComp]?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Supplied by: {suggestions[addComp].map((s) => `${s.vendor}${canSeeFinancials && s.price != null ? ` (${formatINR(s.price)})` : ""}`).join(", ")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Project tag (optional)</Label>
              <Combobox items={projectItems} defaultValue="" name="project_id" placeholder="Stock (general inventory)" />
            </div>
            {addQt === "nos" && (
              <div className="space-y-1.5">
                <Label>Qty{addSelectedComp?.uom ? ` (${addSelectedComp.uom})` : ""}</Label>
                <Input name="qty_ordered" type="number" step="any" defaultValue="1" />
              </div>
            )}
            {canSeeFinancials && (
              <div className="space-y-1.5">
                <Label>Rate (₹{addQt !== "nos" ? `/${unitSuffix(addQt, addSelectedComp?.uom)}` : ""})</Label>
                <Input name="rate" type="number" step="any" value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  placeholder="amount auto = rate × qty" />
                {addComp && lastRateByComponent[addComp] != null && (
                  <p className="text-xs text-muted-foreground">Last approved: {formatINR(lastRateByComponent[addComp])}</p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Expected date</Label>
              <Input name="expected_date" type="date" />
            </div>
          </div>

          {addQt === "length" && (
            <div className="rounded-md border border-border bg-background p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Length ordered <span className="ml-1 font-normal normal-case text-muted-foreground">— length/piece is auto-calculated from the total</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>No. of pieces</Label>
                  <Input type="number" step="1" min="1" value={pieceCount}
                    onChange={(e) => setPieceCount(e.target.value)} required placeholder="e.g. 1" />
                </div>
                <div className="space-y-1.5">
                  <Label>Total length (m)</Label>
                  <Input type="number" step="any" min="0" value={totalLength}
                    onChange={(e) => setTotalLength(e.target.value)} required placeholder="e.g. 10" />
                </div>
                {derivedPieceLength !== null && (
                  <div className="flex items-end">
                    <p className="text-sm font-medium text-green-700">
                      ≈ <span className="font-bold">{formatNumber(derivedPieceLength)} m/piece</span>
                      <span className="ml-2 text-muted-foreground">({totalLength} m ÷ {pieceCount} pieces)</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {addQt === "weight" && (
            <div className="rounded-md border border-border bg-background p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Weight ordered <span className="ml-1 font-normal normal-case text-muted-foreground">— weight/piece is auto-calculated from the total</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>No. of pieces</Label>
                  <Input type="number" step="1" min="1" value={pieceCount}
                    onChange={(e) => setPieceCount(e.target.value)} required placeholder="e.g. 50" />
                </div>
                <div className="space-y-1.5">
                  <Label>Total weight (kg)</Label>
                  <Input type="number" step="any" min="0" value={totalWeight}
                    onChange={(e) => setTotalWeight(e.target.value)} required placeholder="e.g. 125" />
                </div>
                {derivedPieceWeight !== null && (
                  <div className="flex items-end">
                    <p className="text-sm font-medium text-green-700">
                      ≈ <span className="font-bold">{formatNumber(derivedPieceWeight)} kg/piece</span>
                      <span className="ml-2 text-muted-foreground">({totalWeight} kg ÷ {pieceCount} pieces)</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <Button type="submit" variant="secondary" loading={busy} disabled={(addQt !== "nos" && derivedQty === null)}>
            <Plus className="size-4" /> Add line
          </Button>
        </form>
      )}

      {/* Edit line modal */}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Edit line" description={editing?.component_label}>
        {editing && (
          <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("id", editing.id); run(updatePoLine, fd, () => setEditing(null)); }} className="space-y-4">
            {editing.approval_status !== "approved" && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {editing.approval_status === "pending_approval"
                  ? "Price pending Admin approval — editing the rate will re-check it."
                  : `Price was rejected${editing.rejection_reason ? `: ${editing.rejection_reason}` : ""} — editing the rate will re-check it.`}
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Project tag (back-fill)</Label>
              <Combobox items={projectItems} defaultValue={editing.project_id ?? ""} name="project_id" placeholder="Stock (general inventory)" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  Qty
                  {(() => {
                    const c = editing.component_id ? compMap.get(editing.component_id) : undefined;
                    const suffix = unitSuffix(c?.quantity_type, c?.uom);
                    return suffix ? ` (${suffix} total)` : "";
                  })()}
                </Label>
                <Input name="qty_ordered" type="number" step="any" defaultValue={editing.qty_ordered} />
              </div>
              <div className="space-y-1.5">
                <Label>Expected date</Label>
                <Input name="expected_date" type="date" defaultValue={editing.expected_date ?? ""} />
              </div>
              {canSeeFinancials && (
                <>
                  <div className="space-y-1.5">
                    <Label>Rate (₹)</Label>
                    <Input name="rate" type="number" step="any" defaultValue={editing.rate ?? ""} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount (₹)</Label>
                    <Input name="amount" type="number" step="any" defaultValue=""
                      placeholder={`blank = rate × qty (current ₹${formatNumber(editing.amount ?? 0)})`} />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" loading={busy}>Save</Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
