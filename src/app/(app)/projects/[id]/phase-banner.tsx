import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, AlertCircle, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdvancePhaseButton } from "./advance-phase-button";
import { updateProjectStatus } from "./actions";

// ---------------------------------------------------------------------------
// Phase configuration
// ---------------------------------------------------------------------------

const PHASES = ["planning","doc_approval","procurement","production","dispatched","closed"] as const;
type Phase = (typeof PHASES)[number];

const PHASE_LABEL: Record<string, string> = {
  planning:    "Planning",
  doc_approval:"Doc Approval",
  procurement: "Procurement",
  production:  "Production",
  dispatched:  "Dispatched",
  closed:      "Closed",
};

type NextStep = {
  message: string;
  link?: string;
  linkLabel?: string;
  nextPhase?: Phase;
  nextPhaseLabel?: string;
};

function getNextStep(
  status: string,
  lineItemCount: number,
  bom: { status: string } | null,
  hasShortfall: boolean,
  projectId: string,
): NextStep | null {
  switch (status) {
    case "planning":
      if (lineItemCount === 0)
        return { message: "Add at least one line item to define what is being built.", link: `#line-items`, linkLabel: "Go to line items" };
      if (!bom)
        return { message: "Generate the BOM from line items, then get it approved.", link: `#bom`, linkLabel: "Go to BOM" };
      if (bom.status === "pending_approval")
        return { message: "BOM is waiting for an Admin to approve it.", link: `#bom`, linkLabel: "Go to BOM" };
      if (bom.status !== "approved")
        return { message: "BOM is draft — approve it (or submit it for approval) to lock the material list.", link: `#bom`, linkLabel: "Go to BOM" };
      return { message: "BOM approved. Advance to Doc Approval.", nextPhase: "doc_approval", nextPhaseLabel: "Advance to Doc Approval" };

    case "doc_approval":
      if (!bom || bom.status !== "approved")
        return { message: "BOM must be approved before advancing to Procurement.", link: `#bom`, linkLabel: "Go to BOM" };
      return { message: "Advance to Procurement to start sourcing materials.", nextPhase: "procurement", nextPhaseLabel: "Advance to Procurement" };

    case "procurement":
      if (hasShortfall)
        return { message: "Some components are short — raise a PO for the shortfall first.", link: `#shortfall`, linkLabel: "Go to shortfall" };
      return { message: "All materials covered. Advance to Production.", nextPhase: "production", nextPhaseLabel: "Advance to Production" };

    case "production":
      return { message: "In production. Mark dispatched when goods leave.", nextPhase: "dispatched", nextPhaseLabel: "Mark as Dispatched" };

    case "dispatched":
      return { message: "Register finished goods before closing the project.", link: `/finished-goods`, linkLabel: "Finished goods", nextPhase: "closed", nextPhaseLabel: "Close project" };

    case "closed":
    case "on_hold":
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PhaseBanner({
  projectId,
  status,
  lineItemCount,
  bom,
  hasShortfall,
  canWrite,
}: {
  projectId: string;
  status: string;
  lineItemCount: number;
  bom: { status: string } | null;
  hasShortfall: boolean;
  canWrite: boolean;
}) {
  const currentIdx = PHASES.indexOf(status as Phase);
  const nextStep = getNextStep(status, lineItemCount, bom, hasShortfall, projectId);

  return (
    <div className="mb-8 rounded-lg border border-border bg-card p-5 shadow-sm">
      {/* Stepper */}
      <div className="mb-5 flex items-center gap-0">
        {PHASES.map((phase, i) => {
          const done   = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={phase} className="flex min-w-0 flex-1 items-center">
              {/* Connector line (before dot, skip first) */}
              {i > 0 && (
                <div className={cn("h-0.5 flex-1 transition-colors", done ? "bg-primary" : "bg-border")} />
              )}
              {/* Dot + label */}
              <div className="flex shrink-0 flex-col items-center gap-1">
                {done ? (
                  <CheckCircle2 className="size-5 text-primary" />
                ) : active ? (
                  <div className="size-5 rounded-full bg-primary ring-4 ring-primary/20" />
                ) : (
                  <Circle className="size-5 text-muted-foreground/40" />
                )}
                <span className={cn(
                  "hidden text-[10px] font-medium sm:block",
                  done   && "text-primary",
                  active && "text-primary",
                  !done && !active && "text-muted-foreground",
                )}>
                  {PHASE_LABEL[phase]}
                </span>
              </div>
            </div>
          );
        })}

        {/* On-hold override */}
        {status === "on_hold" && (
          <div className="ml-4 flex items-center gap-1.5 text-amber-600">
            <PauseCircle className="size-5" />
            <span className="text-sm font-medium">On Hold</span>
          </div>
        )}
      </div>

      {/* Next step bar */}
      {nextStep ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5">
          <AlertCircle className="size-4 shrink-0 text-amber-500" />
          <p className="flex-1 text-sm text-amber-800">{nextStep.message}</p>
          <div className="flex flex-wrap items-center gap-2">
            {nextStep.link && (
              <Link
                href={nextStep.link}
                className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1 text-sm font-medium text-amber-700 shadow-sm ring-1 ring-amber-200 hover:bg-amber-50"
              >
                {nextStep.linkLabel} <ArrowRight className="size-3" />
              </Link>
            )}
            {canWrite && nextStep.nextPhase && (
              <AdvancePhaseButton
                projectId={projectId}
                nextPhase={nextStep.nextPhase}
                label={nextStep.nextPhaseLabel ?? `Advance to ${PHASE_LABEL[nextStep.nextPhase]}`}
                updateAction={updateProjectStatus}
              />
            )}
          </div>
        </div>
      ) : status === "closed" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-green-500" /> Project complete.
        </div>
      ) : null}
    </div>
  );
}
