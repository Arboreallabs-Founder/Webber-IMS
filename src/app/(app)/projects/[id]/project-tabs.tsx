"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ProjectTab = { id: string; label: string; content: React.ReactNode };

/**
 * The project page's sections as switchable tabs. Every panel stays rendered
 * (inactive ones are hidden), so switching keeps whatever was typed or
 * expanded. The open tab follows the URL hash: links such as "#bom" from the
 * phase banner or a notification open that tab, and switching tabs updates
 * the hash so a reload or a shared link lands on the same tab.
 */
export function ProjectTabs({ tabs }: { tabs: ProjectTab[] }) {
  const ids = React.useMemo(() => tabs.map((t) => t.id), [tabs]);
  const [active, setActive] = React.useState(tabs[0]?.id);

  React.useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (ids.includes(h)) setActive(h);
    };
    fromHash();
    // In-page links ("Go to BOM") change the hash via the router, which fires
    // no hashchange event — so catch the click itself as well.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]");
      const href = a?.getAttribute("href") ?? "";
      const h = href.startsWith("#") ? href.slice(1) : "";
      if (h && ids.includes(h)) setActive(h);
    };
    window.addEventListener("hashchange", fromHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      document.removeEventListener("click", onClick);
    };
  }, [ids]);

  function open(id: string) {
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  return (
    <div>
      <div role="tablist" className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:px-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => open(t.id)}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} id={t.id} role="tabpanel" hidden={active !== t.id} className="scroll-mt-20 pt-5">
          {t.content}
        </div>
      ))}
    </div>
  );
}
