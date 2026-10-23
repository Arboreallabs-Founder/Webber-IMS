import { ChevronRight } from "lucide-react";

/**
 * Native <details>/<summary> — no client JS needed, and browsers auto-expand
 * a closed <details> when a same-page #anchor link targets something inside it
 * (see phase-banner.tsx's #line-items/#bom/#shortfall links).
 */
export function CollapsibleSection({
  id,
  title,
  defaultOpen = false,
  badge,
  hint,
  children,
}: {
  id?: string;
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  /** Shown beside the title only while the section is closed. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={defaultOpen} className="group mt-8 first:mt-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-border pb-2 marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {badge}
        {hint && <span className="text-xs text-muted-foreground/80 group-open:hidden">{hint}</span>}
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
