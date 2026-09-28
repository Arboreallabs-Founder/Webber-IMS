"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Search, ArrowRight, PauseCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { formatDate, cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/server/crud";

// ---------------------------------------------------------------------------
// Phase configuration — mirrors projects-list.tsx (same underlying table)
// ---------------------------------------------------------------------------

const PHASES = [
  "planning",
  "doc_approval",
  "procurement",
  "production",
  "dispatched",
  "closed",
] as const;
type Phase = (typeof PHASES)[number];

const PHASE_SHORT: Record<string, string> = {
  planning:    "Plan",
  doc_approval:"Docs",
  procurement: "Procure",
  production:  "Build",
  dispatched:  "Ship",
  closed:      "Done",
};

const ALL_STATUSES = [...PHASES, "on_hold"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConsumptionRecord = {
  id: string;
  project_no: string;
  status: string;
  delivery_date: string | null;
  department: string | null;
  consumption_reason: string | null;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function InternalConsumptionList({
  records,
  canWrite,
  upsertAction,
  deleteAction,
}: {
  records: ConsumptionRecord[];
  canWrite: boolean;
  upsertAction: (fd: FormData) => Promise<ActionResult>;
  deleteAction: (fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<ConsumptionRecord | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const filtered = records.filter((r) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      r.project_no.toLowerCase().includes(q) ||
      (r.department ?? "").toLowerCase().includes(q) ||
      (r.consumption_reason ?? "").toLowerCase().includes(q)
    );
  });

  function close() { setCreating(false); setEditing(null); setError(null); }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await upsertAction(new FormData(e.currentTarget));
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    close();
    router.refresh();
  }

  async function onDelete(r: ConsumptionRecord) {
    if (!confirm(`Delete ${r.project_no}? This cannot be undone.`)) return;
    const fd = new FormData();
    fd.set("id", r.id);
    const res = await deleteAction(fd);
    if (res?.error) { alert(res.error); return; }
    router.refresh();
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by no., department, or reason…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <p className="text-sm text-muted-foreground">{filtered.length} of {records.length}</p>
        {canWrite && (
          <Button onClick={() => { setError(null); setCreating(true); }}>
            <Plus className="size-4" /> New internal consumption
          </Button>
        )}
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Reference No.</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead className="w-36 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                No internal consumption records yet.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">{r.project_no}</TableCell>
                <TableCell className="text-muted-foreground">{r.department ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.consumption_reason ?? "—"}</TableCell>
                <TableCell>
                  <PhaseCell status={r.status} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/projects/${r.id}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Open <ArrowRight className="ml-1 size-3" />
                    </Link>
                    {canWrite && (
                      <>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => { setError(null); setEditing(r); }}
                          aria-label="Edit"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDelete(r)}
                          aria-label="Delete"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Add / Edit dialog */}
      <ConsumptionFormDialog
        open={creating || editing !== null}
        initial={editing}
        error={error}
        pending={pending}
        onSubmit={onSubmit}
        onCancel={close}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase stepper cell — identical to projects-list.tsx
// ---------------------------------------------------------------------------

function PhaseCell({ status }: { status: string }) {
  if (status === "on_hold") {
    return (
      <div className="flex items-center gap-2">
        <PauseCircle className="size-4 text-amber-500" />
        <span className="text-sm font-medium text-amber-600">On Hold</span>
      </div>
    );
  }

  const currentIdx = PHASES.indexOf(status as Phase);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center">
        {PHASES.map((phase, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <React.Fragment key={phase}>
              {i > 0 && (
                <div className={cn("h-0.5 flex-1", done ? "bg-primary" : "bg-slate-200")} />
              )}
              <div
                title={PHASE_SHORT[phase]}
                className={cn(
                  "size-2.5 shrink-0 rounded-full transition-colors",
                  done  && "bg-primary",
                  active && "bg-primary ring-2 ring-primary/30 ring-offset-1",
                  !done && !active && "bg-slate-200",
                )}
              />
            </React.Fragment>
          );
        })}
      </div>
      <p className="text-xs font-medium text-primary">{PHASE_SHORT[status] ?? status}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit dialog + form
// ---------------------------------------------------------------------------

function ConsumptionFormDialog({
  open,
  initial,
  error,
  pending,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  initial: ConsumptionRecord | null;
  error: string | null;
  pending: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={initial ? `Edit ${initial.project_no}` : "New internal consumption"}>
      <form onSubmit={onSubmit} className="space-y-4">
        {initial && <input type="hidden" name="id" value={initial.id} />}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Reference No." required className="col-span-2">
            <Input name="project_no" required defaultValue={initial?.project_no ?? ""} placeholder="IC-001" />
          </Field>

          <Field label="Department" required className="col-span-2">
            <Input name="department" required defaultValue={initial?.department ?? ""} placeholder="Production, QA, R&D…" />
          </Field>

          <Field label="Reason for consumption" required className="col-span-2">
            <Input name="consumption_reason" required defaultValue={initial?.consumption_reason ?? ""} placeholder="e.g. Testing, rework, internal build" />
          </Field>

          {initial && (
            <Field label="Status">
              <Select name="status" defaultValue={initial.status}>
                {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          )}
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={pending}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
