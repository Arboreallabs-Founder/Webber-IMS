"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Search, Boxes, ChevronRight, ChevronDown, ExternalLink, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import type { ActionResult } from "@/lib/server/crud";

type VariantRule = { param?: string; map?: Record<string, { component_no?: string; qty?: number }> };
export type Line = {
  id: string;
  component_id: string | null;
  component_label: string;
  quantity: number;
  is_variant_driven: boolean;
  variant_rule: VariantRule | null;
  note: string | null;
  parent_line_id: string | null;
  line_type: string | null;
  section: string | null;
  assembly_name: string | null;
};
type Component = { id: string; component_no: string; name: string };
type DropdownParam = { name: string; options: (string | number)[] };
type RuleRow = { componentId: string; qty: string };
/** A line pulled from a sub-assembly's own template, shown read-only inline. */
export type PreviewLine = {
  id: string;
  component_id: string | null;
  component_label: string;
  quantity: number;
  is_variant_driven: boolean;
  line_type: string | null;
  variant_rule: VariantRule | null;
};

export function TemplateLineEditor({
  templateId,
  lines,
  components,
  dropdownParams,
  subTemplateByComponent,
  subLinesByTemplate,
  canWrite,
  upsertAction,
  removeAction,
  createComponentAction,
  promoteAction,
}: {
  templateId: string;
  lines: Line[];
  components: Component[];
  dropdownParams: DropdownParam[];
  subTemplateByComponent: Record<string, string>;
  subLinesByTemplate: Record<string, PreviewLine[]>;
  canWrite: boolean;
  upsertAction: (fd: FormData) => Promise<ActionResult>;
  removeAction: (fd: FormData) => Promise<ActionResult>;
  /** Optional: create a component inline from the line dialog. */
  createComponentAction?: (fd: FormData) => Promise<ActionResult>;
  /** Optional: promote a plain sub-assembly folder to a stock-tracked component. */
  promoteAction?: (fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  // Components created inline this session, merged on top of the server list.
  const [extraComponents, setExtraComponents] = React.useState<Component[]>([]);
  const allComponents = React.useMemo(
    () => [...extraComponents, ...components.filter((c) => !extraComponents.some((e) => e.id === c.id))],
    [components, extraComponents],
  );
  const compById = React.useMemo(() => new Map(allComponents.map((c) => [c.id, c])), [allComponents]);
  const compByNo = React.useMemo(
    () => new Map(allComponents.map((c) => [c.component_no.toLowerCase(), c.id])),
    [allComponents],
  );
  const paramByName = React.useMemo(() => new Map(dropdownParams.map((p) => [p.name, p])), [dropdownParams]);
  const componentItems = React.useMemo(
    () => allComponents.map((c) => ({ value: c.id, label: `${c.component_no} — ${c.name}` })),
    [allComponents],
  );

  // Assembly lines (possible parents) for the "nest under" picker.
  const assemblyLines = React.useMemo(() => lines.filter((l) => l.line_type === "assembly"), [lines]);
  // Own-line children keyed by parent_line_id (the editable sub-assembly tree).
  const ownChildrenByParent = React.useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of lines) {
      if (!l.parent_line_id) continue;
      if (!m.has(l.parent_line_id)) m.set(l.parent_line_id, []);
      m.get(l.parent_line_id)!.push(l);
    }
    return m;
  }, [lines]);

  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [componentId, setComponentId] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [isVariant, setIsVariant] = React.useState(false);
  const [isAssembly, setIsAssembly] = React.useState(false);
  const [assemblyName, setAssemblyName] = React.useState("");
  const [section, setSection] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [ruleParam, setRuleParam] = React.useState("");
  const [ruleRows, setRuleRows] = React.useState<Record<string, RuleRow>>({});
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  // Inline "new component" sub-dialog
  const [compDialogOpen, setCompDialogOpen] = React.useState(false);

  // "Make reusable" (promote) dialog
  const [promoteLine, setPromoteLine] = React.useState<Line | null>(null);

  // collapsed sub-assembly line ids (their children are hidden) — component-backed
  // sub-BOMs start collapsed; plain folders start expanded so their parts are visible.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => {
    const s = new Set<string>();
    const all = [...lines, ...Object.values(subLinesByTemplate).flat()];
    for (const l of all) {
      if (l.component_id && l.line_type === "assembly") {
        const stId = subTemplateByComponent[l.component_id];
        if (stId && (subLinesByTemplate[stId]?.length ?? 0) > 0) s.add(l.id);
      }
    }
    return s;
  });

  type DisplayNode = {
    id: string; depth: number; hasChildren: boolean; childCount: number; editable: boolean;
    component_id: string | null; component_label: string; quantity: number;
    is_variant_driven: boolean; line_type: string | null; variant_rule: VariantRule | null;
    section: string | null; raw: Line | null;
  };

  // A line's read-only inline children = the parts of its sub-assembly's own template.
  const subLinesOf = React.useCallback(
    (componentId: string | null, lineType: string | null): PreviewLine[] => {
      if (!componentId || lineType !== "assembly") return [];
      const stId = subTemplateByComponent[componentId];
      return stId ? (subLinesByTemplate[stId] ?? []) : [];
    },
    [subTemplateByComponent, subLinesByTemplate],
  );

  // ---- display tree: own lines nested by parent_line_id (editable) + sub-BOM
  //      parts (read-only, recursive) under component-backed assemblies ----
  const { tree, expandableIds } = React.useMemo(() => {
    const expandable = new Set<string>();
    const out: DisplayNode[] = [];

    const pushPreview = (items: PreviewLine[], depth: number) => {
      for (const pl of items) {
        const kids = subLinesOf(pl.component_id, pl.line_type);
        if (kids.length > 0) expandable.add(pl.id);
        out.push({
          id: pl.id, depth, hasChildren: kids.length > 0, childCount: kids.length, editable: false,
          component_id: pl.component_id, component_label: pl.component_label, quantity: pl.quantity,
          is_variant_driven: pl.is_variant_driven, line_type: pl.line_type, variant_rule: pl.variant_rule,
          section: null, raw: null,
        });
        if (kids.length > 0 && !collapsed.has(pl.id)) pushPreview(kids, depth + 1);
      }
    };

    const walkOwn = (items: Line[], depth: number) => {
      for (const l of items) {
        const ownKids = ownChildrenByParent.get(l.id) ?? [];
        const previewKids = subLinesOf(l.component_id, l.line_type);
        const childCount = ownKids.length + previewKids.length;
        if (childCount > 0) expandable.add(l.id);
        out.push({
          id: l.id, depth, hasChildren: childCount > 0, childCount, editable: true,
          component_id: l.component_id, component_label: l.component_label, quantity: l.quantity,
          is_variant_driven: l.is_variant_driven, line_type: l.line_type, variant_rule: l.variant_rule,
          section: l.section, raw: l,
        });
        if (childCount > 0 && !collapsed.has(l.id)) {
          if (ownKids.length) walkOwn(ownKids, depth + 1);
          if (previewKids.length) pushPreview(previewKids, depth + 1);
        }
      }
    };

    const roots = lines.filter((l) => !l.parent_line_id || !lines.some((p) => p.id === l.parent_line_id));
    walkOwn(roots, 0);
    return { tree: out, expandableIds: expandable };
  }, [lines, collapsed, ownChildrenByParent, subLinesByTemplate, subLinesOf]);

  const q = query.trim().toLowerCase();
  const filtered: DisplayNode[] = q
    ? lines
        .filter((line) => line.component_label.toLowerCase().includes(q) || (line.section ?? "").toLowerCase().includes(q))
        .map((l) => ({ id: l.id, depth: 0, hasChildren: false, childCount: 0, editable: true, component_id: l.component_id, component_label: l.component_label, quantity: l.quantity, is_variant_driven: l.is_variant_driven, line_type: l.line_type, variant_rule: l.variant_rule, section: l.section, raw: l }))
    : tree;

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allCollapsed = expandableIds.size > 0 && [...expandableIds].every((id) => collapsed.has(id));
  function toggleAll() {
    setCollapsed(allCollapsed ? new Set() : new Set(expandableIds));
  }

  function reset() {
    setComponentId("");
    setQuantity("1");
    setIsVariant(false);
    setIsAssembly(false);
    setAssemblyName("");
    setSection("");
    setParentId("");
    setRuleParam("");
    setRuleRows({});
    setNote("");
    setError(null);
  }

  function openCreate(asAssembly = false) {
    reset();
    setIsAssembly(asAssembly);
    setEditingId(null);
    setOpen(true);
  }

  function openEdit(line: Line) {
    reset();
    setEditingId(line.id);
    setComponentId(line.component_id ?? "");
    setQuantity(String(line.quantity ?? 1));
    setIsVariant(line.is_variant_driven);
    setIsAssembly(line.line_type === "assembly");
    setAssemblyName(line.assembly_name ?? "");
    setSection(line.section ?? "");
    setParentId(line.parent_line_id ?? "");
    setNote(line.note ?? "");
    if (line.is_variant_driven && line.variant_rule?.param) {
      const param = line.variant_rule.param;
      setRuleParam(param);
      const rows: Record<string, RuleRow> = {};
      for (const opt of paramByName.get(param)?.options ?? []) {
        const key = String(opt);
        const entry = line.variant_rule.map?.[key];
        rows[key] = {
          componentId: entry?.component_no ? compByNo.get(entry.component_no.toLowerCase()) ?? "" : "",
          qty: String(entry?.qty ?? 1),
        };
      }
      setRuleRows(rows);
    }
    setOpen(true);
  }

  function onParamChange(name: string) {
    setRuleParam(name);
    const rows: Record<string, RuleRow> = {};
    for (const opt of paramByName.get(name)?.options ?? []) {
      const key = String(opt);
      rows[key] = ruleRows[key] ?? { componentId: "", qty: "1" };
    }
    setRuleRows(rows);
  }

  function setRow(key: string, patch: Partial<RuleRow>) {
    setRuleRows((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let variantRuleStr = "";
    if (isAssembly) {
      if (!assemblyName.trim() && !section.trim()) {
        setError("Give the sub-assembly a name.");
        return;
      }
    } else if (isVariant) {
      if (!ruleParam) {
        setError("Choose the parameter that drives this line.");
        return;
      }
      const map: Record<string, { component_no: string; qty: number }> = {};
      for (const opt of paramByName.get(ruleParam)?.options ?? []) {
        const key = String(opt);
        const row = ruleRows[key];
        if (row?.componentId) {
          const comp = compById.get(row.componentId)!;
          map[key] = { component_no: comp.component_no, qty: Number(row.qty) || 1 };
        }
      }
      if (Object.keys(map).length === 0) {
        setError("Pick a component for at least one configuration value.");
        return;
      }
      variantRuleStr = JSON.stringify({ param: ruleParam, map });
    } else if (!componentId) {
      setError("Pick a component.");
      return;
    }

    // A plain folder has no component and its qty is ignored by the engine; a
    // promoted sub-assembly keeps both.
    const isPlainFolder = isAssembly && !componentId;

    const fd = new FormData();
    fd.set("bom_template_id", templateId);
    if (editingId) fd.set("id", editingId);
    if (componentId) fd.set("component_id", componentId);
    fd.set("quantity", isPlainFolder ? "0" : quantity);
    if (isVariant && !isAssembly) fd.set("is_variant_driven", "on");
    if (isAssembly) fd.set("is_assembly", "on");
    if (variantRuleStr) fd.set("variant_rule", variantRuleStr);
    if (isAssembly && assemblyName.trim()) fd.set("assembly_name", assemblyName.trim());
    if (section.trim()) fd.set("section", section.trim());
    if (parentId) fd.set("parent_line_id", parentId);
    if (note) fd.set("note", note);

    setPending(true);
    const res = await upsertAction(fd);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    reset();
    router.refresh();
  }

  async function onCreateComponent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!createComponentAction) return;
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    setPending(true);
    const res = await createComponentAction(fd);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    const newId = res.id;
    if (newId) {
      const comp: Component = {
        id: newId,
        component_no: String(fd.get("component_no") ?? "").trim(),
        name: String(fd.get("name") ?? "").trim(),
      };
      setExtraComponents((prev) => [comp, ...prev]);
      setComponentId(newId);
    }
    setCompDialogOpen(false);
    form.reset();
    router.refresh();
  }

  async function onPromote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!promoteAction || !promoteLine) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("line_id", promoteLine.id);
    setPending(true);
    const res = await promoteAction(fd);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setPromoteLine(null);
    router.refresh();
  }

  async function onDelete(line: Line) {
    const kids = lines.filter((l) => l.parent_line_id === line.id).length;
    const msg = kids > 0 ? `Delete this sub-assembly and its ${kids} nested line(s)?` : "Delete this line?";
    if (!confirm(msg)) return;
    const fd = new FormData();
    fd.set("id", line.id);
    const res = await removeAction(fd);
    if (res?.error) alert(res.error);
    else router.refresh();
  }

  let lastSection: string | null = null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Search lines…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <p className="text-sm text-muted-foreground">{filtered.length} of {lines.length}</p>
        {!q && expandableIds.size > 0 && (
          <Button variant="outline" size="sm" onClick={toggleAll}>
            {allCollapsed ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {allCollapsed ? "Expand all" : "Collapse all"}
          </Button>
        )}
        {canWrite && (
          <>
            <Button variant="outline" onClick={() => openCreate(true)}>
              <Boxes className="size-4" /> Add sub-assembly
            </Button>
            <Button onClick={() => openCreate(false)}>
              <Plus className="size-4" /> Add line
            </Button>
          </>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Varies by</TableHead>
            {canWrite && <TableHead className="w-28 text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canWrite ? 5 : 4} className="py-8 text-center text-muted-foreground">
                No lines yet.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((n) => {
              const { depth, hasChildren, childCount, editable } = n;
              // section header row (only in tree view, at depth 0 when section changes)
              const showHeader = !q && depth === 0 && (n.section ?? "") !== (lastSection ?? "");
              if (!q) lastSection = n.section ?? "";
              const isAsm = n.line_type === "assembly";
              const isPlainFolder = isAsm && !n.component_id;
              const isCollapsed = collapsed.has(n.id);
              const subTplId = n.component_id ? subTemplateByComponent[n.component_id] : undefined;
              return (
                <React.Fragment key={n.id}>
                  {showHeader && n.section && (
                    <TableRow className="bg-muted/40">
                      <TableCell colSpan={canWrite ? 5 : 4} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {n.section}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow className={editable ? undefined : "bg-muted/20"}>
                    <TableCell className="font-medium">
                      <span style={{ paddingLeft: `${depth * 1.25}rem` }} className="inline-flex items-center gap-1">
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => toggleCollapse(n.id)}
                            aria-label={isCollapsed ? "Expand sub-assembly" : "Collapse sub-assembly"}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                          </button>
                        ) : (
                          <span className="inline-block w-5" />
                        )}
                        {isAsm && <Boxes className="size-3.5 text-muted-foreground" />}
                        <span className={editable ? undefined : "text-muted-foreground"}>{n.component_label}</span>
                        {hasChildren && <span className="ml-1 text-xs font-normal text-muted-foreground">({childCount})</span>}
                        {isAsm && subTplId && (
                          <Link
                            href={`/masters/bom-builder/${subTplId}`}
                            className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-normal text-primary hover:underline"
                          >
                            open sub-BOM <ExternalLink className="size-3" />
                          </Link>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className={editable ? undefined : "text-muted-foreground"}>{isPlainFolder ? "—" : formatNumber(n.quantity)}</TableCell>
                    <TableCell>
                      {isPlainFolder ? (
                        <Badge variant="outline">Folder</Badge>
                      ) : isAsm ? (
                        <Badge variant="outline">Sub-assembly</Badge>
                      ) : n.is_variant_driven ? (
                        <Badge variant="warning">Variant</Badge>
                      ) : (
                        <Badge variant="secondary">Common</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{ruleSummary(n.is_variant_driven, n.variant_rule)}</TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        {editable && n.raw ? (
                          <div className="flex justify-end gap-1">
                            {isPlainFolder && promoteAction && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setPromoteLine(n.raw!)}
                                aria-label="Make reusable / stock-tracked"
                                title="Make reusable / stock-tracked"
                              >
                                <PackagePlus className="size-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => openEdit(n.raw!)} aria-label="Edit">
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => onDelete(n.raw!)} aria-label="Delete">
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">from sub-BOM</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>

      <Dialog open={open} onClose={() => setOpen(false)} title={`${editingId ? "Edit" : "Add"} ${isAssembly ? "sub-assembly" : "BOM line"}`} className="max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          {isAssembly ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Sub-assembly name</Label>
                <Input value={assemblyName} onChange={(e) => setAssemblyName(e.target.value)} placeholder="Housing, SS Brush Frame…" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>Section (optional)</Label>
                <Input value={section} onChange={(e) => setSection(e.target.value)} placeholder="grouping label" />
              </div>
              {componentId && (
                <div className="space-y-1.5">
                  <Label>Quantity per parent unit</Label>
                  <Input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label>{isVariant ? "Default component (optional)" : "Component"}</Label>
                    {createComponentAction && (
                      <button
                        type="button"
                        onClick={() => setCompDialogOpen(true)}
                        className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                      >
                        <Plus className="size-3" /> New component
                      </button>
                    )}
                  </div>
                  <Combobox items={componentItems} value={componentId} onChange={setComponentId} placeholder="— none —" />
                </div>
                <div className="space-y-1.5">
                  <Label>{isVariant ? "Default qty" : "Quantity"}</Label>
                  <Input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Section</Label>
                  <Input value={section} onChange={(e) => setSection(e.target.value)} placeholder="Housing, Remaining BOM…" />
                </div>
                <div className="space-y-1.5">
                  <Label>Nest under (sub-assembly)</Label>
                  <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                    <option value="">— top level —</option>
                    {assemblyLines
                      .filter((a) => a.id !== editingId)
                      .map((a) => (
                        <option key={a.id} value={a.id}>{a.component_label}</option>
                      ))}
                  </Select>
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isVariant}
                  disabled={dropdownParams.length === 0}
                  onChange={(e) => {
                    setIsVariant(e.target.checked);
                    if (e.target.checked && !ruleParam && dropdownParams[0]) onParamChange(dropdownParams[0].name);
                  }}
                  className="size-4 rounded border-input"
                />
                <span className="text-sm font-medium">
                  This line varies by configuration
                  {dropdownParams.length === 0 && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">(no dropdown parameters on this product)</span>
                  )}
                </span>
              </label>

              {isVariant && (
                <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <Label>Driven by parameter</Label>
                    <Select value={ruleParam} onChange={(e) => onParamChange(e.target.value)}>
                      <option value="">— choose —</option>
                      {dropdownParams.map((p) => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </Select>
                  </div>

                  {ruleParam && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        For each {ruleParam} value, choose the component &amp; qty
                      </p>
                      {(paramByName.get(ruleParam)?.options ?? []).map((opt) => {
                        const key = String(opt);
                        const row = ruleRows[key] ?? { componentId: "", qty: "1" };
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-sm font-medium">{key}</span>
                            <Combobox
                              items={componentItems}
                              value={row.componentId}
                              onChange={(v) => setRow(key, { componentId: v })}
                              placeholder="— (skip) —"
                              className="flex-1"
                            />
                            <Input
                              type="number"
                              step="any"
                              value={row.qty}
                              onChange={(e) => setRow(key, { qty: e.target.value })}
                              className="w-20"
                              aria-label="qty"
                            />
                          </div>
                        );
                      })}
                      <p className="text-xs text-muted-foreground">
                        Leave a value as “(skip)” if that configuration doesn’t use this line.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="space-y-1.5">
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
          </div>

          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Save</Button>
          </div>
        </form>
      </Dialog>

      {createComponentAction && (
        <Dialog open={compDialogOpen} onClose={() => setCompDialogOpen(false)} title="New component" className="max-w-lg">
          <form onSubmit={onCreateComponent} className="space-y-4">
            <input type="hidden" name="tracking_mode" value="box" />
            <input type="hidden" name="quantity_type" value="nos" />
            <input type="hidden" name="uom" value="Nos" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>WPC (Webber Part Code) *</Label>
                <Input name="component_no" required placeholder="e.g. NZ-3600-02" />
              </div>
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" required placeholder="Nozzle 2 inch" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Category</Label>
                <Input name="type" placeholder="Nozzle, Fastener, Media…" />
              </div>
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCompDialogOpen(false)}>Cancel</Button>
              <Button type="submit" loading={pending}>Create & select</Button>
            </div>
          </form>
        </Dialog>
      )}

      {promoteAction && (
        <Dialog open={promoteLine !== null} onClose={() => setPromoteLine(null)} title="Make reusable / stock-tracked" className="max-w-lg">
          <form onSubmit={onPromote} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This turns <span className="font-medium text-foreground">{promoteLine?.assembly_name || promoteLine?.section || "the folder"}</span> into
              a component with its own BOM. Its parts move into that sub-BOM, and it can then be built and stocked on its own.
            </p>
            <div className="space-y-1.5">
              <Label>WPC (optional)</Label>
              <Input name="component_no" placeholder="auto-generated if left blank" />
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPromoteLine(null)}>Cancel</Button>
              <Button type="submit" loading={pending}>Promote</Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function ruleSummary(isVariant: boolean, rule: VariantRule | null): string {
  if (!isVariant || !rule?.param) return "—";
  const entries = Object.entries(rule.map ?? {})
    .map(([v, e]) => `${v}: ${e.component_no ?? "—"}×${e.qty ?? 1}`)
    .join(", ");
  return `${rule.param} → ${entries}`;
}
