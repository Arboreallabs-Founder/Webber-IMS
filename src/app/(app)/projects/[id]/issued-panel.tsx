import { AlertTriangle, CheckCircle2, MinusCircle, PackageSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";

type Row = {
  component_id: string;
  component_label: string;
  planned: number;
  issued: number;
  in_plan: boolean;
};

/**
 * Read-only: what's actually been issued/scanned in for this project so far,
 * against what was planned in the BOM. Anything issued that isn't in the plan
 * (e.g. scanned in by mistake, or a genuine extra) is flagged, not hidden.
 */
export function IssuedPanel({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing issued yet. Issue components via Requisitions.</p>;
  }

  const unplanned = rows.filter((r) => !r.in_plan);

  return (
    <div className="space-y-4">
      {unplanned.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">{unplanned.length} component(s) issued that aren't in the BOM</p>
            <p className="mt-0.5 text-amber-700">Flagged below — confirm these were intentional.</p>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead>Planned</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.component_id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-1.5">
                  {r.component_label}
                  {!r.in_plan && <Badge variant="warning">Not in plan</Badge>}
                </div>
              </TableCell>
              <TableCell>{r.in_plan ? formatNumber(r.planned) : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell>{formatNumber(r.issued)}</TableCell>
              <TableCell>
                {!r.in_plan ? (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <PackageSearch className="size-3.5" /> Unplanned
                  </span>
                ) : r.issued <= 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MinusCircle className="size-3.5" /> Not yet issued
                  </span>
                ) : r.issued > r.planned ? (
                  // Taking more than was reserved is allowed (the extra comes
                  // from open stock), so going past the BOM is flagged here.
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="size-3.5" /> Over-issued by {formatNumber(r.issued - r.planned)}
                  </span>
                ) : r.issued >= r.planned ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <CheckCircle2 className="size-3.5" /> Fully issued
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="size-3.5" /> Partially issued
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
