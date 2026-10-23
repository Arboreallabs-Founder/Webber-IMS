"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { formatINR } from "@/lib/utils";

export type ProjectValue = { projectId: string; label: string; value: number };

const DETAIL = {
  blocked: {
    title: "Blocked inventory by project",
    description: "On the shelf, reserved for a project and not yet used. Valued at PO rate.",
  },
  wip: {
    title: "WIP by project",
    description: "Already consumed into each project. Valued at PO rate.",
  },
} as const;

export function InventorySplitCards({
  open,
  blocked,
  wip,
  blockedByProject,
  wipByProject,
}: {
  open: number;
  blocked: number;
  wip: number;
  blockedByProject: ProjectValue[];
  wipByProject: ProjectValue[];
}) {
  const [shown, setShown] = React.useState<"blocked" | "wip" | null>(null);
  const rows = shown === "blocked" ? blockedByProject : shown === "wip" ? wipByProject : [];
  const total = shown === "blocked" ? blocked : wip;

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open inventory</p>
          <p className="mt-1 text-2xl font-semibold">{formatINR(open)}</p>
        </CardContent>
      </Card>
      {(["blocked", "wip"] as const).map((k) => (
        <button key={k} type="button" onClick={() => setShown(k)} className="text-left">
          <Card className="h-full transition-colors hover:border-primary hover:bg-accent/40">
            <CardContent className="p-4">
              <p className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {k === "blocked" ? "Blocked inventory" : "WIP"}
                <ChevronRight className="size-3.5" />
              </p>
              <p className="mt-1 text-2xl font-semibold">{formatINR(k === "blocked" ? blocked : wip)}</p>
            </CardContent>
          </Card>
        </button>
      ))}

      <Dialog
        open={shown !== null}
        onClose={() => setShown(null)}
        title={shown ? DETAIL[shown].title : ""}
        description={shown ? DETAIL[shown].description : undefined}
      >
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {rows.map((r) => (
              <li key={r.projectId}>
                <Link
                  href={`/projects/${r.projectId}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary"
                >
                  <span className="min-w-0 truncate">{r.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatINR(r.value)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {total > 0 ? `${Math.round((r.value / total) * 100)}%` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatINR(total)}</span>
        </div>
      </Dialog>
    </>
  );
}
