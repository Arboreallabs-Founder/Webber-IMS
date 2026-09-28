"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Search, ArrowRight, PauseCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { formatINR, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/server/crud";

// ---------------------------------------------------------------------------
// Phase configuration
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

const PHASE_ACTION: Record<string, { label: string; href: (id: string) => string }> = {
  planning:    { label: "Open Project",    href: (id) => `/projects/${id}` },
  doc_approval:{ label: "Review BOM",      href: (id) => `/projects/${id}` },
  procurement: { label: "View Shortfall",  href: (id) => `/projects/${id}` },
  production:  { label: "Open Project",    href: (id) => `/projects/${id}` },
  dispatched:  { label: "Finished Goods",  href: (_)  => `/finished-goods` },
  closed:      { label: "View Project",    href: (id) => `/projects/${id}` },
  on_hold:     { label: "View Project",    href: (id) => `/projects/${id}` },
};

const ALL_STATUSES = [...PHASES, "on_hold"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Project = {
  id: string;
  project_no: string;
  customer_id: string | null;
  customer_name: string | null;
  status: string;
  order_date: string | null;
  delivery_date: string | null;
  customer_po_number: string | null;
  customer_po_value: number | null;
};

type Customer = { id: string; name: string };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectsList({
  projects,
  customers,
  canWrite,
  canSeeFinancials,
  upsertAction,
  deleteAction,
}: {
  projects: Project[];
  customers: Customer[];
  canWrite: boolean;
  canSeeFinancials: boolean;
  upsertAction: (fd: FormData) => Promise<ActionResult>;
  deleteAction: (fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Project | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const filtered = projects.filter((p) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      p.project_no.toLowerCase().includes(q) ||
      (p.customer_name ?? "").toLowerCase().includes(q)
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

  async function onDelete(p: Project) {
    if (!confirm(`Delete project ${p.project_no}? This cannot be undone.`)) return;
    const fd = new FormData();
    fd.set("id", p.id);
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
            placeholder="Search projects or customers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <p className="text-sm text-muted-foreground">{filtered.length} of {projects.length}</p>
        {canWrite && (
          <Button onClick={() => { setError(null); setCreating(true); }}>
            <Plus className="size-4" /> New project
          </Button>
        )}
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead>Delivery</TableHead>
            {canSeeFinancials && <TableHead>Budgeted Cost</TableHead>}
            <TableHead className="w-36 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canSeeFinancials ? 6 : 5} className="py-10 text-center text-muted-foreground">
                No projects yet.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((p) => {
              const action = PHASE_ACTION[p.status] ?? PHASE_ACTION.planning;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-semibold">{p.project_no}</TableCell>
                  <TableCell className="text-muted-foreground">{p.customer_name ?? "—"}</TableCell>
                  <TableCell>
                    <PhaseCell status={p.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(p.delivery_date)}</TableCell>
                  {canSeeFinancials && (
                    <TableCell className="text-muted-foreground">{formatINR(p.customer_po_value)}</TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={action.href(p.id)}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        {action.label} <ArrowRight className="ml-1 size-3" />
                      </Link>
                      {canWrite && (
                        <>
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => { setError(null); setEditing(p); }}
                            aria-label="Edit"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => onDelete(p)}
                            aria-label="Delete"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {/* Add / Edit dialog */}
      <Dialog
        open={creating || editing !== null}
        onClose={close}
        title={editing ? `Edit ${editing.project_no}` : "New project"}
      >
        <ProjectForm
          initial={editing}
          customers={customers}
          canSeeFinancials={canSeeFinancials}
          error={error}
          pending={pending}
          onSubmit={onSubmit}
          onCancel={close}
        />
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase stepper cell
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
      {/* Dot + line stepper */}
      <div className="flex items-center">
        {PHASES.map((phase, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <React.Fragment key={phase}>
              {i > 0 && (
                <div
                  className={cn(
                    "h-0.5 flex-1",
                    done ? "bg-primary" : "bg-slate-200",
                  )}
                />
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
      {/* Current phase label */}
      <p className="text-xs font-medium text-primary">
        {PHASE_SHORT[status] ?? status}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit form
// ---------------------------------------------------------------------------

function ProjectForm({
  initial,
  customers,
  canSeeFinancials,
  error,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: Project | null;
  customers: Customer[];
  canSeeFinancials: boolean;
  error: string | null;
  pending: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const customerItems = React.useMemo(() => customers.map((c) => ({ value: c.id, label: c.name })), [customers]);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Project / Order No." required className="col-span-2">
          <Input name="project_no" required defaultValue={initial?.project_no ?? ""} placeholder="YWS-001" />
        </Field>

        <Field label="Customer" className="col-span-2">
          <Combobox items={customerItems} defaultValue={initial?.customer_id ?? ""} name="customer_id" placeholder="— none —" />
        </Field>

        <Field label="Customer PO No.">
          <Input name="customer_po_number" defaultValue={initial?.customer_po_number ?? ""} />
        </Field>

        {canSeeFinancials && (
          <Field label="Budgeted Company Cost (₹)">
            <Input name="customer_po_value" type="number" step="any" defaultValue={initial?.customer_po_value ?? ""} />
          </Field>
        )}

        <Field label="Order date">
          <Input name="order_date" type="date" defaultValue={initial?.order_date ?? ""} />
        </Field>

        <Field label="Delivery date">
          <Input name="delivery_date" type="date" defaultValue={initial?.delivery_date ?? ""} />
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
