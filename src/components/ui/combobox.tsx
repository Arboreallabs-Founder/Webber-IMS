"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComboboxItem = { value: string; label: string };

/**
 * Type-to-filter dropdown — drop-in replacement for `<Select>` on large
 * master-data lists (vendors, components, projects, ...). Supports both
 * controlled (`value`/`onChange`) and uncontrolled (`defaultValue` + `name`,
 * submitted via plain FormData) usage, matching the two calling styles
 * already used across the app.
 */
export function Combobox({
  items,
  value,
  defaultValue,
  onChange,
  name,
  placeholder = "Search…",
  emptyText = "No matches.",
  required,
  disabled,
  id,
  className,
  onCreate,
  creating,
  createLabel,
}: {
  items: ComboboxItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  placeholder?: string;
  emptyText?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** When set, a "no matches" state offers to create a new item from the typed text instead of just saying so. */
  onCreate?: (query: string) => void;
  /** Shows a pending state on the create option while the caller's onCreate is in flight. */
  creating?: boolean;
  createLabel?: (query: string) => string;
}) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const selected = isControlled ? value! : internalValue;

  function setSelected(v: string) {
    if (!isControlled) setInternalValue(v);
    onChange?.(v);
  }

  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [rect, setRect] = React.useState<{ top: number; left: number; width: number } | null>(null);

  // Dropdown is portaled to <body> (see below) so it can't be clipped by a
  // scrollable ancestor like the Dialog body — position it against the
  // input's live screen coords instead of relying on CSS containment.
  React.useEffect(() => {
    if (!open) return;
    function updateRect() {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom, left: r.left, width: r.width });
    }
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open]);

  // Keep the visible text in sync when the selection changes externally
  // (e.g. the form resets after a successful add).
  React.useEffect(() => {
    if (!selected) { setQuery(""); return; }
    const item = items.find((i) => i.value === selected);
    if (item) setQuery(item.label);
  }, [selected, items]);

  const matches = React.useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, query, open]);
  const results = matches.slice(0, 50);

  // Native `form.reset()` doesn't touch React-owned state — listen for it
  // directly so uncontrolled usage (defaultValue + name) clears correctly,
  // same as a plain <select>/<input defaultValue> would.
  React.useEffect(() => {
    const form = containerRef.current?.closest("form");
    if (!form) return;
    function onReset() {
      if (!isControlled) setInternalValue(defaultValue ?? "");
      setOpen(false);
    }
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue, isControlled]);

  React.useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(item: ComboboxItem) {
    setSelected(item.value);
    setQuery(item.label);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") { setOpen(false); return; }
    // No matches but a creatable value typed — Enter creates it, same as
    // clicking the "+ Add ..." row, so typing-then-Enter doesn't silently
    // leave the value unselected and unsaved.
    if (results.length === 0) {
      if (e.key === "Enter" && onCreate && !creating && query.trim()) {
        e.preventDefault();
        onCreate(query.trim());
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[highlighted]) select(results[highlighted]); }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {name && <input type="hidden" name={name} value={selected} disabled={disabled} readOnly />}
      <Input
        id={id}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        onFocus={() => { setHighlighted(0); setOpen(true); }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlighted(0);
          if (selected) setSelected("");
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {open && rect && results.length > 0 && createPortal(
        <div
          ref={listRef}
          style={{ position: "fixed", top: rect.top + 4, left: rect.left, width: rect.width }}
          className="z-[60] max-h-64 overflow-y-auto rounded-md border border-border bg-card shadow-lg"
        >
          {results.map((item, i) => (
            <button
              key={item.value}
              type="button"
              onClick={() => select(item)}
              className={cn(
                "block w-full truncate px-3 py-2 text-left text-sm hover:bg-accent",
                i === highlighted && "bg-accent",
              )}
            >
              {item.label}
            </button>
          ))}
          {matches.length > results.length && (
            <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
              {matches.length - results.length} more — refine your search
            </div>
          )}
        </div>,
        document.body,
      )}
      {open && rect && query && results.length === 0 && createPortal(
        <div
          style={{ position: "fixed", top: rect.top + 4, left: rect.left, width: rect.width }}
          className="z-[60] rounded-md border border-border bg-card shadow-lg"
        >
          {onCreate ? (
            <button
              type="button"
              disabled={creating}
              onClick={() => onCreate(query.trim())}
              className="block w-full px-3 py-2 text-left text-sm text-primary hover:bg-accent disabled:opacity-50"
            >
              {creating ? "Adding…" : createLabel ? createLabel(query.trim()) : `+ Add "${query.trim()}"`}
            </button>
          ) : (
            <p className="p-3 text-sm text-muted-foreground">{emptyText}</p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
