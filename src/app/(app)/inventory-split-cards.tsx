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
    description: "Reserved for a project and not yet used — on the shelf or out with a job-work vendor. Valued at PO rate.",
  },
  wip: {
    title: "WIP by project",
    description: "Consumed into each project and still in the factory. Valued at PO rate.",
  },
  dispatched: {
    title: "Dispatched by project",
    description: "Consumed material that has gone to the client with its finished goods. Valued at PO rate.",
  },
} as const;
type Kind = keyof typeof DETAIL;
const CARD_LABEL: Record<Kind, string> = { blocked: "Blocked inventory", wip: "WIP", dispatched: "Dispatched" };

export function InventorySplitCards({
  open,
  blocked,
  wip,
  dispatched,
  blockedByProject,
  wipByProject,
  dispatchedByProject,
}: {
  open: number;
  blocked: number;
  wip: number;
  dispatched: number;
  blockedByProject: ProjectValue[];
  wipByProject: ProjectValue[];
  dispatchedByProject: ProjectValue[];
}) {
  const [shown, setShown] = React.useState<Kind | null>(null);
  const totals: Record<Kind, number> = { blocked, wip, dispatched };
  const byProject: Record<Kind, ProjectValue[]> = { blocked: blockedByProject, wip: wipByProject, dispatched: dispatchedByProject };
  const rows = shown ? byProject[shown] : [];
  const total = shown ? totals[shown] : 0;

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open inventory</p>
          <p className="mt-1 text-2xl font-semibold">{formatINR(open)}</p>
        </CardContent>
      </Card>
      {(["blocked", "wip", "dispatched"] as const).map((k) => (
        <button key={k} type="button" onClick={() => setShown(k)} className="text-left">
          <Card className="h-full transition-colors hover:border-primary hover:bg-accent/40">
            <CardContent className="p-4">
              <p className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {CARD_LABEL[k]}
                <ChevronRight className="size-3.5" />
              </p>
              <p className="mt-1 text-2xl font-semibold">{formatINR(totals[k])}</p>
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
