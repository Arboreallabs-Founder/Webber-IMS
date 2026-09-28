"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MobileRowCard } from "@/components/ui/mobile-row-card";
import { formatNumber } from "@/lib/utils";
import { addGrnLine, type ActionResult } from "../actions";

type Posted = { id: string; component_label: string; qty: number; is_untagged: boolean; lot_code: string | null; lot_id: string | null; blocked_project: string | null };
type OpenPoEntry = { po_line_id: string; po_no: string; tag: string; project_id: string | null; remaining: number };
type Component = { id: string; component_no: string; name: string; quantity_type: string; tracking_mode: string; inspection_template_id?: string | null };
type OpenBox = { id: string; lot_code: string; qty_on_hand: number; container_no: string | null; location: string | null };
type TemplateField = { id: string; label: string; field_type: string; options: string[] | null; is_required: boolean };
type IrnRow = { id: string; irn_no: string; component_label: string; qty: number; status: string; generated_by: string; rejection_reason: string | null };
type IrnActionResult = { ok?: true; error?: string; id?: string; irn_no?: string; status?: string };

const IRN_STATUS_META: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  approved: { label: "Approved", variant: "success" },
  pending_approval: { label: "Pending approval", variant: "warning" },
  rejected: { label: "Rejected", variant: "destructive" },
};

function QtyHelperLabel({ qt }: { qt: string }) {
  if (qt === "length") return <span className="text-xs text-muted-foreground">Length/piece is auto-calculated from the total</span>;
  if (qt === "weight")  return <span className="text-xs text-muted-foreground">Weight/piece is auto-calculated from the total</span>;
  return null;
}

