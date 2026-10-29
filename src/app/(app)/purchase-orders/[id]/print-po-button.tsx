"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Printer, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export type SignatureStep = { slot: number; signerName: string | null; role: string; isSigned: boolean };
export type ApprovalBlock = { lines: string[]; approverName: string | null };

/**
 * Print PO.
 *
 * The button is always pressable, even when the PO isn't ready. A disabled
 * button with a hover tooltip said you couldn't print but not what to do about
 * it — and on touch there is no hover at all, so the reason was invisible.
 * Pressing now opens a dialog naming exactly which approvals and whose
 * signatures are outstanding.
 *
 * Signed steps are listed too, not just missing ones: on a three-signature
 * chain "Rakesh done, waiting on Prem" is the useful answer, and "2 signatures
 * still needed" is not.
 *
 * `ready` comes from the server and mirrors the two gates the print page
 * enforces itself, so this can never offer a print the destination refuses.
 */
export function PrintPoButton({
  poId,
  ready,
  approval,
  steps,
}: {
  poId: string;
  ready: boolean;
  approval: ApprovalBlock | null;
  steps: SignatureStep[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => (ready ? router.push(`/purchase-orders/${poId}/print`) : setOpen(true))}
      >
        <Printer className="size-4" /> Print PO
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Not ready to print yet"
        description="This PO still needs the following."
      >
        <div className="space-y-5">
          {approval && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Price approval
              </h3>
              <p className="text-sm">
                {approval.lines.length} line{approval.lines.length !== 1 ? "s" : ""} awaiting approval
                {approval.approverName ? <> from <span className="font-medium">{approval.approverName}</span></> : null}.
              </p>
              <ul className="mt-2 space-y-1">
                {approval.lines.map((l, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Clock className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {steps.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Signatures
              </h3>
              <ul className="space-y-2">
                {steps.map((s) => (
                  <li key={s.slot} className="flex items-start gap-2 text-sm">
                    {s.isSigned ? (
                      <Check className="mt-0.5 size-3.5 shrink-0 text-green-700" />
                    ) : (
                      <Clock className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                    )}
                    <span className={s.isSigned ? "text-muted-foreground" : undefined}>
                      <span className="font-medium">{s.signerName ?? "Nobody assigned"}</span>
                      <span className="text-muted-foreground"> — {s.role}</span>
                      {s.isSigned && <span className="text-muted-foreground"> · signed</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {steps.filter((s) => !s.isSigned).length > 1 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Signatures are taken in order — each person can only sign once the one above them has.
                </p>
              )}
            </section>
          )}

          <div className="flex justify-end border-t border-border pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
