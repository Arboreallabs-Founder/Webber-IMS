"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Cog, Check, Lock, Unlock, Plus, Trash2, Send, Undo2, Pencil, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import type { ActionResult } from "./actions";

type Bom = {
  id: string;
  status: "draft" | "pending_approval" | "approved";
  approved_at: string | null;
  approved_by_name: string | null;
  submitted_at: string | null;
  submitted_by_name: string | null;
  review_note: string | null;
} | null;
type BomLine = { id: string; component_label: string; required_qty: number; source: string; note: string | null };
type Component = { id: string; component_no: string; name: string };
type Act = (fd: FormData) => Promise<ActionResult>;

export function BomPanel({
  projectId,
  bom,
  lines,
  components,
  canWrite,
  canApprove,
  bomPolicy,
  bomNotNeeded,
  everApproved,
  canSetPolicy,
  setNotNeededAction,
  generateAction,
  startCustomAction,
  approveAction,
  unapproveAction,
  submitAction,
  withdrawAction,
  sendBackAction,
  addManualAction,
  removeLineAction,
}: {
  projectId: string;
  bom: Bom;
  lines: BomLine[];
  components: Component[];
  canWrite: boolean;
  /** Admin / Team Lead. A Factory Admin edits and submits but can't approve. */
  canApprove: boolean;
  /** 'required' = new project, locked until the BOM is approved once; 'legacy' = created before that rule. */
  bomPolicy: "required" | "legacy";
  /** "No BOM needed" ticked: POs, blocking and consumption work without a BOM. */
  bomNotNeeded: boolean;
  everApproved: boolean;
  /** Full Admin: may tick or untick "No BOM needed". */
  canSetPolicy: boolean;
  setNotNeededAction: Act;
  generateAction: Act;
  startCustomAction: Act;
  approveAction: Act;
  unapproveAction: Act;
  submitAction: Act;
  withdrawAction: Act;
  sendBackAction: Act;
  addManualAction: Act;
  removeLineAction: Act;
}) {
  const router = useRouter();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const approved = bom?.status === "approved";
  const pending = bom?.status === "pending_approval";
  const draft = bom?.status === "draft";
  const [sendingBack, setSendingBack] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const onDate = (d: string | null) => (d ? ` on ${new Date(d).toLocaleDateString("en-IN")}` : "");
  const componentItems = React.useMemo(() => components.map((c) => ({ value: c.id, label: `${c.component_no} — ${c.name}` })), [components]);

  const totalQty = lines.reduce((s, l) => s + Number(l.required_qty || 0), 0);

  async function run(action: Act, extra: Record<string, string>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const fd = new FormData();
    fd.set("project_id", projectId);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const res = await action(fd);
    setBusy(false);
    if (res?.error) setErr(res.error);
    else {
      if (res?.message) setMsg(res.message);
      router.refresh();
    }
  }

  async function onAddManual(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    fd.set("project_id", projectId);
    fd.set("bom_id", bom!.id);
    const res = await addManualAction(fd);
    setBusy(false);
    if (res?.error) setErr(res.error);
    else {
      e.currentTarget.reset();
      router.refresh();
    }
  }

  const locked = bomPolicy === "required" && !everApproved && !bomNotNeeded;

  return (
    <div className="space-y-4">
      <label
        className={`flex w-fit items-center gap-2 text-sm ${canSetPolicy ? "cursor-pointer" : "cursor-not-allowed text-muted-foreground"}`}
        title={canSetPolicy ? undefined : "Only an Admin can change this"}
      >
        <input
          type="checkbox"
          className="size-4 rounded border-input"
          checked={bomNotNeeded}
          disabled={!canSetPolicy || busy}
          onChange={(e) =>
            run(
              setNotNeededAction,
              { not_needed: String(e.target.checked) },
              e.target.checked
                ? "Mark this project as not needing a BOM? POs, blocking and consumption will work without one."
                : bomPolicy === "required" && !everApproved
                  ? "Untick? This project will need an approved BOM again before any PO, blocking or consumption."
                  : undefined,
            )
          }
        />
        <span className="font-medium">No BOM needed</span>
        <span className="text-muted-foreground">— for consumables, fixed assets and other internal projects</span>
      </label>

      {bomNotNeeded ? null : locked ? (
        <p className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Lock className="size-4 shrink-0" />
          This project needs an approved BOM before any PO can be raised, stock blocked or consumed for it.
        </p>
      ) : bomPolicy === "legacy" && !bom ? (
        <p className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0" />
          This project has no BOM. Add one so orders, blocking and consumption can be checked against it.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {bom ? (
          approved ? (
            <Badge variant="success">Approved</Badge>
          ) : pending ? (
            <Badge variant="warning">Waiting for approval</Badge>
          ) : (
            <Badge variant="secondary">Draft</Badge>
          )
        ) : (
          <Badge variant="secondary">Not generated</Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {lines.length} line(s) · {formatNumber(totalQty)} total qty
        </span>

        {canWrite && (
          <div className="ml-auto flex flex-wrap gap-2">
            {!pending && (
              <Button
                variant="outline"
                loading={busy}
                onClick={() =>
                  run(generateAction, {}, bom ? `Regenerate BOM from templates? Template lines are rebuilt (manual lines kept)${approved ? "; the approved BOM goes back to draft and needs approving again" : ""}.` : undefined)
                }
              >
                <Cog className="size-4" /> {bom ? "Regenerate" : "Generate BOM"}
              </Button>
            )}
            {!bom && (
              <Button variant="outline" loading={busy} onClick={() => run(startCustomAction, {})}>
                <Plus className="size-4" /> Build Custom BOM
              </Button>
            )}
            {draft && !canApprove && (
              <Button loading={busy} disabled={lines.length === 0} onClick={() => run(submitAction, { bom_id: bom!.id })}>
                <Send className="size-4" /> Submit for approval
              </Button>
            )}
            {pending && !canApprove && (
              <Button variant="outline" loading={busy} onClick={() => run(withdrawAction, { bom_id: bom!.id }, "Withdraw this BOM from approval so you can change it?")}>
                <Undo2 className="size-4" /> Withdraw
              </Button>
            )}
            {pending && canApprove && (
              <Button variant="outline" loading={busy} onClick={() => { setReason(""); setSendingBack((v) => !v); }}>
                <Undo2 className="size-4" /> Send back
              </Button>
            )}
            {(draft || pending) && canApprove && (
              <Button loading={busy} disabled={lines.length === 0} onClick={() => run(approveAction, { bom_id: bom!.id })}>
                <Check className="size-4" /> Approve
              </Button>
            )}
            {approved && (
              canApprove ? (
                <Button variant="outline" loading={busy} onClick={() => run(unapproveAction, { bom_id: bom!.id })}>
                  <Unlock className="size-4" /> Unapprove
                </Button>
              ) : (
                <Button
                  variant="outline"
                  loading={busy}
                  onClick={() => run(unapproveAction, { bom_id: bom!.id }, "Edit this BOM? It goes back to draft and must be submitted and approved again.")}
                >
                  <Pencil className="size-4" /> Edit BOM
                </Button>
              )
            )}
          </div>
        )}
      </div>

      {sendingBack && pending && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(sendBackAction, { bom_id: bom!.id, reason }).then(() => setSendingBack(false));
          }}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3"
        >
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">What needs changing?</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. qty of YAHAMR005 should be 4" required autoFocus />
          </div>
          <Button type="submit" variant="secondary" loading={busy}>Send back</Button>
          <Button type="button" variant="ghost" onClick={() => setSendingBack(false)}>Cancel</Button>
        </form>
      )}

      {pending && (
        <p className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Clock className="size-4 shrink-0" />
          Submitted for approval{bom!.submitted_by_name ? ` by ${bom!.submitted_by_name}` : ""}{onDate(bom!.submitted_at)}.
          {canApprove ? " Review the lines below, then approve or send it back." : " An Admin needs to approve it. Withdraw to make changes."}
        </p>
      )}
      {draft && bom!.review_note && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-medium">Sent back:</span> {bom!.review_note}
        </p>
      )}

      {msg && <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">{msg}</p>}
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {bom && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Required Qty</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Note</TableHead>
                {canWrite && draft && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No lines yet — click Generate BOM or add lines manually below.
                  </TableCell>
                </TableRow>
              ) : (
                lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.component_label}</TableCell>
                    <TableCell>{formatNumber(l.required_qty)}</TableCell>
                    <TableCell>
                      <Badge variant={l.source === "manual" ? "warning" : "secondary"}>{l.source}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{l.note ?? "—"}</TableCell>
                    {canWrite && draft && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          aria-label="Remove line"
                          onClick={() => run(removeLineAction, { id: l.id })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {canWrite && draft && (
            <form onSubmit={onAddManual} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex-1 min-w-[220px]">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Add manual line — component</label>
                <Combobox items={componentItems} defaultValue="" name="component_id" placeholder="— component —" required />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Qty</label>
                <Input name="required_qty" type="number" step="any" defaultValue="1" />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Note</label>
                <Input name="note" placeholder="optional" />
              </div>
              <Button type="submit" variant="secondary" loading={busy}>
                <Plus className="size-4" /> Add
              </Button>
            </form>
          )}

          {approved && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Lock className="size-4" /> BOM approved{bom.approved_by_name ? ` by ${bom.approved_by_name}` : ""}{onDate(bom.approved_at)}. {canApprove ? "Unapprove to edit." : "Edit BOM to change it — it will need approving again."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