export function GrnReceiver({
  grnId,
  postedLines,
  components,
  projects,
  openPoByComponent,
  openBoxesByComponent,
  lotIds,
  canReceive,
  canSeeFinancials,
  vendorComponentIds,
  vendorName,
  vendorId,
  templateFieldsByTemplate,
  excludedFieldIdsByComponent,
  irnRows,
  submitIrnAction,
  createComponentAction,
  vendorOptions,
  templateOptions,
  mpnsByComponent,
  addMpnAction,
}: {
  grnId: string;
  postedLines: Posted[];
  components: Component[];
  projects: { id: string; project_no: string }[];
  openPoByComponent: Record<string, OpenPoEntry[]>;
  openBoxesByComponent: Record<string, OpenBox[]>;
  lotIds: string[];
  canReceive: boolean;
  canSeeFinancials: boolean;
  /** Components tagged to this GRN's vendor (via vendor_components) — narrows the manual picker. */
  vendorComponentIds: string[];
  vendorName: string | null;
  vendorId?: string | null;
  templateFieldsByTemplate: Record<string, TemplateField[]>;
  /** Per-component field exclusions (opt-out) — fields listed here are skipped for that component. */
  excludedFieldIdsByComponent: Record<string, string[]>;
  irnRows: IrnRow[];
  submitIrnAction: (fd: FormData) => Promise<IrnActionResult>;
  /** Optional: create a component inline from this GRN's receiving form. */
  createComponentAction?: (fd: FormData) => Promise<ActionResult>;
  vendorOptions?: { value: string; label: string }[];
  templateOptions?: { value: string; label: string }[];
  /** This component's known MPNs (one WPC can be sourced from several manufacturers). */
  mpnsByComponent?: Record<string, { id: string; mpn: string }[]>;
  /** Optional: add a new MPN to a component inline from this GRN's receiving form. */
  addMpnAction?: (fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [qtys, setQtys] = React.useState<Record<string, string>>({});
  const [manualComp, setManualComp] = React.useState("");
  const [manualQty, setManualQty] = React.useState("1");
  const [selectedPoLineId, setSelectedPoLineId] = React.useState("");
  // dimension inputs for manual entry
  const [pieceCount, setPieceCount] = React.useState("");
  const [totalLength, setTotalLength] = React.useState("");
  const [totalWeight, setTotalWeight] = React.useState("");
  const [targetLotId, setTargetLotId] = React.useState("");
  const [unitCost, setUnitCost] = React.useState("");
  const [showAllComponents, setShowAllComponents] = React.useState(false);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [mpnId, setMpnId] = React.useState("");
  const [extraMpns, setExtraMpns] = React.useState<Record<string, { id: string; mpn: string }[]>>({});
  const [mpnCreating, setMpnCreating] = React.useState(false);
  const [location, setLocation] = React.useState("");

  // Components created inline this session, merged on top of the server list.
  const [extraComponents, setExtraComponents] = React.useState<Component[]>([]);
  const [compDialogOpen, setCompDialogOpen] = React.useState(false);
  const [compDialogError, setCompDialogError] = React.useState<string | null>(null);
  const [compDialogPending, setCompDialogPending] = React.useState(false);
  const allComponents = React.useMemo(
    () => [...extraComponents, ...components.filter((c) => !extraComponents.some((e) => e.id === c.id))],
    [components, extraComponents],
  );

  const hasVendorFilter = vendorComponentIds.length > 0;
  const vendorCompSet = React.useMemo(() => new Set(vendorComponentIds), [vendorComponentIds]);
  const pickerComponents = React.useMemo(
    () => (hasVendorFilter && !showAllComponents ? allComponents.filter((c) => vendorCompSet.has(c.id) || extraComponents.some((e) => e.id === c.id)) : allComponents),
    [allComponents, hasVendorFilter, showAllComponents, vendorCompSet, extraComponents],
  );
  const pickerComponentItems = React.useMemo(
    () => pickerComponents.map((c) => ({ value: c.id, label: `${c.component_no} — ${c.name}` })),
    [pickerComponents],
  );

  const compMap = React.useMemo(() => new Map(allComponents.map((c) => [c.id, c])), [allComponents]);
  const selectedComp = manualComp ? compMap.get(manualComp) : undefined;
  const qt = selectedComp?.quantity_type ?? "nos";
  const trackingMode = selectedComp?.tracking_mode ?? "box";
  const boxesForComp = manualComp ? (openBoxesByComponent[manualComp] ?? []) : [];
  const mpnOptions = React.useMemo(
    () => (manualComp ? [...(mpnsByComponent?.[manualComp] ?? []), ...(extraMpns[manualComp] ?? [])] : []),
    [manualComp, mpnsByComponent, extraMpns],
  );
  // Adding to an existing box keeps whatever MPN/location that box already
  // has — both only matter when this receipt creates a new lot.
  const mpnRelevant = manualComp && !(trackingMode === "box" && !!targetLotId);
  const locationRelevant = mpnRelevant;
  const existingBox = trackingMode === "box" && targetLotId ? boxesForComp.find((b) => b.id === targetLotId) : undefined;
  const allTemplateFields = selectedComp?.inspection_template_id ? (templateFieldsByTemplate[selectedComp.inspection_template_id] ?? []) : [];
  const excludedIds = React.useMemo(() => new Set(manualComp ? (excludedFieldIdsByComponent[manualComp] ?? []) : []), [manualComp, excludedFieldIdsByComponent]);
  const templateFields = allTemplateFields.filter((f) => !excludedIds.has(f.id));
  const needsInspection = templateFields.length > 0;

  // Derived total qty for length/weight — both are directly-entered totals now.
  const derivedQty = React.useMemo(() => {
    const pc = Number(pieceCount) || 0;
    const tl = Number(totalLength) || 0;
    const tw = Number(totalWeight) || 0;
    if (qt === "length" && pc > 0 && tl > 0) return tl;
    if (qt === "weight" && pc > 0 && tw > 0) return tw;
    return null;
  }, [qt, pieceCount, totalLength, totalWeight]);

  // Length/weight per piece — auto-calculated from the directly-entered total ÷ pieces.
  const derivedPieceLength = React.useMemo(() => {
    const pc = Number(pieceCount) || 0;
    const tl = Number(totalLength) || 0;
    return qt === "length" && pc > 0 && tl > 0 ? tl / pc : null;
  }, [qt, pieceCount, totalLength]);

  const derivedPieceWeight = React.useMemo(() => {
    const pc = Number(pieceCount) || 0;
    const tw = Number(totalWeight) || 0;
    return qt === "weight" && pc > 0 && tw > 0 ? tw / pc : null;
  }, [qt, pieceCount, totalWeight]);

  const matchingPoLines = manualComp ? (openPoByComponent[manualComp] ?? []) : [];
  const selectedPoLine = matchingPoLines.find((pl) => pl.po_line_id === selectedPoLineId);
  const enteredQty = qt === "nos" ? (Number(manualQty) || 0) : (derivedQty ?? 0);
  const overReceipt = !!selectedPoLine && enteredQty > selectedPoLine.remaining + 1e-6;
  // A PO's price is what gets registered — a typed Unit cost can't coexist with a matched PO.
  const poPriceConflict = !!selectedPoLineId && unitCost.trim() !== "";
  const totalCost = React.useMemo(() => {
    const uc = Number(unitCost);
    if (!unitCost.trim() || !Number.isFinite(uc)) return null;
    const qty = qt === "nos" ? Number(manualQty) || 0 : (derivedQty ?? 0);
    if (!qty) return null;
    return uc * qty;
  }, [unitCost, manualQty, derivedQty, qt]);

  React.useEffect(() => {
    setSelectedPoLineId(matchingPoLines.length > 0 ? matchingPoLines[0].po_line_id : "");
    setManualQty("1");
    setPieceCount("");
    setTotalLength("");
    setTotalWeight("");
    // Default to an existing open box when this component already has one —
    // "new box" is the exception, not the default.
    const boxes = manualComp ? (openBoxesByComponent[manualComp] ?? []) : [];
    setTargetLotId(boxes.length > 0 ? boxes[0].id : "");
    setUnitCost("");
    setAnswers({});
    setMpnId("");
    setLocation("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualComp]);

  // Picking an existing box supersedes MPN/location choice — that box already has both.
  React.useEffect(() => {
    if (targetLotId) { setMpnId(""); setLocation(""); }
  }, [targetLotId]);

  async function run(fd: FormData, key: string, onOk?: () => void) {
    setBusy(key); setError(null); setMessage(null);
    fd.set("grn_id", grnId);
    const res: ActionResult = await addGrnLine(fd);
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    onOk?.(); router.refresh();
  }

  async function onCreateComponent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!createComponentAction) return;
    setCompDialogError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    setCompDialogPending(true);
    const res = await createComponentAction(fd);
    setCompDialogPending(false);
    if (res?.error) {
      setCompDialogError(res.error);
      return;
    }
    const newId = res.id;
    if (newId) {
      const comp: Component = {
        id: newId,
        component_no: String(fd.get("component_no") ?? "").trim(),
        name: String(fd.get("name") ?? "").trim(),
        quantity_type: "nos",
        tracking_mode: "box",
      };
      setExtraComponents((prev) => [comp, ...prev]);
      setManualComp(newId);
    }
    setCompDialogOpen(false);
    form.reset();
    router.refresh();
  }

  async function handleCreateMpn(query: string) {
    if (!addMpnAction || !manualComp || !query) return;
    setError(null);
    setMpnCreating(true);
    const fd = new FormData();
    fd.set("component_id", manualComp);
    fd.set("mpn", query);
    const res = await addMpnAction(fd);
    setMpnCreating(false);
    if (res?.error) { setError(res.error); return; }
    if (res.id) {
      setExtraMpns((prev) => ({ ...prev, [manualComp]: [...(prev[manualComp] ?? []), { id: res.id!, mpn: query }] }));
      setMpnId(res.id);
    }
  }

  async function runIrn(fd: FormData, onOk?: () => void) {
    setBusy("manual"); setError(null); setMessage(null);
    fd.set("grn_id", grnId);
    const res = await submitIrnAction(fd);
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    setMessage(
      res.status === "approved"
        ? `${res.irn_no} approved — QR generated.`
        : `${res.irn_no} submitted — pending manager approval before a QR is generated.`,
    );
    onOk?.(); router.refresh();
  }

  function onManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (selectedPoLineId) {
      fd.set("po_line_id", selectedPoLineId);
      const selectedLine = matchingPoLines.find((pl) => pl.po_line_id === selectedPoLineId);
      if (selectedLine?.project_id) fd.set("project_id", selectedLine.project_id);
    }
    // For length/weight, override qty_received with the computed total
    if (derivedQty !== null) fd.set("qty_received", String(derivedQty));
    if (mpnRelevant && mpnId) fd.set("mpn_id", mpnId);
    if (locationRelevant && location.trim()) fd.set("location", location.trim());

    if (poPriceConflict) {
      setError("A Purchase Order is attached to this line — clear the Unit cost field so the PO's price is the one registered.");
      return;
    }

    if (needsInspection) {
      const missing = templateFields.filter((f) => f.is_required && !answers[f.id]?.trim());
      if (missing.length > 0) {
        setError(`Missing required field(s): ${missing.map((f) => f.label).join(", ")}`);
        return;
      }
      fd.set("answers", JSON.stringify(templateFields.map((f) => ({ field_id: f.id, value: answers[f.id] ?? "" }))));
      if (qt !== "nos") {
        fd.set("piece_count", pieceCount);
        fd.set("piece_length", derivedPieceLength !== null ? String(derivedPieceLength) : "");
        fd.set("piece_weight", derivedPieceWeight !== null ? String(derivedPieceWeight) : "");
      }
      if (trackingMode === "box" && targetLotId) fd.set("target_lot_id", targetLotId);
      runIrn(fd, () => {
        form.reset();
        setManualComp("");
        setSelectedPoLineId("");
        setManualQty("1");
        setPieceCount(""); setTotalLength(""); setTotalWeight("");
        setTargetLotId("");
        setUnitCost("");
        setAnswers({});
        setMpnId("");
        setLocation("");
      });
      return;
    }

    // Box mode: adding to an existing box vs a new box
    if (trackingMode === "box" && targetLotId) fd.set("target_lot_id", targetLotId);
    run(fd, "manual", () => {
      form.reset();
      setManualComp("");
      setSelectedPoLineId("");
      setManualQty("1");
      setPieceCount(""); setTotalLength(""); setTotalWeight("");
      setTargetLotId("");
      setUnitCost("");
      setMpnId("");
      setLocation("");
    });
  }

  return (
    <div className="space-y-8">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>}

      {/* Line entry */}
      {canReceive && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Enter received material</h3>
          <form onSubmit={onManualSubmit} className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">

            {/* Component selector */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Component</Label>
                  {createComponentAction && (
                    <button
                      type="button"
                      onClick={() => { setCompDialogError(null); setCompDialogOpen(true); }}
                      className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                    >
                      <Plus className="size-3" /> Can&apos;t find it? Create component
                    </button>
                  )}
                </div>
                <Combobox items={pickerComponentItems} name="component_id" required value={manualComp} onChange={setManualComp} placeholder="— component —" />
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
              </div>
            </div>

            {/* MPN — which manufacturer's part this receipt actually is */}
            {manualComp && (
              mpnRelevant ? (
                <div className="space-y-1.5">
                  <Label>MPN (Manufacturer Part No.)</Label>
                  <Combobox
                    items={mpnOptions.map((m) => ({ value: m.id, label: m.mpn }))}
                    name="mpn_id"
                    value={mpnId}
                    onChange={setMpnId}
                    placeholder="Type to search, or type a new one to add it…"
                    onCreate={addMpnAction ? handleCreateMpn : undefined}
                    creating={mpnCreating}
                    createLabel={(q) => `+ Add "${q}" as new MPN`}
                  />
                  {mpnOptions.length === 0 && (
                    <span className="text-xs text-muted-foreground">No MPNs recorded for this component yet — type one above to add it.</span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">MPN not needed — adding into an existing box, which already has one.</p>
              )
            )}

            {/* Location — where this box/lot is physically stored */}
            {manualComp && (
              locationRelevant ? (
                <div className="space-y-1.5">
                  <Label>Location</Label>
                  <Input
                    name="location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Store-A / Rack-3"
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Location not needed — adding into an existing box{existingBox?.location ? `, already stored at ${existingBox.location}` : ""}.
                </p>
              )
            )}

            {/* Quantity inputs — vary by lot type */}
            {manualComp && (
              <div className="rounded-md border border-border bg-background p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {qt === "nos" ? "Count" : qt === "length" ? "Length (metres)" : "Weight (KG)"}
                  </span>
                  <QtyHelperLabel qt={qt} />
                </div>

                {qt === "nos" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Qty received{trackingMode === "box" && targetLotId ? " (pieces to add to box)" : ""}</Label>
                        <Input
                          name="qty_received"
                          type="number"
                          step="any"
                          value={manualQty}
                          onChange={(e) => setManualQty(e.target.value)}
                          max={selectedPoLine ? selectedPoLine.remaining : undefined}
                          required
                        />
                      </div>
                      {canSeeFinancials && (
                        <div className="space-y-1.5">
                          <Label>Unit cost (₹){selectedPoLineId ? " — clear this, the PO's price will be registered" : ""}</Label>
                          <Input
                            name="unit_cost"
                            type="number"
                            step="any"
                            value={unitCost}
                            onChange={(e) => setUnitCost(e.target.value)}
                          />
                          {totalCost !== null && !poPriceConflict && (
                            <p className="text-xs text-muted-foreground">
                              Total cost: <span className="font-medium text-foreground">₹{formatNumber(totalCost)}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {trackingMode === "item" && (
                      <p className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Item-tracked:</span> one QR sticker is printed per piece — receiving N creates N lots.
                      </p>
                    )}

                    {trackingMode === "box" && (
                      <div className="space-y-1.5">
                        <Label>Box (QR is on the box)</Label>
                        <Select value={targetLotId} onChange={(e) => setTargetLotId(e.target.value)}>
                          {boxesForComp.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.container_no ?? b.lot_code} · {formatNumber(b.qty_on_hand)} in box
                            </option>
                          ))}
                          <option value="">— New box (new QR) —</option>
                        </Select>
                        <span className="text-xs text-muted-foreground">
                          {targetLotId ? "Adds these pieces into the existing box (no new QR)." : "Creates a new box with its own QR."}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {qt === "length" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label>No. of pieces</Label>
                      <Input type="number" step="1" min="1" value={pieceCount}
                        onChange={(e) => setPieceCount(e.target.value)}
                        name="piece_count" required placeholder="e.g. 10" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Total length (m)</Label>
                      <Input type="number" step="any" min="0" value={totalLength}
                        onChange={(e) => setTotalLength(e.target.value)}
                        required placeholder="e.g. 60" />
                    </div>
                    {canSeeFinancials && (
                      <div className="space-y-1.5">
                        <Label>Unit cost (₹/m){selectedPoLineId ? " — clear this, the PO's price will be registered" : ""}</Label>
                        <Input
                          name="unit_cost"
                          type="number"
                          step="any"
                          value={unitCost}
                          onChange={(e) => setUnitCost(e.target.value)}
                        />
                        {totalCost !== null && !poPriceConflict && (
                          <p className="text-xs text-muted-foreground">
                            Total cost: <span className="font-medium text-foreground">₹{formatNumber(totalCost)}</span>
                          </p>
                        )}
                      </div>
                    )}
                    {derivedPieceLength !== null && (
                      <div className="sm:col-span-3">
                        <p className="text-sm font-medium text-green-700">
                          ≈ <span className="font-bold">{formatNumber(derivedPieceLength)} m/piece</span>
                          <span className="ml-2 text-muted-foreground">({totalLength} m ÷ {pieceCount} pieces)</span>
                        </p>
                        <input type="hidden" name="qty_received" value={derivedQty ?? ""} />
                        <input type="hidden" name="piece_length" value={derivedPieceLength} />
                      </div>
                    )}
                  </div>
                )}

                {qt === "weight" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label>No. of pieces</Label>
                      <Input type="number" step="1" min="1" value={pieceCount}
                        onChange={(e) => setPieceCount(e.target.value)}
                        name="piece_count" required placeholder="e.g. 50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Total weight (kg)</Label>
                      <Input type="number" step="any" min="0" value={totalWeight}
                        onChange={(e) => setTotalWeight(e.target.value)}
                        required placeholder="e.g. 125" />
                    </div>
                    {canSeeFinancials && (
                      <div className="space-y-1.5">
                        <Label>Unit cost (₹/kg){selectedPoLineId ? " — clear this, the PO's price will be registered" : ""}</Label>
                        <Input
                          name="unit_cost"
                          type="number"
                          step="any"
                          value={unitCost}
                          onChange={(e) => setUnitCost(e.target.value)}
                        />
                        {totalCost !== null && !poPriceConflict && (
                          <p className="text-xs text-muted-foreground">
                            Total cost: <span className="font-medium text-foreground">₹{formatNumber(totalCost)}</span>
                          </p>
                        )}
                      </div>
                    )}
                    {derivedPieceWeight !== null && (
                      <div className="sm:col-span-3">
                        <p className="text-sm font-medium text-green-700">
                          ≈ <span className="font-bold">{formatNumber(derivedPieceWeight)} kg/piece</span>
                          <span className="ml-2 text-muted-foreground">({totalWeight} kg ÷ {pieceCount} pieces)</span>
                        </p>
                        <input type="hidden" name="qty_received" value={derivedQty ?? ""} />
                        <input type="hidden" name="piece_weight" value={derivedPieceWeight} />
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}

            {/* Inspection (IRN) — this component has a template attached */}
            {needsInspection && (
              <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                <p className="text-sm font-medium text-blue-900">
                  Inspection required before a QR is generated — fill in the checklist below.
                </p>
                {templateFields.map((f) => (
                  <div key={f.id} className="space-y-1.5">
                    {f.field_type === "checkbox" ? (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-input"
                          checked={answers[f.id] === "true"}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [f.id]: e.target.checked ? "true" : "" }))}
                        />
                        <span className="text-sm font-medium">
                          {f.label}
                          {f.is_required && <span className="text-destructive"> *</span>}
                        </span>
                      </label>
                    ) : (
                      <>
                        <Label>
                          {f.label}
                          {f.is_required && <span className="text-destructive"> *</span>}
                        </Label>
                        {f.field_type === "choice" ? (
                          <Select
                            value={answers[f.id] ?? ""}
                            onChange={(e) => setAnswers((prev) => ({ ...prev, [f.id]: e.target.value }))}
                          >
                            <option value="">— choose —</option>
                            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                          </Select>
                        ) : (
                          <Input
                            type={f.field_type === "number" ? "number" : f.field_type === "link" ? "url" : "text"}
                            step={f.field_type === "number" ? "any" : undefined}
                            placeholder={f.field_type === "link" ? "https://…" : undefined}
                            value={answers[f.id] ?? ""}
                            onChange={(e) => setAnswers((prev) => ({ ...prev, [f.id]: e.target.value }))}
                          />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Open PO lookup */}
            {manualComp && (
              <div className={`rounded-md border px-4 py-3 text-sm ${matchingPoLines.length > 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
                {matchingPoLines.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 font-medium text-green-800">
                      <CheckCircle2 className="size-4 text-green-600" />
                      Open PO found — select which line this receipt is against:
                    </div>
                    <div className="space-y-1.5">
                      {matchingPoLines.map((pl) => (
                        <label key={pl.po_line_id} className="flex cursor-pointer items-center gap-2.5">
                          <input type="radio" name="_po_line_choice" value={pl.po_line_id}
                            checked={selectedPoLineId === pl.po_line_id}
                            onChange={() => setSelectedPoLineId(pl.po_line_id)}
                            className="accent-primary" />
                          <span className="text-green-800">
                            <span className="font-medium">{pl.po_no}</span>
                            {" · "}{pl.tag}
                            {" · "}{formatNumber(pl.remaining)} remaining
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-amber-800">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span>
                      <span className="font-medium">No open PO found for this component.</span>{" "}
                      That&apos;s fine — this line will be received as stock with no PO attached.
                    </span>
                  </div>
                )}
              </div>
            )}

            <input type="hidden" name="po_line_id" value={selectedPoLineId} />

            {overReceipt && selectedPoLine && (
              <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                <span>
                  Exceeds the <span className="font-medium">{formatNumber(selectedPoLine.remaining)}</span> still
                  outstanding on <span className="font-medium">{selectedPoLine.po_no}</span>. Revise the PO quantity
                  to receive more.
                </span>
              </p>
            )}

            {poPriceConflict && (
              <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                <span>
                  A Purchase Order is attached — its price will be registered, not a typed Unit cost.
                  Clear the Unit cost field above to continue.
                </span>
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" variant="secondary"
                loading={busy === "manual"} disabled={(qt !== "nos" && derivedQty === null) || overReceipt || poPriceConflict}>
                <Plus className="size-4" /> {needsInspection ? "Submit for inspection" : "Add line"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* Posted lines */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Received lines</h3>
          {lotIds.length > 0 && (
            <Link href={`/inventory/stickers?lots=${lotIds.join(",")}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Print stickers
            </Link>
          )}
        </div>
        {postedLines.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">Nothing received yet.</p>
        ) : (
          <>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Tagged to</TableHead>
                    <TableHead>Lot (QR)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {postedLines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">{l.component_label}</TableCell>
                      <TableCell>{formatNumber(l.qty)}</TableCell>
                      <TableCell>
                        {l.is_untagged
                          ? <Badge variant="warning">Untagged — flagged</Badge>
                          : l.blocked_project
                          ? <Badge variant="success">Blocked — {l.blocked_project}</Badge>
                          : <Badge variant="secondary">PO</Badge>}
                      </TableCell>
                      <TableCell>
                        {l.lot_code && l.lot_id
                          ? <Link href={`/inventory/lots/${l.lot_id}`} className="font-mono text-xs text-primary hover:underline">{l.lot_code}</Link>
                          : (l.lot_code ?? "—")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 sm:hidden">
              {postedLines.map((l) => (
                <MobileRowCard
                  key={l.id}
                  title={l.component_label}
                  badge={
                    l.is_untagged
                      ? <Badge variant="warning">Untagged</Badge>
                      : l.blocked_project
                      ? <Badge variant="success">Blocked — {l.blocked_project}</Badge>
                      : <Badge variant="secondary">PO</Badge>
                  }
                  fields={[
                    { label: "Qty", value: formatNumber(l.qty) },
                    {
                      label: "Lot (QR)",
                      value: l.lot_code && l.lot_id
                        ? <Link href={`/inventory/lots/${l.lot_id}`} className="font-mono text-xs text-primary hover:underline">{l.lot_code}</Link>
                        : (l.lot_code ?? "—"),
                    },
                  ]}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Inspection (IRN) status for this GRN */}
      {irnRows.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Inspections (IRN)</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IRN No.</TableHead>
                <TableHead>Component</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Generated by</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {irnRows.map((i) => {
                const meta = IRN_STATUS_META[i.status] ?? { label: i.status, variant: "secondary" as const };
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{i.irn_no}</TableCell>
                    <TableCell>{i.component_label}</TableCell>
                    <TableCell>{formatNumber(i.qty)}</TableCell>
                    <TableCell>{i.generated_by}</TableCell>
                    <TableCell>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {i.status === "rejected" && i.rejection_reason && (
                        <p className="mt-1 text-xs text-muted-foreground">{i.rejection_reason}</p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}

      {createComponentAction && (
        <Dialog open={compDialogOpen} onClose={() => setCompDialogOpen(false)} title="New component" className="max-w-2xl">
          <form onSubmit={onCreateComponent} className="space-y-4">
            <input type="hidden" name="tracking_mode" value="box" />
            <input type="hidden" name="quantity_type" value="nos" />
            <input type="hidden" name="uom" value="Nos" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>WPC (Webber Part Code) *</Label>
                <Input name="component_no" required placeholder="e.g. NZ-3600-02" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" required placeholder="Nozzle 2 inch" />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Input name="type" placeholder="Nozzle, Fastener, Media…" />
              </div>
              <div className="space-y-1.5">
                <Label>Grade</Label>
                <Input name="grade" placeholder="MS, SS316, Brass…" />
              </div>
              <div className="space-y-1.5">
                <Label>Spec</Label>
                <Input name="spec" placeholder='e.g. 12", #150' />
              </div>
              <div className="space-y-1.5">
                <Label>Supplier</Label>
                <Combobox items={vendorOptions ?? []} name="raw_supplier_id" defaultValue={vendorId ?? ""} placeholder="— none —" />
                <span className="text-xs text-muted-foreground">Vendor this component is bought from.</span>
              </div>
              {canSeeFinancials && (
                <div className="space-y-1.5">
                  <Label>Standard cost (₹)</Label>
                  <Input name="standard_cost" type="number" step="any" />
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Inspection template</Label>
                <Select name="inspection_template_id" defaultValue="">
                  <option value="">— none —</option>
                  {(templateOptions ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <span className="text-xs text-muted-foreground">Requires an IRN (inspection) before goods received at GRN become stock.</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>MPN(s) (Manufacturer Part No.)</Label>
              <textarea
                name="mpns"
                rows={2}
                placeholder="One per line — e.g.&#10;1N4148&#10;SMBJ4148"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-xs text-muted-foreground">The same WPC can be sourced from more than one manufacturer — list each one's MPN on its own line.</span>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <textarea
                name="description"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            {compDialogError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{compDialogError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCompDialogOpen(false)}>Cancel</Button>
              <Button type="submit" loading={compDialogPending}>Create &amp; select</Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
