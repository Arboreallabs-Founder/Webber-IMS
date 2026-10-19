import { formatDate, cn } from "@/lib/utils";
import type { SigningState } from "@/lib/signatures";

const GRID_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" };

/** The signature strip at the bottom of every printable document — one column per required slot (plus any slot signed before its approver was removed), rendering a captured signature image once signed, the blank label until then. */
export function DocumentSignatureBlock({
  labels,
  signed,
  requiredSlots,
  className,
}: {
  labels: [string, string, string];
  signed: SigningState["signed"];
  requiredSlots: number[];
  className?: string;
}) {
  const slots = [...new Set([...(requiredSlots.length ? requiredSlots : [1]), ...signed.map((s) => s.slot)])].sort((a, b) => a - b);
  return (
    <div className={cn("grid gap-3 border-t border-black p-6 pt-12 text-center", GRID_COLS[slots.length] ?? "grid-cols-3", className)}>
      {slots.map((slot) => {
        const label = labels[slot - 1];
        const sig = signed.find((s) => s.slot === slot);
        return (
          <div key={slot}>
            {sig ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sig.image_data_url} className="mx-auto h-10 object-contain" alt="" />
                <div className="mb-0.5 border-t border-black pt-1">
                  {label}{sig.signer_name ? ` — ${sig.signer_name}` : ""}
                </div>
                <div className="text-[9px] text-muted-foreground">{formatDate(sig.signed_at)}</div>
              </>
            ) : (
              <div className="mb-1 border-t border-black pt-1">{label}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
