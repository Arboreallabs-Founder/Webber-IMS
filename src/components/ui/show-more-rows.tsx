"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const LIMIT = 5;

/**
 * A titled section that shows only the first 5 rows of every table (and of any
 * element marked `data-row-list`, e.g. mobile card lists) inside it. Clicking
 * the title or "Show more" reveals the full list; "Show less" goes back to 5.
 * Works on whatever the child renders, so panels don't each need paging
 * state. Rows are counted from the DOM and recounted when the child
 * re-renders (rows added or removed).
 */
export function ShowMoreRows({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [rowCount, setRowCount] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const count = () => {
      const lists = [...el.querySelectorAll("tbody, [data-row-list]")];
      setRowCount(lists.reduce((m, l) => Math.max(m, l.children.length), 0));
    };
    count();
    const obs = new MutationObserver(count);
    obs.observe(el, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const hidden = rowCount - LIMIT;
  const toggle = () => hidden > 0 && setExpanded((v) => !v);

  return (
    <section id={id} className="mt-8 first:mt-0">
      <button
        type="button"
        onClick={toggle}
        className={cn("flex w-full items-center gap-2 border-b border-border pb-2 text-left", hidden > 0 ? "cursor-pointer" : "cursor-default")}
      >
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {hidden > 0 && (
          <span className="text-xs text-muted-foreground/80">
            {expanded ? `Showing all ${rowCount} · click to collapse` : `Showing ${LIMIT} of ${rowCount} · click to expand`}
          </span>
        )}
      </button>
      <div
        ref={ref}
        className={cn("pt-4", !expanded && "[&_tbody>tr:nth-child(n+6)]:hidden [&_[data-row-list]>*:nth-child(n+6)]:hidden")}
      >
        {children}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={toggle}
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-4" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="size-4" /> Show more ({hidden} more)
            </>
          )}
        </button>
      )}
    </section>
  );
}
