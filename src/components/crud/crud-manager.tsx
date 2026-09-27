"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/navigation-progress";
import { Plus, Pencil, Trash2, Search, ArrowRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { formatINR, formatNumber, formatDate } from "@/lib/utils";
import type { ActionResult } from "@/lib/server/crud";

export type { ActionResult };
export type ColumnFormat = "text" | "number" | "inr" | "bool" | "date" | "badge";
export type Column = { key: string; label: string; format?: ColumnFormat; financial?: boolean };

export type FieldType = "text" | "number" | "checkbox" | "select" | "combobox" | "textarea" | "date" | "tags";
export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  financial?: boolean;
  placeholder?: string;
  step?: string;
  options?: { value: string; label: string }[];
  help?: string;
  /** For checkboxes: checked state when creating a new record. */
  defaultChecked?: boolean;
};

type Row = Record<string, unknown> & { id: string };

export function CrudManager({
  title,
  entityName,
  rows,
  columns,
  fields,
  upsertAction,
  deleteAction,
  canWrite,
  canSeeFinancials,
  searchKeys,
  detailBase,
  hiddenValues,
  dialogClassName,
}: {
  title: string;
  entityName: string;
  rows: Row[];
  columns: Column[];
  fields: Field[];
  upsertAction: (fd: FormData) => Promise<ActionResult>;
  deleteAction: (fd: FormData) => Promise<ActionResult>;
  canWrite: boolean;
  canSeeFinancials: boolean;
  searchKeys: string[];
  /** When set, each row gets an "Open" link to `${detailBase}/${id}`. */
  detailBase?: string;
  /** Hidden fixed values injected into every create/edit form (e.g. parent FK). */
  hiddenValues?: Record<string, string>;
  /** Override the create/edit dialog's width (e.g. "max-w-2xl") for field-heavy masters. */
  dialogClassName?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const visibleColumns = columns.filter((c) => !c.financial || canSeeFinancials);
  const visibleFields = fields.filter((f) => !f.financial || canSeeFinancials);

  const filtered = rows.filter((r) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q));
  });

  function openCreate() {
    setError(null);
    setCreating(true);
  }
  function openEdit(row: Row) {
    setError(null);
    setEditing(row);
  }
  function close() {
    setCreating(false);
    setEditing(null);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const wasCreating = creating;
    const res = await upsertAction(fd);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    close();
    if (wasCreating && res?.redirect) {
      startNavProgress();
      router.push(res.redirect);
    } else {
      router.refresh();
    }
  }

  async function onDelete(row: Row) {
    if (!confirm(`Delete this ${entityName}? This cannot be undone.`)) return;
    const fd = new FormData();
    fd.set("id", row.id);
    const res = await deleteAction(fd);
    if (res?.error) {
      alert(res.error);
      return;
    }
    router.refresh();
  }

  const formRow = editing ?? null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${title.toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {rows.length}
        </p>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Add {entityName}
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {visibleColumns.map((c) => (
              <TableHead key={c.key}>{c.label}</TableHead>
            ))}
            {(canWrite || detailBase) && (
              <TableHead className="w-28 text-right">Actions</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + (canWrite || detailBase ? 1 : 0)} className="py-8 text-center text-muted-foreground">
                No {title.toLowerCase()} yet.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((row) => (
              <TableRow key={row.id}>
                {visibleColumns.map((c) => (
                  <TableCell key={c.key}>{renderCell(row[c.key], c.format)}</TableCell>
                ))}
                {(canWrite || detailBase) && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {detailBase && (
                        <Link
                          href={`${detailBase}/${row.id}`}
                          aria-label="Open"
                          className={buttonVariants({ variant: "ghost", size: "icon" })}
                        >
                          <ArrowRight className="size-4" />
                        </Link>
                      )}
                      {canWrite && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(row)} aria-label="Edit">
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(row)}
                            aria-label="Delete"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog
        open={creating || editing !== null}
        onClose={close}
        title={`${editing ? "Edit" : "Add"} ${entityName}`}
        className={dialogClassName}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {hiddenValues &&
            Object.entries(hiddenValues).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {visibleFields.map((f) => (
              <FieldInput key={f.name} field={f} defaultValue={formRow?.[f.name]} excludeId={formRow?.id} />
            ))}
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function FieldInput({ field, defaultValue, excludeId }: { field: Field; defaultValue: unknown; excludeId?: string }) {
  const full = field.type === "textarea" || field.type === "tags";
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 self-end pb-2">
        <input
          type="checkbox"
          name={field.name}
          defaultChecked={defaultValue !== undefined ? Boolean(defaultValue) : field.defaultChecked ?? false}
          className="size-4 rounded border-input"
        />
        <span className="text-sm font-medium">{field.label}</span>
      </label>
    );
  }
  return (
    <div className={`space-y-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={field.name}>
        {field.label}
        {field.required && <span className="text-destructive"> *</span>}
      </Label>
      {field.type === "select" ? (
        <Select
          id={field.name}
          name={field.name}
          required={field.required}
          defaultValue={defaultValue != null ? String(defaultValue) : ""}
        >
          <option value="">— none —</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : field.type === "combobox" ? (
        <Combobox
          id={field.name}
          name={field.name}
          required={field.required}
          defaultValue={defaultValue != null ? String(defaultValue) : ""}
          items={field.options ?? []}
          placeholder="— none —"
        />
      ) : field.type === "textarea" ? (
        <Textarea
          id={field.name}
          name={field.name}
          required={field.required}
          placeholder={field.placeholder}
          defaultValue={defaultValue != null ? String(defaultValue) : ""}
        />
      ) : field.type === "tags" ? (
        <TagsPicker name={field.name} options={field.options ?? []} defaultValue={defaultValue} excludeId={excludeId} />
      ) : (
        <Input
          id={field.name}
          name={field.name}
          type={field.type}
          step={field.step}
          required={field.required}
          placeholder={field.placeholder}
          defaultValue={defaultValue != null ? String(defaultValue) : ""}
        />
      )}
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
    </div>
  );
}

/** Multi-select "chips" picker — used for self-referencing lists like a component's approved alternatives. */
function TagsPicker({
  name,
  options,
  defaultValue,
  excludeId,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue: unknown;
  excludeId?: string;
}) {
  const initial = React.useMemo(() => {
    if (Array.isArray(defaultValue)) return defaultValue as string[];
    if (typeof defaultValue === "string" && defaultValue.trim()) {
      return defaultValue.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }, [defaultValue]);
  const [selected, setSelected] = React.useState<string[]>(initial);
  const [picker, setPicker] = React.useState("");
  const labelById = React.useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);
  const available = React.useMemo(
    () => options.filter((o) => o.value !== excludeId && !selected.includes(o.value)),
    [options, excludeId, selected],
  );

  return (
    <div className="space-y-1.5">
      <input type="hidden" name={name} value={selected.join(",")} />
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 pr-1.5">
              {labelById.get(id) ?? id}
              <button
                type="button"
                onClick={() => setSelected((prev) => prev.filter((x) => x !== id))}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Remove"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Combobox
        items={available}
        value={picker}
        onChange={(v) => {
          if (!v) return;
          setSelected((prev) => (prev.includes(v) ? prev : [...prev, v]));
          setPicker("");
        }}
        placeholder="Search to add…"
      />
    </div>
  );
}

function renderCell(value: unknown, format?: ColumnFormat) {
  if (format === "bool") return value ? <Badge variant="secondary">Yes</Badge> : <span className="text-muted-foreground">—</span>;
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  if (format === "inr") return formatINR(Number(value));
  if (format === "number") return formatNumber(Number(value));
  if (format === "date") return formatDate(String(value));
  if (format === "badge") return <Badge variant="secondary">{String(value)}</Badge>;
  return String(value);
}
